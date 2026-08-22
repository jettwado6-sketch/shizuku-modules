#!/usr/bin/env node
"use strict";

/**
 * Build the static site (site/index.html) from data/repos.json.
 *
 * Usage:
 *   node scripts/build-site.js
 *
 * Produces a single self-contained HTML file (inline CSS + JS + embedded
 * JSON), so it works anywhere static hosting exists (GitHub Pages etc.).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_FILE = path.join(ROOT, "data", "repos.json");
const SITE_DIR = path.join(ROOT, "site");
const OUT_FILE = path.join(SITE_DIR, "index.html");

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const VISITOR_STATS_URL =
  "https://www.freevisitorcounters.com/en/home/stats/id/1624720";
const VISITOR_STATS_LABELS = {
  Today: "today",
  Yesterday: "yesterday",
  All: "total",
  Online: "online",
};

async function fetchVisitorStats() {
  // Best-effort: returns {} when the stats page is unreachable or changes shape,
  // so a counter outage never breaks the build.
  try {
    const response = await fetch(VISITOR_STATS_URL, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return {};
    const page = await response.text();
    const overview = page.match(
      /<th colspan="2">Visitors Overview<\/th>([\s\S]*?)<\/tbody>/
    );
    if (!overview) return {};
    const stats = {};
    const cell = /<td>(.*?)<\/td>\s*<td>(.*?)<\/td>/g;
    let match;
    while ((match = cell.exec(overview[1]))) {
      const label = match[1].trim();
      const value = match[2].trim();
      if (label in VISITOR_STATS_LABELS && /^\d+$/.test(value)) {
        stats[VISITOR_STATS_LABELS[label]] = Number(value);
      }
    }
    return stats;
  } catch {
    return {};
  }
}

async function main() {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`Missing ${DATA_FILE}. Run "node scripts/find-repos.js" first.`);
    process.exit(1);
  }

  let repos = [];
  try {
    repos = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!Array.isArray(repos)) repos = [];
  } catch (err) {
    console.error(`Could not parse ${DATA_FILE}: ${err.message}`);
    process.exit(1);
  }

  const now = Date.now();
  // "New this week" = real repo activity (pushed / released / created) in the
  // last 7 days, not when the crawler first noticed the app.
  const isFresh = (r) => {
    const ts = r.pushed_at || (r.release && r.release.published_at) || r.created_at;
    return ts && now - new Date(ts).getTime() < WEEK_MS;
  };
  const freshCount = repos.filter(isFresh).length;
  const awesomeCount = repos.filter((r) => (r.source || "").startsWith("awesome")).length;

  const data = {
    generated_at: new Date().toISOString(),
    total: repos.length,
    fresh: freshCount,
    awesome: awesomeCount,
    visitorStats: await fetchVisitorStats(),
    repos,
  };

  fs.mkdirSync(SITE_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, render(data));
  fs.writeFileSync(path.join(SITE_DIR, "feed.xml"), renderFeed(data));
  console.log(
    `Built ${OUT_FILE} + feed.xml (${repos.length} repos, ${freshCount} new this week, visitor stats: ${JSON.stringify(data.visitorStats)})`
  );
}

function renderFeed(data) {
  // Atom feed of the newest apps, so people can subscribe to new discoveries.
  const siteUrl = "https://rushiranpise.github.io/shizuku-modules/";
  const escapeXml = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const items = data.repos
    .filter((r) => r.added_at)
    .sort((a, b) => (b.added_at || "").localeCompare(a.added_at || ""))
    .slice(0, 30)
    .map((r) => {
      const title = (r.full_name || r.html_url || "").replace(/_store_/g, "");
      const link = r.html_url || siteUrl;
      const updated = r.pushed_at || r.added_at;
      const desc = escapeXml(r.description || "").slice(0, 300);
      return `    <entry>
      <title>${escapeXml(title)}</title>
      <link href="${escapeXml(link)}"/>
      <id>${escapeXml(link)}</id>
      <updated>${new Date(updated).toISOString()}</updated>
      <summary>${desc}</summary>
    </entry>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Shizuku Apps Directory — New Apps</title>
  <link href="${siteUrl}"/>
  <link href="${siteUrl}feed.xml" rel="self"/>
  <updated>${new Date(data.generated_at).toISOString()}</updated>
  <id>${siteUrl}</id>
  <subtitle>Newly discovered Android apps that use Shizuku</subtitle>
${items}
</feed>
`;
}

function render(data) {
  // Escape "<" so a description can never break out of the <script> tag.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shizuku Apps Directory — ${data.total} apps that use Shizuku</title>
<meta name="description" content="Searchable directory of ${data.total} Android apps that use Shizuku — ${data.awesome} from awesome-shizuku, updated daily with APK downloads.">
<meta name="theme-color" content="#5C6BC0">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Shizuku Apps Directory">
<meta property="og:title" content="Shizuku Apps Directory">
<meta property="og:description" content="Searchable directory of ${data.total} Android apps that use Shizuku — updated daily with APK downloads.">
<meta property="og:url" content="https://rushiranpise.github.io/shizuku-modules/">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="Shizuku Apps Directory">
<meta name="twitter:description" content="Searchable directory of ${data.total} Android apps that use Shizuku — updated daily.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect x='1' y='1' width='14' height='14' rx='4' fill='%235C6BC0'/%3E%3Ctext x='8' y='12' font-size='10' font-family='sans-serif' font-weight='bold' text-anchor='middle' fill='white'%3ES%3C/text%3E%3C/svg%3E">
<style>
  :root {
    --bg: #0b0f14;
    --bg-soft: #10151c;
    --card: #151b24;
    --card-hover: #1a222e;
    --border: #232d3a;
    --text: #e6edf3;
    --muted: #8b98a5;
    --accent: #5C6BC0;
    --accent-2: #7986CB;
    --accent-3: #3F51B5;
    --new: #3fb950;
    --archived: #6e7681;
    --radius: 14px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { color-scheme: dark; }
  body {
    display: flex; flex-direction: column; min-height: 100vh;
    background:
      radial-gradient(1000px 500px at 85% -10%, rgba(92, 107, 192, .14), transparent 60%),
      radial-gradient(900px 500px at -10% 0%, rgba(121, 134, 203, .08), transparent 55%),
      var(--bg);
    color: var(--text);
    font-family: "Segoe UI", system-ui, -apple-system, Roboto, sans-serif;
  }
  header {
    padding: 56px 24px 40px;
    text-align: center;
  }
  .logo {
    display: inline-flex;
    align-items: center;
    gap: 14px;
    font-size: 40px;
    font-weight: 800;
    letter-spacing: -.5px;
  }
  .logo-badge {
    width: 52px; height: 52px;
    border-radius: 14px;
    background: linear-gradient(135deg, var(--accent), var(--accent-3));
    display: grid; place-items: center;
    font-size: 26px; font-weight: 900; color: #fff;
    box-shadow: 0 8px 30px rgba(92, 107, 192, .35);
  }
  .logo .grad { background: linear-gradient(90deg, var(--accent), var(--accent-3)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .tagline { color: var(--muted); margin-top: 10px; font-size: 16px; }
  .stats { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 24px; }
  .stat {
    background: var(--card); border: 1px solid var(--border); border-radius: 999px;
    padding: 8px 18px; font-size: 14px; color: var(--muted);
  }
  .stat b { color: var(--text); font-weight: 700; }

  .toolbar {
    position: sticky; top: 0; z-index: 10;
    display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
    max-width: 1200px; margin: 0 auto 28px; padding: 14px 24px;
    background: rgba(11, 15, 20, .85); backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
  }
  .search-wrap { position: relative; flex: 1 1 280px; }
  .search-wrap svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); opacity: .5; }
  #search {
    width: 100%;
    background: var(--card); color: var(--text);
    border: 1px solid var(--border); border-radius: 10px;
    padding: 10px 14px 10px 38px; font-size: 15px; outline: none;
    transition: border-color .15s, box-shadow .15s;
  }
  #search:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(92, 107, 192, .18); }
  select {
    background: var(--card); color: var(--text);
    border: 1px solid var(--border); border-radius: 10px;
    padding: 10px 12px; font-size: 14px; outline: none; cursor: pointer;
  }
  .seg {
    display: inline-flex; background: var(--card);
    border: 1px solid var(--border); border-radius: 10px; padding: 3px; gap: 2px;
  }
  .seg button {
    border: 0; background: transparent; color: var(--muted);
    font-size: 13px; font-weight: 600; padding: 7px 14px;
    border-radius: 7px; cursor: pointer; font-family: inherit;
    transition: background .15s, color .15s, box-shadow .15s;
  }
  .seg button:hover { color: var(--text); }
  .seg button.active {
    background: linear-gradient(135deg, var(--accent), var(--accent-3));
    color: #fff; box-shadow: 0 2px 10px rgba(92, 107, 192, .35);
  }
  .check {
    display: inline-flex; align-items: center;
    color: var(--muted); font-size: 13.5px; font-weight: 600;
    cursor: pointer; user-select: none; padding: 10px 16px;
    background: var(--card); border: 1px solid var(--border);
    border-radius: 10px; transition: border-color .15s, color .15s, background .15s, box-shadow .15s;
  }
  .check:hover { border-color: var(--accent-2); color: var(--text); }
  .check:has(input:checked) {
    background: linear-gradient(135deg, var(--accent), var(--accent-3));
    color: #fff; border-color: transparent;
    box-shadow: 0 2px 10px rgba(92, 107, 192, .35);
  }
  .check input { position: absolute; opacity: 0; pointer-events: none; }
  .check input:focus-visible ~ * { outline: 2px solid var(--accent-2); outline-offset: 2px; border-radius: 4px; }
  .pager { display: flex; justify-content: center; gap: 10px; margin: 28px auto; }
  .load-more {
    padding: 12px 34px;
    background: var(--card); color: var(--text); border: 1px solid var(--border);
    border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer;
    font-family: inherit; transition: background .15s, border-color .15s;
  }
  .load-more:hover { background: var(--card-hover); border-color: var(--accent); }
  .load-more.ghost { background: transparent; color: var(--muted); font-weight: 500; }
  .load-more.ghost:hover { color: var(--text); }
  .fav-btn {
    margin-left: auto; align-self: flex-start;
    border: 0; background: transparent; color: var(--muted);
    font-size: 18px; line-height: 1; cursor: pointer; padding: 2px 4px;
    transition: color .15s, transform .15s; font-family: inherit;
  }
  .fav-btn:hover { color: #e5484d; transform: scale(1.15); }
  .fav-btn.on { color: #e5484d; }
  #count { margin-left: auto; color: var(--muted); font-size: 13px; }

  main { flex: 1; max-width: 1200px; margin: 0 auto; padding: 0 24px 60px; width: 100%; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
    gap: 16px;
  }
  .card {
    background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 18px; display: flex; flex-direction: column; gap: 12px;
    transition: transform .15s ease, border-color .15s ease, background .15s ease;
  }
  .card:hover { transform: translateY(-3px); border-color: #33414f; background: var(--card-hover); }
  .card-top { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .avatar {
    width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
    background: var(--bg-soft); border: 1px solid var(--border);
  }
  .card-name { min-width: 0; }
  .card-name a {
    color: var(--text); text-decoration: none; font-weight: 700; font-size: 15px;
    display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .card-name a:hover { color: var(--accent); }
  .card-owner {
    color: var(--muted); font-size: 12.5px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .desc {
    color: #b6c2cf; font-size: 13.5px; line-height: 1.5;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
    overflow: hidden; min-height: 61px;
  }
  .desc:empty::before { content: "No description provided."; color: var(--archived); }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .tag {
    font-size: 11.5px; padding: 3px 9px; border-radius: 999px;
    background: var(--bg-soft); color: var(--muted);
    border: 1px solid var(--border);
    max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .tag.more { background: var(--bg-soft); color: var(--muted); border-color: var(--border); }
  .card-foot {
    display: flex; align-items: center; flex-wrap: wrap; row-gap: 8px; gap: 14px;
    font-size: 12.5px; color: var(--muted);
    border-top: 1px solid var(--border); padding-top: 12px;
    margin-top: auto;
  }
  .stars { color: var(--text); font-weight: 700; display: inline-flex; align-items: center; gap: 4px; }
  .star-icon { color: #e8b339; }
  .lang { display: inline-flex; align-items: center; gap: 5px; }
  .lang-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--dot, #8b98a5); }
  .updated { margin-left: auto; }
  .badges { display: flex; gap: 6px; }
  .badge { font-size: 10.5px; font-weight: 700; letter-spacing: .4px; padding: 3px 8px; border-radius: 6px; text-transform: uppercase; }
  .badge.new { background: rgba(63, 185, 80, .15); color: var(--new); border: 1px solid rgba(63, 185, 80, .35); }
  .badge.archived { background: rgba(110, 118, 129, .15); color: var(--archived); border: 1px solid rgba(110, 118, 129, .35); }
  .badges .badge + .badge { margin-left: 0; }
  .app-meta {
    display: flex; align-items: center; flex-wrap: wrap; row-gap: 4px; gap: 6px;
    font-size: 12.5px; color: var(--muted);
  }
  .app-version {
    font-weight: 700; color: var(--accent-2);
    min-width: 0; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .app-date { flex-shrink: 0; white-space: nowrap; }
  .updated-line {
    display: flex; align-items: center; gap: 6px;
    font-size: 12px; color: var(--muted);
  }
  .updated-label {
    font-weight: 600; letter-spacing: .3px; text-transform: uppercase;
    font-size: 10px; color: var(--muted); opacity: .8;
  }
  .updated-val { color: var(--text); font-weight: 600; }
  .app-api {
    flex-shrink: 0;
    font-size: 11px; font-weight: 700; letter-spacing: .2px;
    color: #7dd3fc;
    background: rgba(125, 211, 252, .1); border: 1px solid rgba(125, 211, 252, .22);
    padding: 1px 7px; border-radius: 999px;
  }
  .dl-row { display: flex; gap: 8px; }
  .release-chip {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    width: 100%;
    font-size: 12.5px; font-weight: 700; color: #06121f;
    background: var(--accent); border: 1px solid var(--accent);
    padding: 8px 12px; border-radius: 8px; text-decoration: none;
    transition: background .15s, border-color .15s;
  }
  .release-chip:hover { background: #0ea5e9; border-color: #0ea5e9; }
  .release-chip.ghost {
    background: transparent; color: var(--muted); border-color: var(--border);
    font-weight: 500;
  }
  .release-chip.ghost:hover { background: var(--card-hover); color: var(--text); border-color: var(--accent); }
  .release-chip.ghost.lic { cursor: default; }
  .release-chip.ghost.lic:hover { background: transparent; color: var(--muted); border-color: var(--border); }
  .empty {
    text-align: center; color: var(--muted); padding: 60px 0;
    font-size: 15px;
  }
  .hidden { display: none; }
  footer {
    position: sticky; bottom: 0;
    background: rgba(11, 15, 20, .88);
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    border-top: 1px solid var(--border);
  }
  .footer-inner {
    max-width: 1200px; margin: 0 auto;
    display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap;
    padding: 10px 24px;
    color: var(--muted); font-size: 12.5px;
    text-align: center;
  }

  .gen-line b { color: var(--accent); font-weight: 600; }
  #gen-date { color: var(--text); font-weight: 600; }
  footer a { color: var(--accent); text-decoration: none; }
  footer a:hover { text-decoration: underline; }

  .visitor-stats {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    margin: 16px 0 0;
  }
  .vs-caption {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .12em;
  }
  .vs-live {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: .08em;
    color: #f0b429;
  }
  .vs-live::before {
    content: "";
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 6px currentColor;
    animation: vs-blink 1.6s ease-in-out infinite;
  }
  .vs-live.live { color: var(--new); }
  .vs-live.cached { color: #f0b429; }
  @keyframes vs-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: .35; }
  }
  .vs-items {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 10px 28px;
    flex-wrap: wrap;
    font-size: 14px;
  }
  .visitor-stats .vs-item {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
  }
  .visitor-stats strong {
    color: var(--text);
    font-size: 24px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .visitor-stats .vs-item > span {
    color: var(--muted);
    font-size: 13px;
  }

  .site-counter {
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 28px auto 4px;
    color: var(--muted);
    font-size: 11px;
  }
  .site-counter a {
    color: var(--muted);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
  }
  .feed-link {
    color: var(--accent-2); text-decoration: none; font-size: 12px; font-weight: 700;
    border: 1px solid var(--border); border-radius: 6px; padding: 2px 8px;
  }
  .feed-link:hover { border-color: var(--accent); color: var(--text); }
  .site-counter a:hover {
    color: var(--text);
  }
  .site-counter img,
  .site-counter br {
    display: none;
  }


  .badge.awesome { background: rgba(139, 92, 246, .15); color: #a78bfa; border: 1px solid rgba(139, 92, 246, .35); }

  /* ---------- responsive ---------- */
  @media (max-width: 1024px) {
    .grid { grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); }
  }
  @media (max-width: 900px) {
    .toolbar { gap: 10px; }
    .search-wrap { flex: 1 1 100%; }
    .grid { gap: 14px; }
  }
  @media (max-width: 640px) {
    header { padding: 40px 16px 28px; }
    .logo { font-size: 26px; }
    .tagline { font-size: 14px; }
    .stats { gap: 8px; margin-top: 18px; }
    .stat { padding: 6px 14px; font-size: 13px; }
    .toolbar { padding: 10px 16px; margin-bottom: 20px; }
    select { flex: 1 1 45%; padding: 9px 10px; }
    main { padding: 0 16px 48px; }
    .grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
    .card { padding: 16px; }
    .footer-inner { gap: 8px; padding: 10px 16px; font-size: 12px; }
  }
  @media (max-width: 480px) {
    .seg { display: flex; width: 100%; }
    .seg button { flex: 1; padding: 8px 6px; }
    #count { display: none; }
    .badges { flex-wrap: wrap; }
    .toolbar { gap: 8px; }
  }
  .back-top {
    display: inline-flex;
    position: fixed;
    right: 22px;
    bottom: calc(58px + env(safe-area-inset-bottom));
    z-index: 21;
    width: 48px;
    height: 48px;
    border-radius: 999px;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    color: white;
    background: var(--accent);
    border: 0;
    box-shadow: 0 12px 32px rgba(0, 0, 0, .35);
    font-size: 28px;
    line-height: 1;
    transition: transform .18s ease, box-shadow .18s ease;
  }
  @media (hover: hover) and (pointer: fine) {
    .back-top:hover { transform: translateY(-2px); box-shadow: 0 14px 36px rgba(0, 0, 0, .45); }
  }
  .modal { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .modal-backdrop { position: absolute; inset: 0; background: rgba(4, 6, 10, .72); backdrop-filter: blur(3px); }
  .modal-card {
    position: relative; width: min(720px, 100%); max-height: min(86vh, 900px);
    background: var(--card); border: 1px solid var(--border); border-radius: 16px;
    box-shadow: 0 24px 80px rgba(0, 0, 0, .55); overflow: hidden;
    display: flex; flex-direction: column;
  }
  .modal-close {
    position: absolute; top: 12px; right: 12px; z-index: 2;
    border: 0; background: rgba(255, 255, 255, .06); color: var(--text);
    width: 34px; height: 34px; border-radius: 50%; font-size: 20px; line-height: 1;
    cursor: pointer; font-family: inherit; transition: background .15s;
  }
  .modal-close:hover { background: rgba(255, 255, 255, .14); }
  .modal.hidden { display: none; }
  #modal-body { overflow-y: auto; padding: 26px 28px 30px; }
  .m-head { display: flex; gap: 14px; align-items: flex-start; padding-right: 40px; }
  .m-head img { width: 56px; height: 56px; border-radius: 12px; flex: none; }
  .m-title { font-size: 20px; font-weight: 800; color: var(--text); word-break: break-word; }
  .m-title a { color: var(--accent-2); text-decoration: none; }
  .m-title a:hover { text-decoration: underline; }
  .m-sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
  .m-desc { color: var(--text); font-size: 14px; line-height: 1.6; margin: 14px 0 4px; }
  .m-meta { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 6px; }
  .m-chip {
    background: var(--bg-soft); border: 1px solid var(--border); border-radius: 8px;
    padding: 5px 11px; font-size: 12.5px; color: var(--muted);
  }
  .m-chip b { color: var(--text); font-weight: 700; }
  .m-actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0 6px; }
  .m-actions a {
    display: inline-flex; align-items: center; gap: 6px; padding: 9px 18px;
    border-radius: 10px; text-decoration: none; font-size: 13.5px; font-weight: 600;
    background: linear-gradient(135deg, var(--accent), var(--accent-3)); color: #fff;
  }
  .m-actions a.ghost { background: transparent; border: 1px solid var(--border); color: var(--muted); }
  .m-actions a.ghost:hover { color: var(--text); border-color: var(--accent); }
  .m-readme { margin-top: 18px; border-top: 1px solid var(--border); padding-top: 16px; }
  .m-readme h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); margin: 0 0 12px; }
  .m-readme .md { color: var(--text); font-size: 14px; line-height: 1.65; }
  .m-readme .md h1, .m-readme .md h2, .m-readme .md h3 { color: var(--text); margin: 18px 0 8px; font-size: 17px; }
  .m-readme .md p { margin: 8px 0; }
  .m-readme .md code { background: var(--bg-soft); border: 1px solid var(--border); border-radius: 5px; padding: 1px 6px; font-size: 12.5px; }
  .m-readme .md pre { background: var(--bg-soft); border: 1px solid var(--border); border-radius: 8px; padding: 12px; overflow-x: auto; }
  .m-readme .md pre code { background: none; border: 0; padding: 0; }
  .m-readme .md a { color: var(--accent-2); }
  .m-readme .md img { max-width: 100%; border-radius: 8px; }
  .m-readme .md ul, .m-readme .md ol { padding-left: 22px; margin: 8px 0; }
  .m-readme .md li { margin: 3px 0; }
  .m-readme .md blockquote { border-left: 3px solid var(--accent); margin: 10px 0; padding: 2px 12px; color: var(--muted); }
  .m-readme .md table { border-collapse: collapse; margin: 10px 0; }
  .m-readme .md th, .m-readme .md td { border: 1px solid var(--border); padding: 6px 10px; font-size: 13px; }
  .m-noreadme { color: var(--muted); font-size: 13px; font-style: italic; }
