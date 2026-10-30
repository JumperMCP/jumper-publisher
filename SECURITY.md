# Security policy

Jumper Publisher runs in each owner's own Cloudflare account. Jumper MCP Inc. operates the installer at `publisher.jumpermcp.dev`, signs releases and publishes the release channel. This policy covers how to report a security problem and what we do about it.

## Supported versions

Only the newest release gets security fixes. Owners update from their control panel (**Check for updates**); releases are listed in [docs/release-notes.md](docs/release-notes.md).

## Reporting a vulnerability

Report privately, not in a public issue:

- GitHub: **Security → Report a vulnerability** on this repository, or
- email [support@jumpermcp.dev](mailto:support@jumpermcp.dev) with "Security" in the subject.

Include the affected version, steps to reproduce, and the impact you expect. Never send owner passwords, API tokens or access tokens; describe where they appear instead. Test only against a Publisher you own.

**In scope:** the Publisher Worker (OAuth, MCP tools, control panel, storage, updates), the installer, and release signing and verification.

**Out of scope:** Cloudflare itself, settings in an owner's Cloudflare account, content owners publish on their sites, and AI clients (report those to their providers).

## What happens next

- We acknowledge your report within 3 business days and keep you updated until it's resolved.
- We fix confirmed problems in a signed release and describe the fix in the release notes. For serious problems we also publish a GitHub security advisory and tell owners to update.
- We credit reporters who want to be named, once a fix is released. Please give us 90 days, or until a fix is out, before disclosing publicly.

## Incident response

If we learn of an incident affecting owners' data, for example a compromised release signing key or installer:

1. We contain it: stop releases or the installer, and rotate keys where needed.
2. We tell affected owners through a GitHub security advisory, the release notes and the documentation, with steps to take (for example: update, revoke AI connections, replace the Cloudflare API token).
3. We notify the AI platforms that list Publisher within the time their terms require (Meta: 48 hours).

Because Jumper MCP has no access to owners' Publishers or websites, most incidents inside one owner's Cloudflare account are the owner's to contain: change the owner password, revoke AI connections and replace the API token in the control panel. We'll help over email.
