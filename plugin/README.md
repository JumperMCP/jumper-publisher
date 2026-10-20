# Jumper Publisher

![Jumper Publisher](icon.png)

Ask Claude to build a web page and publish it, and get a public address back in the conversation. Jumper Publisher hosts the site in **your own Cloudflare account** (the free plan works). Weeks later, in a new chat, in another AI client such as ChatGPT, or on your phone, ask for a change: Claude finds the site by name or address, edits only what you asked for, and republishes at the same address. You can also undo, export or unpublish.

## What this plugin contains

- **An MCP connection** named `publisher` to your own Publisher, at the URL you enter when you enable the plugin.
- **A skill**, `publish-website`, that guides Claude through publishing, editing, uploading images and ZIPs, undoing and unpublishing.

## Before you install

1. Install your own Publisher once at [publisher.jumpermcp.dev](https://publisher.jumpermcp.dev) (about 5 minutes): sign in to Cloudflare, choose an account, create your Publisher password, and add a Cloudflare API token with **Workers Scripts: Edit** permission in your Publisher's settings.
2. Copy the **MCP URL** from your Publisher's control panel under **AI connections**. It ends in `/mcp`.
   In the same panel, under **AI apps on this computer**, choose **Allow AI apps on this computer**: Claude Code signs in through your computer, which is off by default. Approve only sign-ins you just started.
3. Install the plugin in Claude Code:

   ```
   /plugin install jumper-publisher --marketplace JumperMCP/jumper-publisher
   ```

   Paste the URL when Claude Code asks for **Publisher MCP URL**. On first use, sign in with your Publisher password and approve access.

On claude.ai and in Cowork, add Jumper Publisher as a connector with the same URL; the skill works with it there.

## What it sends, and where

- **To your Publisher only** (the URL you configured): the website files and edits you ask Claude to publish, and requests to list, read, search, restore, export or unpublish your sites. Your Publisher then calls the Cloudflare API on your own account.
- **Upload links:** for images, ZIPs and large files, your Publisher returns a one-time upload link on its own address. Claude sends the file there with `curl` from your shell, so the file never passes through the chat.
- The plugin has no hooks, runs no local programs, and sends nothing to Jumper MCP, Anthropic or anyone else. Jumper MCP never sees your sites, files, password or API token.
- Everything you publish is public on the internet.

## Limits

Static websites only: HTML, CSS, JavaScript, images and other files, or a ZIP with an `index.html`. No server code, databases or build steps. Up to 20 sites, 25 MB per site, 10 MB per file; the last 20 versions of each site are kept for undo.

## Links

- Documentation: https://jumpermcp.dev/publisher/docs/
- Privacy policy: https://jumpermcp.dev/publisher/privacy/
- Source code (MIT): https://github.com/JumperMCP/jumper-publisher
- Support: support@jumpermcp.com