</style>
</head>
<body>
<header id="top">
  <div class="logo"><span class="grad">Shizuku Apps Directory</span></div>
  <p class="tagline">Mega collection of apps using Shizuku — updated daily.</p>
  <div class="stats">
    <span class="stat"><b id="stat-total">0</b> apps</span>
    <span class="stat"><b id="stat-new">0</b> new this week</span>
    <span class="stat">Updated <b id="stat-updated">—</b></span>
  </div>
  <div class="visitor-stats" aria-label="Visitor statistics">
    <span class="vs-caption">Visitor Info <span id="vsLive" class="vs-live" title="">syncing</span></span>
    <div class="vs-items">
      <span class="vs-item"><strong id="vsToday">–</strong><span>today</span></span>
      <span class="vs-item"><strong id="vsYesterday">–</strong><span>yesterday</span></span>
      <span class="vs-item"><strong id="vsOnline">–</strong><span>online</span></span>
      <span class="vs-item"><strong id="vsTotal">–</strong><span>all time</span></span>
    </div>
  </div>
</header>

<div class="toolbar">
  <div class="search-wrap">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
    <input id="search" type="search" placeholder="Search apps, topics, languages…" autocomplete="off">
  </div>
  <select id="sort" aria-label="Sort order">
    <option value="updated">Sort: Updated</option>
    <option value="stars">Sort: Most stars</option>
    <option value="name">Sort: Name A–Z</option>
    <option value="released">Sort: Latest release</option>
    <option value="added">Sort: Newest added</option>
  </select>
  <select id="category-filter" aria-label="Category filter">
    <option value="all">All categories</option>
  </select>
  <select id="source-filter" aria-label="Source filter">
    <option value="all">All sources</option>
    <option value="search">GitHub search</option>
    <option value="awesome">awesome-shizuku</option>
  </select>
  <select id="recency-filter" aria-label="Recency filter">
    <option value="all">Updated: Any time</option>
    <option value="7">Updated: Last 7 days</option>
    <option value="30">Updated: Last 30 days</option>
    <option value="90">Updated: Last 90 days</option>
  </select>
  <label class="check" title="Only show apps that publish an APK in their GitHub releases">
    <input id="apk-only" type="checkbox"> Only with APK
  </label>
  <label class="check" title="Show only apps you have starred">
    <input id="fav-only" type="checkbox"> Favorites
  </label>

  <span id="count"></span>
