import { readBounded, safePath, unzip } from "./files";
import { randomToken } from "./security";
import type { SqlStore } from "./store";
import { LIMITS, requireThat, sha256 } from "./types";

// Upload links let clients with a shell or code sandbox (Claude Code, claude.ai code
// execution) send binary or large files without passing the bytes through the chat.
export const UPLOAD_LINK_MS = 10 * 60000;
// Received bytes wait this long for a stage or publish call that uses them.
const UPLOAD_KEEP_MS = 60 * 60000;
interface Upload {
  id: string;
  path?: string;
  archive: boolean;
  max: number;
  created: number;
  expires: number;
  received?: number;
  size?: number;
  sha256?: string;
}
const MiB = 1024 * 1024;
const MAX_PENDING = 20;
const MAX_PENDING_BYTES = 100 * MiB;

export class Uploads {
  constructor(
    private store: SqlStore,
    private origin: string,
    private now = () => Date.now(),
  ) {}
  async create(input: { path?: string; archive?: boolean; size: number }) {
    requireThat(
      !!input.archive !== !!input.path,
      "invalid_input",
      "Give either the file's path in the project, or archive: true for a ZIP.",
    );
    const max = input.archive ? LIMITS.projectBytes : LIMITS.fileBytes;
    requireThat(
      Number.isInteger(input.size) && input.size > 0 && input.size <= max,
      "too_large",
      `${input.archive ? "ZIP uploads" : "Files"} are limited to ${max / MiB} MiB.`,
    );
    const pending = this.store.list<Upload>("upload:").map(([, u]) => u);
    requireThat(
      pending.length < MAX_PENDING &&
        pending.reduce((sum, u) => sum + (u.size ?? u.max), 0) + input.size <=
          MAX_PENDING_BYTES,
      "too_many_uploads",
      "Too many uploads are waiting. Stage or publish the ones you sent, or wait an hour for unused ones to expire.",
      429,
    );
    const token = randomToken(),
      upload: Upload = {
        id: crypto.randomUUID(),
        path: input.path ? safePath(input.path) : undefined,
        archive: !!input.archive,
        max: input.size,
        created: this.now(),
        expires: this.now() + UPLOAD_LINK_MS,
      };
    this.store.put("upload:" + upload.id, upload);
    this.store.put("upload-token:" + (await sha256(token)), upload.id);
    return {
      upload_id: upload.id,
      upload_url: this.origin + "/upload/" + token,
      method: "PUT",
      max_bytes: input.size,
      expires_in_seconds: UPLOAD_LINK_MS / 1000,
      how: "Send the raw file bytes once, e.g. curl -sS -X PUT --data-binary @FILE 'UPLOAD_URL'. Then pass upload_id in `uploads` to stage_project or publish_project.",
    };
  }
  async receive(token: string, body: ReadableStream<Uint8Array> | null) {
    const tokenKey = "upload-token:" + (await sha256(token)),
      id = this.store.get<string>(tokenKey),
      upload = id ? this.store.get<Upload>("upload:" + id) : undefined;
    requireThat(
      upload && !upload.received && upload.expires > this.now(),
      "unauthorized",
      "The upload link is invalid, already used or expired. Create a new one with create_upload.",
      401,
    );
    // Single use: the link is spent even if the body turns out too large.
    this.store.delete(tokenKey);
    const bytes = await readBounded(body, upload.max);
    requireThat(bytes.length, "empty_body", "The upload was empty.");
    const digest = await sha256(bytes);
    this.store.transaction(() => {
      for (let at = 0, part = 0; at < bytes.length; at += LIMITS.chunkBytes)
        this.store.putChunk(
          "upload:" + upload.id,
          part++,
          bytes.slice(at, at + LIMITS.chunkBytes),
        );
      this.store.put("upload:" + upload.id, {
        ...upload,
        received: this.now(),
        size: bytes.length,
        sha256: digest,
      });
    });
    return {
      upload_id: upload.id,
      size: bytes.length,
      sha256: digest,
      next: "Pass this upload_id in `uploads` to stage_project or publish_project.",
    };
  }
  // Files from received uploads, keyed by project path. Uploads stay until discard().
  async files(ids: string[]) {
    const files = new Map<string, Uint8Array>();
    for (const id of new Set(ids)) {
      const upload = this.store.get<Upload>("upload:" + id);
      requireThat(
        upload?.received,
        "upload_missing",
        "That upload was not received or has expired. Create a new upload link and send the file again.",
        404,
      );
      const bytes = new Uint8Array(upload.size!);
      for (let at = 0, part = 0; at < bytes.length; at += LIMITS.chunkBytes) {
        const chunk = this.store.chunk("upload:" + id, part++);
        requireThat(chunk, "upload_missing", "The upload is incomplete.", 404);
        bytes.set(chunk, at);
      }
      const entries = upload.archive
        ? await unzip(new Response(bytes).body)
        : new Map([[upload.path!, bytes]]);
      for (const [path, content] of entries) {
        requireThat(
          !files.has(path),
          "invalid_input",
          `Two uploads contain ${path}.`,
        );
        files.set(path, content);
      }
    }
    return files;
  }
  discard(ids: string[]) {
    for (const id of ids) {
      this.store.deleteChunks("upload:" + id);
      this.store.delete("upload:" + id);
    }
  }
  collect() {
    for (const [, upload] of this.store.list<Upload>("upload:"))
      if (this.now() - upload.created >= UPLOAD_KEEP_MS)
        this.discard([upload.id]);
    for (const [key, id] of this.store.list<string>("upload-token:"))
      if (!this.store.get("upload:" + id)) this.store.delete(key);
  }
}
