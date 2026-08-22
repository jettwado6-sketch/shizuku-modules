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
  const freshCount = repos.filter(
    (r) => r.added_at && now - new Date(r.added_at).getTime() < WEEK_MS
  ).length;
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
  console.log(
    `Built ${OUT_FILE} (${repos.length} repos, ${freshCount} new this week, visitor stats: ${JSON.stringify(data.visitorStats)})`
  );
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
    display: inline-flex; align-items: center; gap: 8px;
    color: var(--muted); font-size: 14px; cursor: pointer; user-select: none;
    padding: 10px 6px;
  }
  .check input { accent-color: var(--accent); width: 16px; height: 16px; cursor: pointer; }
  .load-more {
    display: block; margin: 28px auto; padding: 12px 34px;
    background: var(--card); color: var(--text); border: 1px solid var(--border);
    border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer;
    font-family: inherit; transition: background .15s, border-color .15s;
  }
  .load-more:hover { background: var(--card-hover); border-color: var(--accent); }
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
  .app-api {
    flex-shrink: 0;
    font-size: 11px; font-weight: 700; letter-spacing: .2px;
    color: #7dd3fc;
    background: rgba(125, 211, 252, .1); border: 1px solid rgba(125, 211, 252, .22);
    padding: 1px 7px; border-radius: 999px;
  }
  .dl-row { display: flex; }
  .release-chip {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    width: 100%;
    font-size: 12.5px; font-weight: 700; color: #06121f;
    background: var(--accent); border: 1px solid var(--accent);
    padding: 8px 12px; border-radius: 8px; text-decoration: none;
    transition: background .15s, border-color .15s;
  }
  .release-chip:hover { background: #0ea5e9; border-color: #0ea5e9; }
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
</style>
</head>
<body>
<header id="top">
  <div class="logo"><span class="grad">Shizuku Apps Directory</span></div>
  <p class="tagline">Mega collection of apps using Shizuku — updated daily.</p>
  <div class="stats">
    <span class="stat"><b id="stat-total">0</b> apps</span>
    <span class="stat"><b id="stat-awesome">0</b> from awesome-shizuku</span>
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
  <label class="check" title="Only show apps that publish an APK in their GitHub releases">
    <input id="apk-only" type="checkbox" checked> Only with APK
  </label>
  <label class="check" title="Show only apps you have starred">
    <input id="fav-only" type="checkbox"> ★ Favorites
  </label>

  <span id="count"></span>
</div>

<main>
  <div id="grid" class="grid"></div>
  <button id="load-more" class="load-more hidden">Show more apps</button>
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
  </div>
</footer>

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
    apk: document.getElementById("apk-only"),
    favOnly: document.getElementById("fav-only"),
    loadMore: document.getElementById("load-more"),
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

  // Shareable URL state: ?q=...&cat=...&src=...&sort=...&apk=0|1&fav=0|1
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
    if (el.apk && params.get("apk") === "0") el.apk.checked = false;
    if (el.favOnly && params.get("fav") === "1") el.favOnly.checked = true;
  };
  applyParams();

  document.getElementById("stat-total").textContent = fmtFull.format(DATA.total);
  document.getElementById("stat-awesome").textContent = fmtFull.format((DATA.awesome || 0));
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
    if (repo.added_at && Date.now() - new Date(repo.added_at).getTime() < 7 * 86400000) {
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
    if (release.tag) {
      dlRow = document.createElement("div");
      dlRow.className = "dl-row";
      const rel = document.createElement("a");
      rel.className = "release-chip" + (release.prerelease ? " prerelease" : "");
      rel.href = release.apk_url || release.html_url || "#";
      rel.target = "_blank";
      rel.rel = "noopener";
      rel.textContent = release.apk_url ? "Download" : "View release";
      rel.title =
        "Release " + (release.name || release.tag) +
        (release.published_at
          ? " \u00b7 " + new Date(release.published_at).toLocaleDateString()
          : "") +
        (release.apk_url ? " \u00b7 direct APK download" : "");
      dlRow.append(rel);
    }

    c.append(foot);
    if (release.tag) c.append(dlRow);
    return c;
  }

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
    el.loadMore.classList.toggle("hidden", list.length <= shown);
    el.count.textContent = list.length + " of " + DATA.repos.length + " apps";
    // Keep the URL shareable: mirrors the current filters.
    const p = new URLSearchParams();
    if (el.search.value) p.set("q", el.search.value);
    if (el.category.value !== "all") p.set("cat", el.category.value);
    if (el.source.value !== "all") p.set("src", el.source.value);
    if (el.sort.value !== "updated") p.set("sort", el.sort.value);
    if (!el.apk.checked) p.set("apk", "0");
    if (el.favOnly.checked) p.set("fav", "1");
    const qs = p.toString();
    history.replaceState(null, "", qs ? "?" + qs : location.pathname);
  }

  const filterChanged = () => { shown = PAGE_SIZE; render(); };
  el.search.addEventListener("input", filterChanged);
  el.sort.addEventListener("change", filterChanged);
  el.category.addEventListener("change", filterChanged);
  el.source.addEventListener("change", filterChanged);
  el.apk.addEventListener("change", filterChanged);
  el.favOnly.addEventListener("change", filterChanged);
  el.loadMore.addEventListener("click", () => {
    shown += PAGE_SIZE;
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
