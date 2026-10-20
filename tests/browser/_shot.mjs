import { chromium } from "playwright";
const [,, url, out, w, h, scheme] = process.argv;
const b = await chromium.launch({ executablePath: "/etc/profiles/per-user/snlr/bin/google-chrome" });
const p = await b.newPage({ viewport: { width: +w, height: +h }, colorScheme: scheme || "light" });
await p.goto(url, { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
await p.screenshot({ path: out, fullPage: true });
await b.close();
