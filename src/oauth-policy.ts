import type { Env } from "./types";

// Hosted AI clients every Publisher accepts, so an update fixes installs whose Worker variables predate a client.
export const BUILT_IN_CALLBACKS = [
  "https://chatgpt.com/connector_platform_oauth_redirect",
  "https://claude.ai/api/mcp/auth_callback",
];
export function callbacks(env: Env): string[] {
  // CHATGPT_CALLBACKS is the pre-0.1.14 name; updates inherit Worker variables, so older installs still carry it.
  const parsed: unknown = JSON.parse(
    env.ALLOWED_CALLBACKS ?? env.CHATGPT_CALLBACKS ?? "[]",
  );
  const extra = Array.isArray(parsed)
    ? parsed.filter(
        (s): s is string => typeof s === "string" && s.startsWith("https://"),
      )
    : [];
  return [...new Set([...BUILT_IN_CALLBACKS, ...extra])];
}

// Native clients such as Claude Code listen on a random loopback port (RFC 8252 §7.3).
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export function loopbackCallback(uri: string) {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  return (
    url.protocol === "http:" &&
    LOOPBACK_HOSTS.includes(url.hostname) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.href === uri
  );
}

export function callbackAllowed(
  uri: string,
  allowed: string[],
  loopback: boolean,
) {
  return allowed.includes(uri) || (loopback && loopbackCallback(uri));
}

export function registrationAllowed(
  metadata: Record<string, unknown>,
  allowed: string[],
  loopback: boolean,
) {
  return (
    Array.isArray(metadata.redirect_uris) &&
    metadata.redirect_uris.length > 0 &&
    metadata.redirect_uris.every(
      (uri) =>
        typeof uri === "string" && callbackAllowed(uri, allowed, loopback),
    ) &&
    metadata.token_endpoint_auth_method === "none"
  );
}
