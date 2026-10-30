import type { Projects } from "./projects";
import type { Operation } from "./types";
import type { Update } from "./updates";
import { loopbackCallback } from "./oauth-policy";
import { cloudflareSettings } from "./owner-ui";
import { escapeHtml as e, form, hidden } from "./ui";

export function dashboard(input: {
  origin: string;
  account: string;
  version: string;
  csrf: string;
  projects: ReturnType<Projects["list"]>;
  operations: Operation[];
  connected: boolean;
  update?: Update;
  receipt: unknown;
  clients: {
    grant: string;
    name: string;
    callback: string;
    approved: number;
    lastUsed?: number;
  }[];
  localSignIn: boolean;
  localSignInForced: boolean;
  refused?: { at: number; name: string; callbacks: string[]; method: string };
}) {
  const {
    origin,
    account,
    version,
    csrf,
    projects,
    operations,
    connected,
    update,
    receipt,
    clients,
    localSignIn,
    localSignInForced,
    refused,
  } = input;
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const clientRows = clients
    .map((c) => {
      const where = loopbackCallback(c.callback)
        ? "an app on your computer (localhost)"
        : URL.canParse(c.callback)
          ? new URL(c.callback).hostname
          : "unknown callback";
      return `<article class="client-row"><div><strong>${e(c.name)}</strong><small>Returns to ${e(where)} · approved <time>${e(day(c.approved))}</time>${c.lastUsed ? ` · last used <time>${e(day(c.lastUsed))}</time>` : " · not used yet"}</small></div>${form("/connections/revoke", csrf, hidden("grant", c.grant) + `<button class="quiet-button" aria-label="Revoke access for ${e(c.name)}">Revoke</button>`)}</article>`;
    })
    .join("");
  const localToggle = localSignInForced
    ? '<p class="help">Sign-in from AI apps on your computer is on, set by the ALLOW_LOOPBACK_CALLBACKS Worker variable.</p>'
    : form(
        "/connections/local",
        csrf,
        hidden("enabled", localSignIn ? "false" : "true") +
          `<p class="help">${localSignIn ? "On: AI apps on your computer, such as Claude Code, can ask to connect. Any program on this computer can open the approval page, so approve only sign-ins you just started." : "Off: AI apps on your computer, such as Claude Code, cannot connect. Web apps such as ChatGPT, Claude and Muse are not affected."}</p><button class="quiet-button">${localSignIn ? "Turn off computer apps" : "Allow AI apps on this computer"}</button>`,
      );
  const rows = projects.projects
    .map(
      (p) =>
        `<article class="project-row"><div class="project-line"><a class="project-url" href="${e(p.url)}" target="_blank" rel="noreferrer" title="${e(p.name)} (${e(new URL(p.url).hostname)})">${e(p.name)}</a><span class="status ${p.live ? "live" : ""}">${p.live ? "Published" : "Private / unpublished"}</span></div><details class="project-details"><summary>Manage</summary><div class="project-management"><a class="project-address" href="${e(p.url)}" target="_blank" rel="noreferrer">${e(new URL(p.url).hostname)} ↗</a><small>Project ID: ${e(p.id)}</small><div class="project-actions">${p.head ? form("/export", csrf, hidden("project", p.id) + '<button class="quiet-button">Export files</button>') : ""}${form("/unpublish", csrf, hidden("project", p.id) + hidden("base", p.head) + '<button class="quiet-button">Unpublish</button>')}</div><details><summary>Delete permanently</summary>${form("/delete", csrf, hidden("project", p.id) + hidden("base", p.head) + `<label>Enter <code>${e(p.id)}</code> to delete this project and its history<input name="confirmation" required autocomplete="off"></label><button class="danger">Delete project permanently</button>`)}</details></div></details></article>`,
    )
    .join("");
  const activity = operations
    .map((op) => {
      const project = projects.projects.find((p) => p.id === op.project);
      return `<article class="operation"><div class="operation-head"><strong>${e(project?.name ?? op.kind)}</strong><span>${e(op.state)}</span></div><time datetime="${e(new Date(op.created).toISOString())}">${e(new Date(op.created).toISOString().replace("T", " ").slice(0, 16))} UTC · ${e(op.kind)}</time>${op.reachable === false ? "<p>Awaiting public address availability</p>" : ""}${op.error ? `<p>${e(op.error.message)}</p>` : ""}<details><summary>Operation details</summary><code>${e(op.id)}</code><p>Attempts: ${e(op.attempts)}</p></details></article>`;
    })
    .join("");
  return `<div class="workspace"><section class="panel projects-panel"><div class="panel-heading"><h2>Public projects</h2><small>${projects.projects.length} projects · ${(projects.retained_bytes / 1024 / 1024).toFixed(2)} / 250 MiB</small></div><div class="panel-scroll" tabindex="0" role="region" aria-label="Projects">${rows || '<div class="empty"><strong>Your first site starts in a chat.</strong><p>Connect ChatGPT, Claude or another AI app, choose the files you want to share, and ask Publisher to publish them here.</p></div>'}${projects.next_cursor ? '<p class="help">Showing the first 50 projects. Ask Publisher in your AI app to list more.</p>' : ""}</div></section>
<section class="panel connect-panel" id="connections"><div class="panel-heading"><h2>AI connections</h2></div><div class="panel-scroll" tabindex="0" role="region" aria-label="AI connections and installation receipt"><p>Start a site in one AI app, keep editing it in another.</p><label for="mcp-url">MCP server URL</label><input id="mcp-url" readonly value="${e(origin)}/mcp"><p class="help">Add this URL as a custom MCP server or connector: ChatGPT → Plugins → Add custom MCP server; Claude → Settings → Connectors → Add custom connector.</p><h3>Connected apps</h3>${clientRows || '<p class="help">No AI app is connected yet.</p>'}<details><summary>AI apps on this computer</summary>${localToggle}</details>${refused ? `<details><summary>Last refused sign-in</summary><p class="help">${e(refused.name || "Unnamed app")} · ${e(new Date(refused.at).toISOString().replace("T", " ").slice(0, 16))} UTC</p><p class="help">Callback: <code>${e(refused.callbacks.join(", ") || "(none sent)")}</code><br>Client authentication: <code>${e(refused.method)}</code></p></details>` : ""}<details><summary>Installation receipt & connection help</summary><p>ChatGPT: if the option is missing, check Settings → Security and login → Developer mode. Availability depends on your account and workspace.</p><pre>${e(JSON.stringify(receipt, null, 2))}</pre></details></div></section>
<section class="panel activity-panel"><div class="panel-heading"><h2>Recent operations</h2><a href="/" class="help">Refresh</a></div><div class="panel-scroll" tabindex="0" role="region" aria-label="Recent operations">${activity || "<p>No operations yet. Publication progress will appear here.</p>"}</div></section>
${cloudflareSettings(origin, account, csrf, connected)}
<section class="panel updates-panel"><div class="panel-heading"><h2>Publisher updates</h2></div><div class="panel-scroll" tabindex="0" role="region" aria-label="Publisher updates"><p>Installed version: <strong>${e(version)}</strong></p><p>Installed from: <a href="https://publisher.jumpermcp.dev/" target="_blank" rel="noreferrer">jumpermcp.dev</a></p><p>Update state: ${e(update?.state === "review" && update.release.manifest.version === version ? "up to date" : (update?.state ?? "No update checked"))}.</p>${update?.error ? `<p role="alert">${e(update.error.message)}</p>` : ""}${form("/updates/check", csrf, "<button>Check for updates</button>")}${update?.state === "review" ? `<h3>${update.release.manifest.version === version ? "Release notes" : "Review"} ${e(update.release.manifest.version)}</h3><pre>${e(update.release.manifest.notes)}</pre>${update.release.manifest.version === version ? '<p role="status">You already have this version installed.</p>' : form("/updates/apply", csrf, hidden("update", update.id) + "<button>Update Publisher</button>")}` : ""}<details><summary>How updates work</summary><p>Publishing pauses between steps during an update and resumes afterward. Your projects stay in your Cloudflare account.</p></details></div></section></div><div class="inline-meta"><small>${e(new URL(origin).hostname)}</small><span class="status ${connected ? "live" : ""}">${connected ? "Website publishing connected" : "Connect Cloudflare in Settings"}</span></div>`;
}