</div>

<main>
  <div id="grid" class="grid"></div>
  <div id="pager" class="pager hidden">
    <button id="load-more" class="load-more">Show more apps</button>
    <button id="load-all" class="load-more ghost">Load all</button>
  </div>
  <p id="empty" class="empty hidden">No repos match your search.</p>
  <div class="site-counter" aria-label="Visitor counter">
    <a href="https://www.free-counters.org/" target="_blank" rel="noopener">Visitor counter by Free-Counters.org</a>
    <script type="text/javascript" src="https://www.freevisitorcounters.com/auth.php?id=1753c948821b744e1c7a43d170302b10bdd1d58b"></script>
    <script type="text/javascript" src="https://www.freevisitorcounters.com/en/home/counter/1624720/t/0"></script>
  </div>
</main>

  <a class="back-top" href="#top" aria-label="Back to top">&#8593;</a>

<footer>
  <div class="footer-inner">
  <span class="gen-line">Generated using <a href="https://github.com/rushiranpise/shizuku-modules/actions" target="_blank" rel="noopener"><b>GitHub Actions</b></a> on <span id="gen-date"></span></span>
  <a class="feed-link" href="feed.xml" target="_blank" rel="noopener" title="Atom feed of new apps">RSS</a>
  </div>
</footer>

