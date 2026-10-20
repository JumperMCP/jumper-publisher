# TODO

++ 2026-10-00 - Per-client access list and revoke - Approved MCP clients (ChatGPT, local AI clients via localhost callbacks) keep access until the owner resets the password, which signs out every client at once. Add a control-panel list of granted clients (name, callback, approval date, last use) with a revoke button per client. `@cloudflare/workers-oauth-provider` exposes grant listing and revocation (`listUserGrants`, `revokeGrant`). This matters most once `ALLOW_LOOPBACK_CALLBACKS` is on, because any local program can request access and the client name is self-reported.
++ 2026-10-19 - Password reset via cockpit (shipped in 0.1.18 as Change Publisher login password, label in 0.1.19):

The control panel has no "change password" button.
The only way is the recovery flow, run from Cloudflare:

1. In this repo, run npm run recovery-token. It prints a token, a RECOVERY_TOKEN_HASH and a RECOVERY_EXPIRES_AT (one hour from now). Keep the output out of chats and logs.
2. In Cloudflare, open the reviewer account's Publisher Worker (publisher-c047d890) → Settings → Variables and Secrets. Add RECOVERY_TOKEN_HASH and RECOVERY_EXPIRES_AT with the printed values, then deploy. Leave every other variable and secret alone, especially CREDENTIAL_KEY.
3. Open https://publisher-c047d890.anita-nyc-tattoo.workers.dev/recover?token=<token> and choose the new password.
4. Delete the two recovery variables again. The token can only be used once in any case.

Resetting signs out every control panel session and every connected AI client. After the review,
that removes the reviewers' Claude access along with the old password, which is what you want there.

For an ordinary user, this is a lot of steps for a routine password change.
A Change password form in the control panel is needed for the next Publisher release:
current password plus new password, and it would also sign out the connected AI clients.
