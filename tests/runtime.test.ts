import { test } from "node:test";
import assert from "node:assert/strict";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { zipSync } from "fflate";
import { sha256 } from "../src/types";
const origin = "https://publisher.test";
async function start(extra: Record<string, string> = {}) {
  return new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: "dist/worker.js",
      compatibilityDate: "2026-09-01",
      compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
      durableObjects: {
        PUBLISHER: { className: "Publisher", useSQLite: true },
      },
      kvNamespaces: ["OAUTH_KV"],
      bindings: {
        PUBLISHER_ORIGIN: origin,
        ACCOUNT_ID: "test",
        ACCOUNT_SUBDOMAIN: "test",
        INSTALLATION_ID: "test-installation",
        RELEASE_VERSION: "0.1.0",
        CHATGPT_CALLBACKS: '["https://chatgpt.example/callback"]',
        FILE_DOWNLOAD_HOSTS: "[]",
        CREDENTIAL_KEY: "11".repeat(32),
        SETUP_TOKEN_HASH: await sha256("setup-token"),
        SETUP_EXPIRES_AT: String(Date.now() + 60000),
        ...extra,
      },
    }),
  );
}
async function challengeFor(verifier: string) {
  return Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  ).toString("base64url");
}
// After consent the Publisher returns a page that refreshes to the client's callback, not a 302,
// so a callback that redirects again to another origin isn't blocked by CSP form-action.
function clientReturn(r: {
  status: number;
  headers: { get(name: string): string | null };
}) {
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Location"), null);
  assert.match(
    r.headers.get("content-security-policy")!,
    /form-action 'self';/,
  );
  const refresh = r.headers.get("Refresh")!.match(/^0; url=(.+)$/)!;
  return new URL(refresh[1]);
}
test("real Worker + SQLite DO: setup, owner UI, sibling isolation, protected MCP and OAuth registration", async () => {
  const mf = await start();
  try {
    const call = (
      path: string,
      init: NonNullable<Parameters<Miniflare["dispatchFetch"]>[1]> = {},
    ) => mf.dispatchFetch(origin + path, { ...init, redirect: "manual" });
    let r = await call("/");
    assert.equal(r.status, 303);
    r = await call("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Publisher-Owner-Epoch": "forged",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(r.status, 401);
    assert.match(r.headers.get("www-authenticate")!, /resource_metadata/);
    r = await call("/download/invalid");
    assert.equal(r.status, 401);
    r = await call("/setup", {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        token: "setup-token",
        password: "a secure owner password",
      }),
    });
    assert.equal(r.status, 303);
    const cookie = r.headers.get("set-cookie")!.split(";")[0];
    assert.match(cookie, /^__Host-publisher=/);
    r = await call("/", { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /Public projects/);
    assert.doesNotMatch(html, /a secure owner password/);
    const csrf = html.match(/name="csrf" value="([^"]+)"/)![1];
    r = await call("/logout", {
      method: "POST",
      headers: {
        Origin: "https://site.test",
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrf }),
    });
    assert.equal(r.status, 403);
    r = await call("/logout", {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrf: "forged" }),
    });
    assert.equal(r.status, 403);
    r = await call("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "attacker",
        redirect_uris: ["https://attacker.example/callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    assert.equal(r.status, 400);
    r = await call("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "local client",
        redirect_uris: ["http://localhost:53682/callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    assert.equal(r.status, 400);
    assert.match(await r.text(), /AI connections/);
    r = await call("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    assert.equal(r.status, 201);
    r = await call("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Test ChatGPT",
        redirect_uris: ["https://chatgpt.example/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    assert.equal(r.status, 201);
    const client = (await r.json()) as { client_id: string };
    const verifier = "a".repeat(43),
      challenge = await challengeFor(verifier);
    const authQuery = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: "https://chatgpt.example/callback",
      response_type: "code",
      resource: origin + "/mcp",
      scope: "projects:read projects:write",
      state: "some-state",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    // Exercise the real sign-in handoff, not only a preauthenticated consent page.
    r = await call("/authorize?" + authQuery);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /name="return_to"/);
    r = await call("/login", {
      method: "POST",
      headers: {
        Origin: origin,
        Accept: "text/html",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        password: "a secure owner password",
        return_to: "/authorize?" + authQuery,
      }),
    });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get("location"), "/authorize?" + authQuery);
    const loginCookie = r.headers.get("set-cookie")!.split(";")[0];
    r = await call("/authorize?" + authQuery, {
      headers: { Cookie: loginCookie },
    });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /Allow project access/);
    r = await call("/login", {
      method: "POST",
      headers: {
        Origin: origin,
        Accept: "text/html",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        password: "wrong password",
        return_to: "/authorize?" + authQuery,
      }),
    });
    assert.equal(r.status, 401);
    const retryHtml = await r.text();
    assert.match(retryHtml, /Incorrect password/);
    assert.match(retryHtml, /name="return_to"/);
    assert.match(retryHtml, /type="password"/);
    assert.doesNotMatch(retryHtml, /wrong password/);
    for (const resources of [
      [origin],
      [origin + "/mcp/"],
      [origin + "/mcp", origin],
    ]) {
      const wrongTarget = new URLSearchParams(authQuery);
      wrongTarget.delete("resource");
      for (const resource of resources)
        wrongTarget.append("resource", resource);
      r = await call("/authorize?" + wrongTarget, {
        headers: { Cookie: cookie, Accept: "text/html" },
      });
      assert.equal(r.status, 400);
      const targetError = await r.text();
      assert.match(targetError, /invalid_target/);
      assert.match(
        targetError,
        /The resource parameter must name exactly one configured protected resource/,
      );
    }
    const invalidAuth = new URLSearchParams(authQuery);
    invalidAuth.set("client_id", "not-yet-visible");
    r = await call("/authorize?" + invalidAuth, {
      headers: { Cookie: cookie, Accept: "text/html" },
    });
    assert.equal(r.status, 400);
    const connectionError = await r.text();
    assert.match(connectionError, /Invalid client_id/);
    assert.match(connectionError, /Retry connecting your AI client/);
    assert.doesNotMatch(connectionError, /The operation could not complete/);
    r = await call("/authorize?" + authQuery, { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    const consentHtml = await r.text();
    assert.match(consentHtml, /Connect your AI client/);
    assert.doesNotMatch(consentHtml, /class="warning"/);
    const handle = consentHtml.match(/name="handle" value="([^"]+)"/)![1],
      consentCookie = r.headers.get("set-cookie")!.split(";")[0];
    r = await call("/authorize", {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie + "; " + consentCookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrf, handle, decision: "approve" }),
    });
    const code = clientReturn(r).searchParams.get("code")!;
    r = await call("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client.client_id,
        code,
        code_verifier: verifier,
        redirect_uri: "https://chatgpt.example/callback",
        resource: origin + "/mcp",
      }),
    });
    assert.equal(r.status, 200);
    const token = (await r.json()) as { access_token: string };
    async function mcp(method: string, params?: unknown) {
      const response = await call("/mcp", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token.access_token,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      assert.equal(response.status, 200);
      return response.json() as Promise<any>;
    }
    const tools = await mcp("tools/list");
    assert.equal(tools.result.tools.length, 12);
    r = await call("/mcp", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token.access_token,
        Origin: "https://muse.ai",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(r.status, 200, "a foreign Origin is fine with a bearer token");
    r = await call("/mcp", {
      headers: {
        Authorization: "Bearer " + token.access_token,
        Accept: "text/event-stream",
      },
    });
    assert.equal(r.status, 405, "no standalone SSE stream to retry");
    assert.equal(r.headers.get("Allow"), "POST");
    r = await call("/", { headers: { Origin: "https://muse.ai" } });
    assert.equal(
      r.status,
      403,
      "cookie-based pages still refuse a foreign Origin",
    );
    for (const t of tools.result.tools) {
      assert.ok(t.title, t.name + " needs a title");
      assert.equal(typeof t.annotations.readOnlyHint, "boolean");
      if (!t.annotations.readOnlyHint)
        assert.equal(typeof t.annotations.destructiveHint, "boolean");
    }
    const staged = await mcp("tools/call", {
      name: "stage_project",
      arguments: {
        name: "runtime-test",
        base_revision: null,
        files: { "index.html": "<h1>hello</h1>" },
      },
    });
    assert.equal(staged.result.isError, undefined);
    const candidate = JSON.parse(staged.result.content[0].text);
    assert.ok(candidate.id);
    const read = await mcp("tools/call", {
      name: "read_files",
      arguments: {
        project: candidate.project,
        revision: candidate.id,
        path: "index.html",
      },
    });
    assert.equal(
      JSON.parse(read.result.content[0].text).text,
      "<h1>hello</h1>",
    );
    const exported = await mcp("tools/call", {
      name: "export_project",
      arguments: { project: candidate.project, revision: candidate.id },
    });
    const link = JSON.parse(exported.result.content[0].text).download_url;
    r = await mf.dispatchFetch(link);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/zip");
    assert.ok((await r.arrayBuffer()).byteLength > 20);
    r = await call("/setup", {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        token: "setup-token",
        password: "a secure owner password",
      }),
    });
    assert.equal(r.status, 403);
  } finally {
    await mf.dispose();
  }
});
test("loopback callbacks: opt-in registration, consent warning and code exchange", async () => {
  const mf = await start({ ALLOW_LOOPBACK_CALLBACKS: "true" }),
    callback = "http://127.0.0.1:53682/callback";
  try {
    const call = (
      path: string,
      init: NonNullable<Parameters<Miniflare["dispatchFetch"]>[1]> = {},
    ) => mf.dispatchFetch(origin + path, { ...init, redirect: "manual" });
    let r = await call("/setup", {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        token: "setup-token",
        password: "a secure owner password",
      }),
    });
    assert.equal(r.status, 303);
    const cookie = r.headers.get("set-cookie")!.split(";")[0];
    r = await call("/", { headers: { Cookie: cookie } });
    const csrf = (await r.text()).match(/name="csrf" value="([^"]+)"/)![1];
    r = await call("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Local client",
        redirect_uris: [callback],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    assert.equal(r.status, 201);
    const client = (await r.json()) as { client_id: string },
      verifier = "b".repeat(43);
    const authQuery = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: callback,
      response_type: "code",
      resource: origin + "/mcp",
      scope: "projects:read projects:write",
      state: "some-state",
      code_challenge: await challengeFor(verifier),
      code_challenge_method: "S256",
    });
    r = await call("/authorize?" + authQuery, { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    assert.match(
      r.headers.get("content-security-policy")!,
      /form-action 'self';/,
    );
    const consentHtml = await r.text();
    assert.match(consentHtml, /class="warning"/);
    assert.match(consentHtml, /a program on the computer you are using now/);
    const handle = consentHtml.match(/name="handle" value="([^"]+)"/)![1],
      consentCookie = r.headers.get("set-cookie")!.split(";")[0];
    r = await call("/authorize", {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie + "; " + consentCookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrf, handle, decision: "approve" }),
    });
    const location = clientReturn(r);
    assert.equal(location.origin + location.pathname, callback);
    r = await call("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client.client_id,
        code: location.searchParams.get("code")!,
        code_verifier: verifier,
        redirect_uri: callback,
        resource: origin + "/mcp",
      }),
    });
    assert.equal(r.status, 200);
  } finally {
    await mf.dispose();
  }
});
test("AI connections: owner turns on local sign-in, sees the client, and revokes it", async () => {
  const mf = await start(),
    callback = "http://localhost:53682/callback";
  try {
    const call = (
      path: string,
      init: NonNullable<Parameters<Miniflare["dispatchFetch"]>[1]> = {},
    ) => mf.dispatchFetch(origin + path, { ...init, redirect: "manual" });
    const post = (
      path: string,
      cookie: string,
      fields: Record<string, string>,
    ) =>
      call(path, {
        method: "POST",
        headers: {
          Origin: origin,
          Cookie: cookie,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(fields),
      });
    let r = await post("/setup", "", {
      token: "setup-token",
      password: "a secure owner password",
    });
    const cookie = r.headers.get("set-cookie")!.split(";")[0];
    r = await call("/", { headers: { Cookie: cookie } });
    let html = await r.text();
    const csrf = html.match(/name="csrf" value="([^"]+)"/)![1];
    assert.match(html, /AI connections/);
    assert.match(html, /No AI app is connected yet/);
    const register = () =>
      call("/oauth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Claude Code",
          redirect_uris: [callback],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        }),
      });
    assert.equal((await register()).status, 400);
    r = await call("/", { headers: { Cookie: cookie } });
    html = await r.text();
    assert.match(html, /Last refused sign-in/);
    assert.match(html, /http:\/\/localhost:53682\/callback/);
    r = await post("/connections/local", cookie, { csrf, enabled: "true" });
    assert.equal(r.status, 303);
    r = await register();
    assert.equal(r.status, 201);
    const client = (await r.json()) as { client_id: string },
      verifier = "c".repeat(43);
    r = await call(
      "/authorize?" +
        new URLSearchParams({
          client_id: client.client_id,
          redirect_uri: callback,
          response_type: "code",
          resource: origin + "/mcp",
          scope: "projects:read projects:write",
          state: "s",
          code_challenge: await challengeFor(verifier),
          code_challenge_method: "S256",
        }),
      { headers: { Cookie: cookie } },
    );
    const handle = (await r.text()).match(/name="handle" value="([^"]+)"/)![1],
      consentCookie = r.headers.get("set-cookie")!.split(";")[0];
    r = await post("/authorize", cookie + "; " + consentCookie, {
      csrf,
      handle,
      decision: "approve",
    });
    const code = clientReturn(r).searchParams.get("code")!;
    r = await call("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client.client_id,
        code,
        code_verifier: verifier,
        redirect_uri: callback,
        resource: origin + "/mcp",
      }),
    });
    const { access_token } = (await r.json()) as { access_token: string };
    const tools = () =>
      call("/mcp", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + access_token,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
    assert.equal((await tools()).status, 200);
    r = await call("/", { headers: { Cookie: cookie } });
    html = await r.text();
    assert.match(html, /Claude Code/);
    assert.match(html, /an app on your computer \(localhost\)/);
    assert.match(html, /last used/);
    const grant = html.match(
      /action="\/connections\/revoke"><input type="hidden" name="csrf" value="[^"]+"><input type="hidden" name="grant" value="([^"]+)"/,
    )![1];
    r = await post("/connections/revoke", cookie, { csrf, grant });
    assert.equal(r.status, 303);
    assert.equal((await tools()).status, 401);
    r = await call("/", { headers: { Cookie: cookie } });
    assert.match(await r.text(), /No AI app is connected yet/);
    r = await post("/connections/local", cookie, { csrf, enabled: "false" });
    assert.equal((await register()).status, 400);
  } finally {
    await mf.dispose();
  }
});
test("owner changes the password: other browsers and AI apps are signed out", async () => {
  const mf = await start(),
    callback = "https://chatgpt.example/callback";
  try {
    const call = (
      path: string,
      init: NonNullable<Parameters<Miniflare["dispatchFetch"]>[1]> = {},
    ) => mf.dispatchFetch(origin + path, { ...init, redirect: "manual" });
    const post = (
      path: string,
      cookie: string,
      fields: Record<string, string>,
    ) =>
      call(path, {
        method: "POST",
        headers: {
          Origin: origin,
          Cookie: cookie,
          Accept: "text/html",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(fields),
      });
    let r = await post("/setup", "", {
      token: "setup-token",
      password: "a secure owner password",
    });
    const cookie = r.headers.get("set-cookie")!.split(";")[0];
    r = await post("/login", "", { password: "a secure owner password" });
    const otherBrowser = r.headers.get("set-cookie")!.split(";")[0];
    r = await call("/", { headers: { Cookie: cookie } });
    let html = await r.text();
    const csrf = html.match(/name="csrf" value="([^"]+)"/)![1];
    assert.match(html, /Change Publisher login password/);
    r = await call("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Test ChatGPT",
        redirect_uris: [callback],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    const client = (await r.json()) as { client_id: string },
      verifier = "d".repeat(43);
    r = await call(
      "/authorize?" +
        new URLSearchParams({
          client_id: client.client_id,
          redirect_uri: callback,
          response_type: "code",
          resource: origin + "/mcp",
          scope: "projects:read projects:write",
          state: "s",
          code_challenge: await challengeFor(verifier),
          code_challenge_method: "S256",
        }),
      { headers: { Cookie: cookie } },
    );
    const handle = (await r.text()).match(/name="handle" value="([^"]+)"/)![1],
      consentCookie = r.headers.get("set-cookie")!.split(";")[0];
    r = await post("/authorize", cookie + "; " + consentCookie, {
      csrf,
      handle,
      decision: "approve",
    });
    const code = clientReturn(r).searchParams.get("code")!;
    r = await call("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client.client_id,
        code,
        code_verifier: verifier,
        redirect_uri: callback,
        resource: origin + "/mcp",
      }),
    });
    const { access_token } = (await r.json()) as { access_token: string };
    const tools = () =>
      call("/mcp", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + access_token,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
    assert.equal((await tools()).status, 200);

    r = await post("/password", cookie, {
      csrf,
      current: "wrong password",
      password: "a fresh owner password",
    });
    assert.equal(r.status, 401);
    assert.match(await r.text(), /Incorrect password/);
    assert.equal((await tools()).status, 200, "a failed change keeps access");
    r = await post("/password", cookie, {
      current: "a secure owner password",
      password: "a fresh owner password",
    });
    assert.equal(r.status, 403, "CSRF token required");

    r = await post("/password", cookie, {
      csrf,
      current: "a secure owner password",
      password: "a fresh owner password",
    });
    assert.equal(r.status, 303);
    const newCookie = r.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await tools()).status, 401);
    for (const stale of [cookie, otherBrowser]) {
      r = await call("/", { headers: { Cookie: stale } });
      assert.equal(r.status, 303);
      assert.equal(r.headers.get("location"), "/login");
    }
    r = await call("/", { headers: { Cookie: newCookie } });
    html = await r.text();
    assert.match(html, /Change Publisher login password/);
    assert.match(html, /No AI app is connected yet/);
    r = await post("/login", "", { password: "a secure owner password" });
    assert.equal(r.status, 401);
    r = await post("/login", "", { password: "a fresh owner password" });
    assert.equal(r.status, 303);
  } finally {
    await mf.dispose();
  }
});
test("Claude registers as a confidential client and completes sign-in with its secret", async () => {
  const mf = await start(),
    callback = "https://claude.ai/api/mcp/auth_callback";
  try {
    const call = (
      path: string,
      init: NonNullable<Parameters<Miniflare["dispatchFetch"]>[1]> = {},
    ) => mf.dispatchFetch(origin + path, { ...init, redirect: "manual" });
    const form = (cookie: string, fields: Record<string, string>) => ({
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(fields),
    });
    let r = await call(
      "/setup",
      form("", { token: "setup-token", password: "a secure owner password" }),
    );
    const cookie = r.headers.get("set-cookie")!.split(";")[0];
    const csrf = (
      await (await call("/", { headers: { Cookie: cookie } })).text()
    ).match(/name="csrf" value="([^"]+)"/)![1];
    r = await call("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: [callback],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
      }),
    });
    assert.equal(r.status, 201);
    const client = (await r.json()) as {
      client_id: string;
      client_secret: string;
    };
    assert.ok(client.client_secret);
    const verifier = "d".repeat(43);
    r = await call(
      "/authorize?" +
        new URLSearchParams({
          client_id: client.client_id,
          redirect_uri: callback,
          response_type: "code",
          resource: origin + "/mcp",
          scope: "projects:read projects:write",
          state: "s",
          code_challenge: await challengeFor(verifier),
          code_challenge_method: "S256",
        }),
      { headers: { Cookie: cookie } },
    );
    assert.equal(r.status, 200);
    const handle = (await r.text()).match(/name="handle" value="([^"]+)"/)![1],
      consentCookie = r.headers.get("set-cookie")!.split(";")[0];
    r = await call(
      "/authorize",
      form(cookie + "; " + consentCookie, {
        csrf,
        handle,
        decision: "approve",
      }),
    );
    const location = clientReturn(r);
    assert.equal(location.origin + location.pathname, callback);
    const exchange = (secret: string) =>
      call("/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: client.client_id,
          client_secret: secret,
          code: location.searchParams.get("code")!,
          code_verifier: verifier,
          redirect_uri: callback,
          resource: origin + "/mcp",
        }),
      });
    assert.equal((await exchange("wrong-secret")).status, 401);
    assert.equal((await exchange(client.client_secret)).status, 200);
  } finally {
    await mf.dispose();
  }
});
test("upload links: binary file and ZIP reach a draft without passing through MCP", async () => {
  const mf = await start(),
    callback = "https://chatgpt.example/callback";
  try {
    const call = (
      path: string,
      init: NonNullable<Parameters<Miniflare["dispatchFetch"]>[1]> = {},
    ) => mf.dispatchFetch(origin + path, { ...init, redirect: "manual" });
    const form = (cookie: string, fields: Record<string, string>) => ({
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(fields),
    });
    let r = await call(
      "/setup",
      form("", { token: "setup-token", password: "a secure owner password" }),
    );
    const cookie = r.headers.get("set-cookie")!.split(";")[0];
    const csrf = (
      await (await call("/", { headers: { Cookie: cookie } })).text()
    ).match(/name="csrf" value="([^"]+)"/)![1];
    r = await call("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [callback],
        token_endpoint_auth_method: "none",
      }),
    });
    const client = (await r.json()) as { client_id: string },
      verifier = "e".repeat(43);
    r = await call(
      "/authorize?" +
        new URLSearchParams({
          client_id: client.client_id,
          redirect_uri: callback,
          response_type: "code",
          resource: origin + "/mcp",
          scope: "projects:read projects:write",
          state: "s",
          code_challenge: await challengeFor(verifier),
          code_challenge_method: "S256",
        }),
      { headers: { Cookie: cookie } },
    );
    const handle = (await r.text()).match(/name="handle" value="([^"]+)"/)![1];
    r = await call(
      "/authorize",
      form(cookie + "; " + r.headers.get("set-cookie")!.split(";")[0], {
        csrf,
        handle,
        decision: "approve",
      }),
    );
    r = await call("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client.client_id,
        code: clientReturn(r).searchParams.get("code")!,
        code_verifier: verifier,
        redirect_uri: callback,
        resource: origin + "/mcp",
      }),
    });
    const { access_token } = (await r.json()) as { access_token: string };
    const tool = async (name: string, args: unknown) => {
      const response = await call("/mcp", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + access_token,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      });
      const result = ((await response.json()) as any).result;
      return {
        error: result.isError === true,
        body: JSON.parse(result.content[0].text),
      };
    };
    const put = (url: string, bytes: Uint8Array) =>
      mf.dispatchFetch(url, { method: "PUT", body: bytes });

    const png = new Uint8Array(700 * 1024).map((_, i) => (i * 7 + 0x89) % 256);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    let link = await tool("create_upload", {
      path: "images/cake.png",
      size: png.length,
    });
    assert.equal(link.error, false);
    assert.match(link.body.upload_url, /^https:\/\/publisher\.test\/upload\//);
    r = await put(link.body.upload_url, png);
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as { size: number }).size, png.length);
    r = await put(link.body.upload_url, png);
    assert.equal(r.status, 401, "links are single-use");
    const staged = await tool("stage_project", {
      name: "upload-test",
      base_revision: null,
      files: { "index.html": '<img src="images/cake.png">' },
      uploads: [link.body.upload_id],
    });
    assert.equal(staged.error, false);
    assert.equal(staged.body.files["images/cake.png"].size, png.length);
    const again = await tool("stage_project", {
      project: staged.body.project,
      candidate: staged.body.id,
      base_revision: null,
      uploads: [link.body.upload_id],
    });
    assert.equal(again.error, true, "a staged upload is consumed");

    const zip = zipSync({
      "index.html": new TextEncoder().encode("<h1>from zip</h1>"),
      "logo.svg": new TextEncoder().encode("<svg/>"),
    });
    link = await tool("create_upload", { archive: true, size: zip.length });
    r = await put(link.body.upload_url, zip);
    assert.equal(r.status, 200);
    const fromZip = await tool("stage_project", {
      name: "zip-test",
      base_revision: null,
      uploads: [link.body.upload_id],
    });
    assert.equal(fromZip.error, false);
    assert.deepEqual(Object.keys(fromZip.body.files).sort(), [
      "index.html",
      "logo.svg",
    ]);

    link = await tool("create_upload", { path: "big.bin", size: 4 });
    r = await put(link.body.upload_url, new Uint8Array(5));
    assert.equal(r.status, 413, "bytes beyond the declared size are refused");
    assert.equal(
      (await tool("create_upload", { path: "x.bin", size: 11 * 1024 * 1024 }))
        .error,
      true,
    );
    assert.equal(
      (
        await tool("stage_project", {
          name: "no-file",
          base_revision: null,
          file_path: "zwetschenkuchen.svg",
        })
      ).error,
      true,
      "file_path without an attached file is refused",
    );
    r = await mf.dispatchFetch(origin + "/upload/not-a-token", {
      method: "PUT",
      body: "x",
    });
    assert.equal(r.status, 401);
  } finally {
    await mf.dispose();
  }
});
