# 0.1.14 — Claude connectors and per-app access

- **Claude on the web, Desktop and mobile can connect.** The Claude connector callback `https://claude.ai/api/mcp/auth_callback` is now built in, next to the ChatGPT callback. Both are part of the code, so an update enables them even when the Worker variables are older than this release.
- **`CHATGPT_CALLBACKS` is renamed `ALLOWED_CALLBACKS`.** It now only adds extra callbacks to the built-in ones. Existing installs keep their `CHATGPT_CALLBACKS` value, and it is still read when `ALLOWED_CALLBACKS` is not set.
- **AI connections panel.** The cockpit panel "ChatGPT connection" is now "AI connections". It lists every connected AI app with where it signs in from, the approval date and the last use, and has a **Revoke** button for each one. Revoking signs out that app only. Resetting the password still signs out all of them.
- **Sign-in from apps on your computer is a cockpit switch.** Claude Code and other local apps sign in through a `localhost` callback. The owner can now turn this on and off under AI connections → AI apps on this computer. The `ALLOW_LOOPBACK_CALLBACKS=true` Worker variable still forces it on.
- **Tool titles.** Every MCP tool now has a human-readable title, which the Claude connector directory requires.

No migration, credential, or origin changes.

# 0.1.13 — opt-in sign-in for local AI clients

The Publisher can now accept sign-in from MCP clients that run on your own computer, such as coding agents in a terminal. These clients receive the sign-in result on a `localhost` address with a changing port. This is off by default. To turn it on, set the text variable `ALLOW_LOOPBACK_CALLBACKS` to `true` in the Publisher Worker's Cloudflare settings (Settings → Variables and Secrets). Publisher updates keep this setting.

When it is on, loopback callbacks (`http://localhost`, `127.0.0.1`, `[::1]`, any port) are accepted at registration, on the approval page and at approval. The rules are unchanged otherwise: public client, PKCE S256, and no credentials, query or fragment in the callback. When it is off, such a client is refused with a message naming the setting. For a local callback, the approval page warns that any program on that computer can open it, so approve only a sign-in you just started yourself. The approval page now says "your AI client" instead of ChatGPT. The configured ChatGPT callback is unchanged.

No migration, credential, or origin changes.
