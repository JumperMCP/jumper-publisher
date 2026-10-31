# Jumper Publisher

![Jumper Publisher](assets/logo.png)

Ask your agent to build a web page and publish it, and get a public address back in the conversation. Jumper Publisher hosts the site in **your own Cloudflare account** (the free plan works). Weeks later, in a new conversation or in another AI client such as ChatGPT or Claude, ask for a change: the agent finds the site by name or address, edits only what you asked for, and republishes at the same address. You can also undo, export or unpublish.

Works in Cursor and Grok Bot.

## What this plugin contains

- **An MCP connection** named `publisher` to your own Publisher, at the URL you set in the plugin's `PUBLISHER_URL` variable.
- **A skill**, `publish-website`, that guides the agent through publishing, editing, uploading images and ZIPs, undoing and unpublishing.

## Before you use it

1. Install your own Publisher once at [publisher.jumpermcp.dev](https://publisher.jumpermcp.dev) (about 5 minutes): sign in to Cloudflare, choose an account, create your Publisher password, and add a Cloudflare API token with **Workers Scripts: Edit** permission in your Publisher's settings.
2. Copy the **MCP URL** from your Publisher's control panel under **AI connections**. It ends in `/mcp`.
3. Install the plugin and set **PUBLISHER_URL** to that URL (Dashboard → **Plugins** → **Configure**).
4. On first use, sign in with your Publisher password and approve access. In the Cursor desktop app, first choose **Allow AI apps on this computer** under **AI connections** in your control panel: the desktop app signs in through your computer. Cursor on the web, Cloud Agents and Grok Bot don't need this.

## What it sends, and where

- **To your Publisher only** (the URL you configured): the website files and edits you ask the agent to publish, and requests to list, read, search, restore, export or unpublish your sites. Your Publisher then calls the Cloudflare API on your own account.
- **Upload links:** for images, ZIPs and large files, your Publisher returns a one-time upload link on its own address. The agent sends the file there with `curl`, so the file never passes through the conversation.
- The plugin has no hooks or rules, runs no programs of its own, and sends nothing to Jumper MCP or anyone else. Jumper MCP never sees your sites, files, password or API token.
- Everything you publish is public on the internet.

## Limits

Static websites only: HTML, CSS, JavaScript, images and other files, or a ZIP with an `index.html`. No server code, databases or build steps. Up to 20 sites, 25 MB per site, 10 MB per file; the last 20 versions of each site are kept for undo.

## Links

- Documentation: https://jumpermcp.dev/publisher/docs/
- Privacy policy: https://jumpermcp.dev/publisher/privacy/
- Terms of service: https://jumpermcp.dev/publisher/terms/
- Source code (MIT): https://github.com/JumperMCP/jumper-publisher
- Support: support@jumpermcp.dev