<div id="modal" class="modal hidden" role="dialog" aria-modal="true" aria-label="App details">
  <div class="modal-backdrop" data-close></div>
  <div class="modal-card">
    <button class="modal-close" data-close aria-label="Close">&#215;</button>
    <div id="modal-body"></div>
  </div>
</div>

<script id="repo-data" type="application/json">${json}</script>
<script>
(function () {
  const DATA = JSON.parse(document.getElementById("repo-data").textContent);

  const LANG_COLORS = {
    Java: "#b07219", Kotlin: "#a97bff", C: "#555555", "C++": "#f34b7d",
    JavaScript: "#f1e05a", TypeScript: "#3178c6", Python: "#3572A5",
    Dart: "#00B4AB", Shell: "#89e051", "C#": "#178600", Go: "#00ADD8",
    Rust: "#dea584", Swift: "#F05138", Vue: "#41b883", HTML: "#e34c26",
    CSS: "#563d7c", Zig: "#ec915c", Ruby: "#701516"
  };
  const fmt = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
  const fmtFull = new Intl.NumberFormat("en");
  const el = {
    grid: document.getElementById("grid"),
    empty: document.getElementById("empty"),
    count: document.getElementById("count"),
    search: document.getElementById("search"),
    sort: document.getElementById("sort"),
    category: document.getElementById("category-filter"),
    source: document.getElementById("source-filter"),
    recency: document.getElementById("recency-filter"),
    apk: document.getElementById("apk-only"),
    favOnly: document.getElementById("fav-only"),
    pager: document.getElementById("pager"),
    loadMore: document.getElementById("load-more"),
    loadAll: document.getElementById("load-all"),
  };

  // Pagination: render PAGE_SIZE cards at a time; "Show more" grows the window.
  const PAGE_SIZE = 60;
  let shown = PAGE_SIZE;

  // Populate the category dropdown from the data.
  const catSet = new Set(DATA.repos.map((r) => r.category || "Miscellaneous"));
  [...catSet].sort((a, b) => a.localeCompare(b)).forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    el.category.appendChild(opt);
  });

  // Shareable URL state: ?q=...&cat=...&src=...&sort=...&rec=7&apk=1&fav=1
  const params = new URLSearchParams(location.search);
  const applyParams = () => {
    if (params.has("q")) el.search.value = params.get("q");
    if (params.has("cat")) el.category.value = params.get("cat");
    if (params.has("src") && [...el.source.options].some((o) => o.value === params.get("src"))) {
      el.source.value = params.get("src");
    }
    if (params.has("sort") && [...el.sort.options].some((o) => o.value === params.get("sort"))) {
      el.sort.value = params.get("sort");
    }
    if (params.has("rec") && [...el.recency.options].some((o) => o.value === params.get("rec"))) {
      el.recency.value = params.get("rec");
    }
    if (el.apk && params.get("apk") === "1") el.apk.checked = true;
    if (el.favOnly && params.get("fav") === "1") el.favOnly.checked = true;
  };
  applyParams();

  document.getElementById("stat-total").textContent = fmtFull.format(DATA.total);
  document.getElementById("stat-new").textContent = fmtFull.format(DATA.fresh);
  const gen = new Date(DATA.generated_at);
  document.getElementById("stat-updated").textContent = gen.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  document.getElementById("gen-date").textContent = gen.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  const visitorStats = DATA.visitorStats || {};
  if (visitorStats.today != null) document.getElementById("vsToday").textContent = visitorStats.today;
  if (visitorStats.yesterday != null) document.getElementById("vsYesterday").textContent = visitorStats.yesterday;
  if (visitorStats.online != null) document.getElementById("vsOnline").textContent = visitorStats.online;
  if (visitorStats.total != null) document.getElementById("vsTotal").textContent = visitorStats.total;

  // Refresh visitor stats live from the counter service via a CORS proxy.
  // Retries across two proxy endpoints with backoff; marks the badge LIVE on
  // success or CACHED if every attempt fails, so stale data is never silent.
  (function refreshVisitorStats() {
    const badge = document.getElementById("vsLive");
    if (!badge) return;
    const statsUrl = "https://www.freevisitorcounters.com/en/home/stats/id/1624720";
    const endpoints = [
      "https://api.allorigins.win/raw?url=" + encodeURIComponent(statsUrl),
      "https://api.allorigins.win/get?url=" + encodeURIComponent(statsUrl),
    ];
    const applyStats = (page) => {
      const overview = page.match(/<th colspan="2">Visitors Overview\\/th>([\\s\\S]*?)\\/tbody>/);
      if (!overview) return false;
      const fields = { Today: "vsToday", Yesterday: "vsYesterday", All: "vsTotal", Online: "vsOnline" };
      const cell = /<td>(.*?)\\/td>\\s*<td>(.*?)\\/td>/g;
      let match;
      let updated = false;
      while ((match = cell.exec(overview[1]))) {
        const label = match[1].trim();
        const value = match[2].trim();
        if (fields[label] && /^\\d+$/.test(value)) {
          document.getElementById(fields[label]).textContent = value;
          updated = true;
        }
      }
      return updated;
    };
    const tryEndpoint = (index, attempt) => {
      return fetch(endpoints[index % endpoints.length])
        .then((response) => {
          if (!response.ok) throw new Error("proxy " + response.status);
          return index % 2 === 0 ? response.text() : response.json();
        })
        .then((payload) => {
          const page = index % 2 === 0 ? payload : (payload.contents || "");
          if (!applyStats(page)) throw new Error("unparseable stats page");
          badge.classList.remove("cached");
          badge.classList.add("live");
          badge.textContent = "live";
          badge.title = "Updated just now";
        })
        .catch((error) => {
          if (attempt < 5) {
            return new Promise((resolve) => setTimeout(resolve, 900 + attempt * 700)).then(() =>
              tryEndpoint(index + 1, attempt + 1)
            );
          }
          throw error;
        });
    };
    tryEndpoint(0, 0).catch(() => {
      badge.classList.add("cached");
      badge.textContent = "cached";
      badge.title = "Live refresh failed; showing last generated values";
    });
  })();

  function timeAgo(iso) {
    if (!iso) return "";
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    if (s < 2592000) return Math.floor(s / 86400) + "d ago";
    if (s < 31536000) return Math.floor(s / 2592000) + "mo ago";
    return Math.floor(s / 31536000) + "y ago";
  }

  function lastActivity(repo) {
    return (
      repo.pushed_at ||
      (repo.release && repo.release.published_at) ||
      repo.created_at
    );
  }

  function isFresh(repo) {
    const ts = lastActivity(repo);
    return ts && Date.now() - new Date(ts).getTime() < 7 * 86400000;
  }

  function card(repo) {
    const c = document.createElement("article");
    c.className = "card";

    const top = document.createElement("div");
    top.className = "card-top";

    const img = document.createElement("img");
    img.className = "avatar";
    img.alt = "";
    img.loading = "lazy";
    img.src = repo.owner && repo.owner.avatar_url ? repo.owner.avatar_url : "";
    if (!img.src) img.style.display = "none";
    img.addEventListener("error", () => { img.style.display = "none"; });

    const names = document.createElement("div");
    names.className = "card-name";
    const a = document.createElement("a");
    a.href = repo.html_url || "#";
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = repo.full_name;
    names.append(a);
    const owner = document.createElement("div");
    owner.className = "card-owner";
    const parts = [];
    if (repo.owner && repo.owner.login) parts.push("@" + repo.owner.login);
    if (repo.package) parts.push(repo.package);
    owner.textContent = parts.join(" \u00b7 ");
    names.append(owner);
    top.append(img, names);

    // Favorite heart button — persists in localStorage.
    const favBtn = document.createElement("button");
    favBtn.className = "fav-btn" + (favorites.has(repo.full_name) ? " on" : "");
    favBtn.type = "button";
    favBtn.textContent = "♥";
    favBtn.title = favorites.has(repo.full_name) ? "Remove from favorites" : "Add to favorites";
    favBtn.setAttribute("aria-label", favBtn.title);
    favBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFav(repo.full_name, favBtn);
    });
    top.append(favBtn);
    c.append(top);

    const desc = document.createElement("p");
    desc.className = "desc";
    desc.textContent = repo.description || repo.summary || "";
    c.append(desc);

    const release = repo.release || {};
    const version =
      release.tag ||
      (repo.metadata && repo.metadata.version ? repo.metadata.version : "");
    if (version || release.published_at) {
      const meta = document.createElement("div");
      meta.className = "app-meta";
      if (version) {
        const ver = document.createElement("span");
        ver.className = "app-version";
        ver.textContent = version.startsWith("v") ? version : "v" + version;
        ver.title = "Version " + ver.textContent;
        meta.append(ver);
      }
      if (release.published_at) {
        const date = document.createElement("span");
        date.className = "app-date";
        date.textContent = "released " + timeAgo(release.published_at);
        date.title = "Released " + new Date(release.published_at).toLocaleDateString();
        meta.append(date);
      }
      c.append(meta);
    }

    // Relative "updated X ago" line on every card, based on last push or release.
    const updatedIso = lastActivity(repo);
    if (updatedIso) {
      const upd = document.createElement("div");
      upd.className = "updated-line";
      const updLabel = document.createElement("span");
      updLabel.className = "updated-label";
      updLabel.textContent = "updated";
      const updVal = document.createElement("span");
      updVal.className = "updated-val";
      updVal.textContent = timeAgo(updatedIso);
      updVal.title =
        "Last activity: " + new Date(updatedIso).toLocaleString();
      upd.append(updLabel, updVal);
      c.append(upd);
    }

    const tags = repo.topics || [];
    if (tags.length) {
      const tagsEl = document.createElement("div");
      tagsEl.className = "tags";
      const shown = tags.slice(0, 4);
      shown.forEach((t) => {
        const s = document.createElement("span");
        s.className = "tag";
        s.textContent = t;
        tagsEl.append(s);
      });
      if (tags.length > 4) {
        const more = document.createElement("span");
        more.className = "tag more";
        more.textContent = "+" + (tags.length - 4);
        tagsEl.append(more);
      }
      c.append(tagsEl);
    }

    const foot = document.createElement("div");
    foot.className = "card-foot";

    if (typeof repo.stargazers_count === "number") {
      const stars = document.createElement("span");
      stars.className = "stars";
      const starIcon = document.createElement("span");
      starIcon.className = "star-icon";
      starIcon.textContent = "★";
      stars.append(starIcon, document.createTextNode(" " + fmt.format(repo.stargazers_count)));
      foot.append(stars);
    }

    if (repo.language) {
      const lang = document.createElement("span");
      lang.className = "lang";
      const dot = document.createElement("span");
      dot.className = "lang-dot";
      dot.style.setProperty("--dot", LANG_COLORS[repo.language] || "#8b98a5");
      lang.append(dot, document.createTextNode(repo.language));
      foot.append(lang);
    }

    const badges = document.createElement("span");
    badges.className = "badges";
    if (isFresh(repo)) {
      const b = document.createElement("span");
      b.className = "badge new";
      b.textContent = "New";
      badges.append(b);
    }
    if (repo.archived) {
      const b = document.createElement("span");
      b.className = "badge archived";
      b.textContent = "Archived";
      badges.append(b);
    }
    if (repo.source && repo.source.startsWith("awesome")) {
      const b = document.createElement("span");
      b.className = "badge awesome";
      b.textContent = "awesome-shizuku";
      b.title = "Listed in awesome-shizuku";
      badges.append(b);
    }
    if (badges.childElementCount) foot.append(badges);

    const updated = document.createElement("span");
    updated.className = "updated";
    const commitAt = repo.pushed_at || repo.updated_at;
    if (commitAt) updated.textContent = "updated " + timeAgo(commitAt);
    foot.append(updated);

    let dlRow = null;
    const dlLinks = [];
    if (release.tag) {
      const rel = document.createElement("a");
      rel.className = "release-chip" + (release.prerelease ? " prerelease" : "");
      rel.href = release.apk_url || release.html_url || "#";
      rel.target = "_blank";
      rel.rel = "noopener";
      rel.textContent = release.apk_url ? "Download APK" : "View release";
      rel.title =
        "Release " + (release.name || release.tag) +
        (release.published_at
          ? " \u00b7 " + new Date(release.published_at).toLocaleDateString()
          : "") +
        (release.apk_url ? " \u00b7 direct APK download" : "");
      dlLinks.push(rel);
    }
    // Always show a second button so release cards look consistent:
    // "Homepage" when the repo sets one, otherwise a "GitHub" link.
    const secondaryHref = repo.homepage || repo.html_url;
    const secondaryLabel = repo.homepage ? "Homepage" : "GitHub";
    if (secondaryHref && secondaryHref !== release.html_url) {
      const home = document.createElement("a");
      home.className = "release-chip ghost";
      home.href = secondaryHref;
      home.target = "_blank";
      home.rel = "noopener";
      home.textContent = secondaryLabel;
      dlLinks.push(home);
    }
    if (repo.license) {
      const lic = document.createElement("span");
      lic.className = "release-chip ghost lic";
      lic.textContent = repo.license;
      lic.title = "License";
      dlLinks.push(lic);
    }
    if (dlLinks.length) {
      dlRow = document.createElement("div");
      dlRow.className = "dl-row";
      dlRow.append(...dlLinks);
    }

    c.append(foot);
    if (dlRow) c.append(dlRow);

    // Open the detail modal on card click (ignore clicks on links/buttons).
    c.addEventListener("click", (e) => {
      if (e.target.closest("a, button")) return;
      openModal(repo);
    });
    c.style.cursor = "pointer";
    return c;
  }

  // ---- Detail modal ----
  const modalEl = document.getElementById("modal");
  const modalBody = document.getElementById("modal-body");

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Tags allowed to survive un-escaping from README raw HTML. Everything else
  // stays escaped and renders as plain text, so no script or handler can run.
  const SAFE_HTML_TAGS = new Set([
    "p", "a", "img", "h1", "h2", "h3", "h4", "h5", "h6", "b", "strong", "em", "i",
    "u", "s", "code", "pre", "ul", "ol", "li", "br", "hr", "table", "thead", "tbody",
    "tr", "th", "td", "blockquote", "span", "div", "sub", "sup", "details", "summary",
    "center", "figure", "figcaption", "kbd", "mark", "small",
  ]);

  // Un-escape a whitelisted subset of HTML tags/attributes that GitHub READMEs
  // commonly use (banner <img>, centered <p>, <h1 align=...>, tables, ...).
  // Event handlers, style and non-http src/href are dropped.
  function unescapeSafeTags(s, rawBase) {
    const resolveUrl = (u) => {
      if (/^(https?:|data:image)/i.test(u)) return u;
      if (u.startsWith("#")) return u;
      return rawBase + String(u).replace(/^\\.?\\//, "");
    };
    return s.replace(/&lt;(\\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\\s+[a-zA-Z-]+=(?:"[^"]*"|'[^']*'|[^\\s>]*))*)\\s*\\/?&gt;/g, (m, close, tagName, attrs) => {
      const tag = tagName.toLowerCase();
      if (!SAFE_HTML_TAGS.has(tag)) return m;
      const attrRe = /([a-zA-Z-]+)=("([^"]*)"|'([^']*)'|([^\\s>]+))/g;
      const kept = [];
      let am;
      while ((am = attrRe.exec(attrs))) {
        const name = am[1].toLowerCase();
        const val = am[3] ?? am[4] ?? am[5] ?? "";
        if (name.startsWith("on") || name === "style") continue;
        if (name === "href" && !/^(https?:|mailto:|#|\\/|\\.)/i.test(val)) continue;
        if (name === "src") {
          const resolved = /^(https?:|data:image)/i.test(val) ? val : resolveUrl(val);
          kept.push(name + '="' + resolved.replace(/"/g, "&quot;") + '"');
          continue;
        }
        kept.push(name + '="' + val.replace(/"/g, "&quot;") + '"');
      }
      return "<" + close + tag + (kept.length ? " " + kept.join(" ") : "") + ">";
    });
  }

  // Minimal, safe markdown renderer. Raw HTML is escaped first, then only a
  // whitelisted subset is un-escaped, so no script/event handler ever runs.
  const TICK3 = String.fromCharCode(96).repeat(3);
  const TICK1 = String.fromCharCode(96);
  function mdToHtml(md, repoFull) {
    const rawBase =
      repoFull && repoFull.includes("/")
        ? "https://raw.githubusercontent.com/" + repoFull + "/HEAD/"
        : "";
    const resolveUrl = (u) => {
      if (/^(https?:|data:image)/i.test(u)) return u;
      if (u.startsWith("#")) return u;
      return rawBase + String(u).replace(/^\\.?\\//, "");
    };
    const fence = new RegExp(TICK3 + "([^" + TICK1 + "]*?)" + TICK3, "gs");
    const inline = new RegExp(TICK1 + "([^" + TICK1 + "]+)" + TICK1, "g");
    let html = escapeHtml(md)
      .replace(fence, (m, code) => "<pre><code>" + code.trim() + "</code></pre>")
      .replace(inline, "<code>$1</code>")
      .replace(/^### (.*)$/gm, "<h3>$1</h3>")
      .replace(/^## (.*)$/gm, "<h2>$1</h2>")
      .replace(/^# (.*)$/gm, "<h1>$1</h1>")
      .replace(/\\*\\*([^*]+)\\*\\*/g, "<b>$1</b>")
      .replace(/!\\[([^\\]]*)\\]\\(([^)\\s]+)(?:\\s+&quot;[^)]*&quot;)?\\)/g, (m, alt, u) =>
        '<img src="' + resolveUrl(u).replace(/"/g, "&quot;") + '" alt="' + alt.replace(/"/g, "&quot;") + '" loading="lazy">')
      .replace(/\\[([^\\]]+)\\]\\(([^)\\s]+)\\)/g, (m, t, u) =>
        /^https?:\\/\\//i.test(u)
          ? '<a href="' + u + '" target="_blank" rel="noopener">' + t + "</a>"
          : t)
      .replace(/^- (.*)$/gm, "<li>$1</li>")
      .replace(/^\\d+\\. (.*)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*?<\\/li>)(\\s*(?=<li>))?/gs, "<ul>$1</ul>");
    html = unescapeSafeTags(html, rawBase);
    return html
      .split(/\\n{2,}/)
      .map((block) =>
        block.trim() && !/^<(p|div|img|table|blockquote|details|figure|[ou]l|h[1-6]|pre)/.test(block)
          ? "<p>" + block + "</p>"
          : block)
      .join("\\n");
  }

  async function openModal(repo) {
    const release = repo.release || {};
    const isStore = repo.html_url && !repo.html_url.includes("github.com");
    const head = document.createElement("div");
    head.className = "m-head";
    if (repo.owner && repo.owner.avatar_url) {
      const img = document.createElement("img");
      img.src = repo.owner.avatar_url;
      img.alt = "";
      head.append(img);
    }
    const t = document.createElement("div");
    const title = document.createElement("div");
    title.className = "m-title";
    const titleLink = document.createElement("a");
    titleLink.href = repo.html_url || "#";
    titleLink.target = "_blank";
    titleLink.rel = "noopener";
    titleLink.textContent = repo.full_name;
    title.append(titleLink);
    const sub = document.createElement("div");
    sub.className = "m-sub";
    const subParts = [];
    if (repo.category) subParts.push(repo.category);
    if (repo.language) subParts.push(repo.language);
    if (repo.source && repo.source.startsWith("awesome")) subParts.push("awesome-shizuku");
    sub.textContent = subParts.join(" · ");
    t.append(title, sub);
    head.append(t);
    modalBody.replaceChildren(head);

    if (repo.description) {
      const d = document.createElement("p");
      d.className = "m-desc";
      d.textContent = repo.description;
      modalBody.append(d);
    }

    const meta = document.createElement("div");
    meta.className = "m-meta";
    if (typeof repo.stargazers_count === "number") {
      const s = document.createElement("span");
      s.className = "m-chip";
      s.innerHTML = "★ <b>" + fmt.format(repo.stargazers_count) + "</b> stars";
      meta.append(s);
    }
    if (repo.license) {
      const l = document.createElement("span");
      l.className = "m-chip";
      l.textContent = repo.license;
      l.title = "License";
      meta.append(l);
    }
    if (release.tag) {
      const v = document.createElement("span");
      v.className = "m-chip";
      v.innerHTML = "Release <b>" + escapeHtml(release.tag) + "</b>" + (release.prerelease ? " (pre)" : "");
      meta.append(v);
    }
    if (repo.pushed_at) {
      const u = document.createElement("span");
      u.className = "m-chip";
      u.textContent = "Updated " + new Date(repo.pushed_at).toLocaleDateString();
      meta.append(u);
    }
    modalBody.append(meta);

    const actions = document.createElement("div");
    actions.className = "m-actions";
    const mk = (href, label, ghost) => {
      const a = document.createElement("a");
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = label;
      if (ghost) a.className = "ghost";
      actions.append(a);
    };
    if (release.apk_url) mk(release.apk_url, "⬇ Download APK");
    else if (release.html_url) mk(release.html_url, "View release");
    if (repo.html_url) mk(repo.html_url, isStore ? "Open store page" : "View on GitHub", true);
    if (repo.homepage && repo.homepage !== repo.html_url) mk(repo.homepage, "Homepage", true);
    modalBody.append(actions);

    // README — fetched live from raw.githubusercontent (CORS-open).
    const rd = document.createElement("div");
    rd.className = "m-readme";
    rd.innerHTML = "<h3>README</h3><p class='m-noreadme'>Loading…</p>";
    modalBody.append(rd);
    if (!isStore && repo.full_name.includes("/")) {
      fetch("https://raw.githubusercontent.com/" + encodeURIComponent(repo.full_name) + "/HEAD/README.md", { signal: AbortSignal.timeout(12000) })
        .then((r) => (r.ok ? r.text() : Promise.reject()))
        .then((md) => {
          const mdDiv = document.createElement("div");
          mdDiv.className = "md";
          mdDiv.innerHTML = mdToHtml(md);
          rd.replaceChildren(document.createElement("h3"), mdDiv);
        })
        .catch(() => {
          rd.innerHTML = "<h3>README</h3><p class='m-noreadme'>README not available.</p>";
        });
    } else {
      rd.innerHTML = "<h3>README</h3><p class='m-noreadme'>Store app — no README.</p>";
    }

    modalEl.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    modalEl.classList.add("hidden");
    document.body.style.overflow = "";
    modalBody.replaceChildren();
  }

  modalEl.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modalEl.classList.contains("hidden")) closeModal();
  });

  function visible(repos) {
    const q = el.search.value.trim().toLowerCase();
    let list = repos.filter((r) => {

      const catFilter = el.category ? el.category.value : "all";
      const srcFilter = el.source ? el.source.value : "all";
      if (catFilter !== "all" && (r.category || "Miscellaneous") !== catFilter) return false;
      if (srcFilter === "awesome" && !(r.source && r.source.startsWith("awesome"))) return false;
      if (srcFilter === "search" && r.source && r.source.startsWith("awesome")) return false;
      if (el.apk && el.apk.checked && !(r.release && r.release.apk_url)) return false;
      if (el.favOnly && el.favOnly.checked && !favorites.has(r.full_name)) return false;
      const recDays = el.recency ? parseInt(el.recency.value, 10) : 0;
      if (recDays) {
        const ts = lastActivity(r);
        if (!ts || Date.now() - new Date(ts).getTime() > recDays * 86400000) return false;
      }
      if (!q) return true;
      return (
        r.full_name.toLowerCase().includes(q) ||
        (r.description || "").toLowerCase().includes(q) ||
        (r.summary || "").toLowerCase().includes(q) ||
        (r.package || "").toLowerCase().includes(q) ||
        (r.language || "").toLowerCase().includes(q) ||
        (r.release && r.release.tag ? r.release.tag.toLowerCase().includes(q) : false) ||
        (r.scope || r.topics || []).some((t) => t.toLowerCase().includes(q)) ||
        (r.owner && r.owner.login.toLowerCase().includes(q))
      );
    });
    const sortBy = el.sort.value;
    list = list.slice().sort((a, b) => {
      if (sortBy === "name") return a.full_name.localeCompare(b.full_name);
      if (sortBy === "updated") {
        const ca = a.pushed_at || a.updated_at || "";
        const cb = b.pushed_at || b.updated_at || "";
        return cb.localeCompare(ca);
      }
      if (sortBy === "released") {
        const ra = a.release && a.release.published_at ? a.release.published_at : "";
        const rb = b.release && b.release.published_at ? b.release.published_at : "";
        return rb.localeCompare(ra);
      }
      if (sortBy === "added") return (b.added_at || "").localeCompare(a.added_at || "");
      return (b.stargazers_count || 0) - (a.stargazers_count || 0);
    });
    return list;
  }

  // Favorites persist in localStorage keyed by repo full_name.
  const FAV_KEY = "shizuku-favs";
  let favorites = new Set();
  try {
    favorites = new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]"));
  } catch {}
  const saveFavs = () => {
    try { localStorage.setItem(FAV_KEY, JSON.stringify([...favorites])); } catch {}
  };
  const toggleFav = (name, btn) => {
    if (favorites.has(name)) favorites.delete(name);
    else favorites.add(name);
    saveFavs();
    if (btn) btn.classList.toggle("on", favorites.has(name));
    render();
  };

  function render() {
    const list = visible(DATA.repos);
    const slice = list.slice(0, shown);
    el.grid.replaceChildren(...slice.map(card));
    el.empty.classList.toggle("hidden", list.length !== 0);
    el.pager.classList.toggle("hidden", list.length <= shown);
    el.count.textContent = list.length + " of " + DATA.repos.length + " apps";
    // Keep the URL shareable: mirrors the current filters.
    const p = new URLSearchParams();
    if (el.search.value) p.set("q", el.search.value);
    if (el.category.value !== "all") p.set("cat", el.category.value);
    if (el.source.value !== "all") p.set("src", el.source.value);
    if (el.sort.value !== "updated") p.set("sort", el.sort.value);
    if (el.recency.value !== "all") p.set("rec", el.recency.value);
    if (el.apk.checked) p.set("apk", "1");
    if (el.favOnly.checked) p.set("fav", "1");
    const qs = p.toString();
    history.replaceState(null, "", qs ? "?" + qs : location.pathname);
  }

  const filterChanged = () => { shown = PAGE_SIZE; render(); };
  el.search.addEventListener("input", filterChanged);
  el.sort.addEventListener("change", filterChanged);
  el.category.addEventListener("change", filterChanged);
  el.source.addEventListener("change", filterChanged);
  el.recency.addEventListener("change", filterChanged);
  el.apk.addEventListener("change", filterChanged);
  el.favOnly.addEventListener("change", filterChanged);
  el.loadMore.addEventListener("click", () => {
    shown += PAGE_SIZE;
    render();
  });
  el.loadAll.addEventListener("click", () => {
    shown = Number.MAX_SAFE_INTEGER;
    render();
  });
  window.addEventListener("popstate", render);
  render();
})();
</script>
</body>
</html>
`;
}


main().catch((err) => {
  console.error(err);
  process.exit(1);
});
