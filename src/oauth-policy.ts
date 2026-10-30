import type { Env } from "./types";

// Hosted AI clients every Publisher accepts, so an update fixes installs whose Worker variables predate a client.
export const BUILT_IN_CALLBACKS = [
  "https://chatgpt.com/connector_platform_oauth_redirect",
  "https://claude.ai/api/mcp/auth_callback",
  "https://antigravity.google/oauth-callback",
  "https://agent.meta.ai/api/hatch/oauth/callback",
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

// Hosted clients may register with a client secret (Claude does; an omitted method means
// client_secret_basic). Apps on loopback callbacks are public clients (RFC 8252 §8.4).
// PKCE S256 is required at /authorize either way.
const HOSTED_AUTH_METHODS = [
  undefined,
  "none",
  "client_secret_basic",
  "client_secret_post",
];
export function registrationAllowed(
  metadata: Record<string, unknown>,
  allowed: string[],
  loopback: boolean,
) {
  const uris = metadata.redirect_uris;
  if (
    !Array.isArray(uris) ||
    !uris.length ||
    !uris.every(
      (uri) =>
        typeof uri === "string" && callbackAllowed(uri, allowed, loopback),
    )
  )
    return false;
  const method = metadata.token_endpoint_auth_method;
  return uris.some((uri) => loopbackCallback(uri))
    ? method === "none"
    : HOSTED_AUTH_METHODS.includes(method as string | undefined);
}
