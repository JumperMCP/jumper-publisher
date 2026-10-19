import {
  callbacks,
  loopbackCallback,
  registrationAllowed,
} from "./oauth-policy";
export { callbacks };
import {
  OAuthProvider,
  getOAuthApi,
  type OAuthProviderOptions,
} from "@cloudflare/workers-oauth-provider";
import { requireThat, type Env } from "./types";
export const SCOPES = ["projects:read", "projects:write"];
// Local AI clients (e.g. Claude Code) sign in through http://localhost callbacks. Off until the owner turns it on
// in the cockpit; ALLOW_LOOPBACK_CALLBACKS=true on the Worker forces it on (0.1.13 behavior).
export function loopbackForced(env: Env) {
  return env.ALLOW_LOOPBACK_CALLBACKS === "true";
}
async function loopbackEnabled(env: Env) {
  return (
    loopbackForced(env) ||
    (await env.PUBLISHER.get(
      env.PUBLISHER.idFromName("installation"),
    ).localSignInAllowed())
  );
}

async function registrationError(metadata: Record<string, unknown>, env: Env) {
  const loopback = await loopbackEnabled(env);
  if (registrationAllowed(metadata, callbacks(env), loopback)) return undefined;
  await env.PUBLISHER.get(
    env.PUBLISHER.idFromName("installation"),
  ).noteRefusedRegistration(metadata);
  const uris = metadata.redirect_uris;
  if (
    !loopback &&
    Array.isArray(uris) &&
    uris.some((uri) => typeof uri === "string" && loopbackCallback(uri))
  )
    return {
      description:
        "Sign-in from AI apps on your own computer (localhost callbacks), such as Claude Code, is turned off. The Publisher owner can turn it on in the Publisher control panel under AI connections.",
    };
  return {
    description:
      "Only the verified ChatGPT and Claude callbacks, or localhost callbacks (public clients) when enabled, are accepted. The Publisher owner can see this refused sign-in under AI connections.",
  };
}

function options(env: Env): OAuthProviderOptions<Env> {
  return {
    apiRoute: "/mcp",
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    scopesSupported: SCOPES,
    requiredScopes: SCOPES,
    resourceMetadata: {
      resource: env.PUBLISHER_ORIGIN + "/mcp",
      authorization_servers: [env.PUBLISHER_ORIGIN],
    },
    clientIdMetadataDocumentEnabled: false,
    clientRegistrationCallback: ({ clientMetadata }) =>
      registrationError(clientMetadata, env),
    onError: () => {},
    apiHandler: {
      async fetch(request, bindings, ctx) {
        const context = ctx as typeof ctx & {
          props: { ownerEpoch?: string };
          auth: { scope: string[]; clientId?: string };
        };
        requireThat(
          SCOPES.every((scope) => context.auth.scope.includes(scope)),
          "insufficient_scope",
          "Reconnect and consent to project read and publish access.",
          403,
        );
        const headers = new Headers(request.headers);
        headers.set("X-Publisher-Owner-Epoch", context.props.ownerEpoch ?? "");
        headers.set("X-Publisher-Client", context.auth.clientId ?? "");
        return bindings.PUBLISHER.get(
          bindings.PUBLISHER.idFromName("installation"),
        ).fetch(new Request(request, { headers }));
      },
    },
    defaultHandler: {
      async fetch(request, bindings) {
        const headers = new Headers(request.headers);
        headers.delete("X-Publisher-Owner-Epoch");
        headers.delete("X-Publisher-Client");
        return bindings.PUBLISHER.get(
          bindings.PUBLISHER.idFromName("installation"),
        ).fetch(new Request(request, { headers }));
      },
    },
  };
}
export function provider(env: Env) {
  return new OAuthProvider<Env>(options(env));
}
export function oauthHelpers(env: Env) {
  return getOAuthApi(options(env), env);
}
