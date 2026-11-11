#!/usr/bin/env node
// Post-build audit: the shipped web bundle must not reference any CDN or font/script host.
// Usage: node scripts/audit-network.mjs dist
//
// Vendor code (Excalidraw) contains inert URL literals — help links, XML namespaces, social-embed
// patterns, collaboration endpoints of features this app never enables. Those are reported, not fatal.
// Any CDN host (the kind of URL that would actually be fetched for assets) fails the build.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "dist";
const CDN_HOSTS = [
  "esm.sh", "unpkg.com", "cdn.jsdelivr.net", "jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com",
  "fonts.gstatic.com", "cdn.skypack.dev", "ga.jspm.io", "mozilla.github.io",
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(m?js|css|html|json)$/.test(name)) yield p;
  }
}

const failures = [];
const inert = new Map();
for (const file of walk(root)) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)) {
    const host = m[1].toLowerCase();
    if (CDN_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) failures.push(`${file}: ${m[0]}`);
    else inert.set(host, (inert.get(host) ?? 0) + 1);
  }
}
if (failures.length) {
  console.error("CDN URLs found in the web bundle:\n" + failures.join("\n"));
  process.exit(1);
}
console.log(`audit-network: no CDN URLs in ${root}. Inert vendor URL hosts (not fetched; blocked by CSP + WKContentRuleList):`);
for (const [h, n] of [...inert].sort()) console.log(`  ${h} (${n})`);
