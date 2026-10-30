import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  compareVersions,
  verifyRelease,
  type SignedRelease,
} from "../src/releases";

test("archived public releases retain valid signatures and matching checksums", async () => {
  const config = JSON.parse(await readFile("wrangler.installer.jsonc", "utf8"));
  const versions = (await readdir("public/releases")).filter((name) =>
    /^\d+\.\d+\.\d+$/.test(name),
  );
  assert.ok(versions.includes("0.1.0"));
  for (const version of versions) {
    const directory = `public/releases/${version}`;
    const signed: SignedRelease = JSON.parse(
      await readFile(`${directory}/release.json`, "utf8"),
    );
    const bytes = new Uint8Array(await readFile(`${directory}/worker.js`));
    const manifest = await verifyRelease(
      signed,
      new Map([["worker.js", bytes]]),
      config.vars.RELEASE_PUBLIC_KEY,
    );
    assert.equal(manifest.version, version);
    assert.equal(
      await readFile(`${directory}/SHA256SUMS`, "utf8"),
      `${manifest.modules[0].sha256}  worker.js\n`,
    );
  }
});
test("the release channel serves the newest archived release and the installer follows it", async () => {
  const config = JSON.parse(await readFile("wrangler.installer.jsonc", "utf8"));
  assert.equal(
    config.vars.RELEASE_BASE_URL,
    config.vars.INSTALLER_ORIGIN + "/releases/",
  );
  const newest = (await readdir("public/releases"))
    .filter((name) => /^\d+\.\d+\.\d+$/.test(name))
    .sort(compareVersions)
    .at(-1)!;
  for (const file of ["release.json", "worker.js", "SHA256SUMS"])
    assert.deepEqual(
      await readFile(`public/releases/${file}`),
      await readFile(`public/releases/${newest}/${file}`),
      file,
    );
});
test("the Claude and Antigravity plugins share one skill, apart from the upload note", async () => {
  // Each client's note on where curl runs is the only paragraph allowed to differ.
  const skill = async (dir: string) =>
    (await readFile(`${dir}/skills/publish-website/SKILL.md`, "utf8"))
      .split("\n\n")
      .filter((p) => !/^(On claude\.ai|Run `curl`)/.test(p));
  assert.deepEqual(await skill("antigravity"), await skill("plugin"));
});
