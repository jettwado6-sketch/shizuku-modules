#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_FILE = path.join(ROOT, "data", "repos.json");
const SITE_DIR = path.join(ROOT, "site");
const OUT_FILE = path.join(SITE_DIR, "index.html");

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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
  const categories = [...new Set(repos.map((r) => r.category || "Miscellaneous"))].sort();
  const awesomeCount = repos.filter((r) => r.source && r.source.startsWith("awesome")).length;

  const data = {
    generated_at: new Date().toISOString(),
    total: repos.length,
    fresh: freshCount,
    awesome: awesomeCount,
    categories,
    repos,
  };

  fs.mkdirSync(SITE_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, render(data));
  console.log(
    `Built ${OUT_FILE} (${repos.length} apps, ${freshCount} new this week, ${awesomeCount} from awesome-shizuku)`
  );
}

function render(data) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shizuku Apps Directory</title>  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='7' fill='%235C6BC0'/%3E%3Ctext x='8' y='12' font-size='10' font-family='sans-serif' font-weight='bold' text-anchor='middle' fill='white'%3ES%3C/text%3E%3C/svg%3E">
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
    --paid: #f0b429;
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
  header { padding: 56px 24px 40px; text-align: center; }
  .logo { display: inline-flex; align-items: center; gap: 14px; font-size: 40px; font-weight: 800; letter-spacing: -.5px; }
  .logo-badge {
    width: 52px; height: 52px; border-radius: 14px;
    background: linear-gradient(135deg, var(--accent), var(--accent-3));
    display: grid; place-items: center;
    font-size: 26px; font-weight: 900; color: #fff;
    box-shadow: 0 8px 30px rgba(92, 107, 192, .35);
  }
  .logo .grad { background: linear-gradient(90deg, var(--accent), var(--accent-3)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .tagline { color: var(--muted); margin-top: 10px; font-size: 16px; }
  .stats { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 24px; }
  .stat { background: var(--card); border: 1px solid var(--border); border-radius: 999px; padding: 8px 18px; font-size: 14px; color: var(--muted); }
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
    width: 100%; background: var(--card); color: var(--text);
    border: 1px solid var(--border); border-radius: 10px;
    padding: 10px 14px 10px 38px; font-size: 15px; outline: none;
    transition: border-color .15s, box-shadow .15s;
  }
  #search:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(92, 107, 192, .18); }
  select { background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; font-size: 14px; outline: none; cursor: pointer; }

  #count { margin-left: auto; color: var(--muted); font-size: 13px; }
  main { flex: 1; max-width: 1200px; margin: 0 auto; padding: 0 24px 60px; width: 100%; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 16px; }
  .card {
    background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 18px; display: flex; flex-direction: column; gap: 12px;
    transition: transform .15s ease, border-color .15s ease, background .15s ease;
  }
  .card:hover { transform: translateY(-3px); border-color: #33414f; background: var(--card-hover); }
  .card-top { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .avatar { width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0; background: var(--bg-soft); border: 1px solid var(--border); }
  .card-name { min-width: 0; }
  .card-name a { color: var(--text); text-decoration: none; font-weight: 700; font-size: 15px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-name a:hover { color: var(--accent); }
  .card-owner { color: var(--muted); font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .desc { color: #b6c2cf; font-size: 13.5px; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; min-height: 61px; }
  .desc:empty::before { content: "No description provided."; color: var(--archived); }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .tag { font-size: 11.5px; padding: 3px 9px; border-radius: 999px; background: var(--bg-soft); color: var(--muted); border: 1px solid var(--border); max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-foot { display: flex; align-items: center; flex-wrap: wrap; row-gap: 8px; gap: 14px; font-size: 12.5px; color: var(--muted); border-top: 1px solid var(--border); padding-top: 12px; margin-top: auto; }
  .stars { color: var(--text); font-weight: 700; display: inline-flex; align-items: center; gap: 4px; }
  .star-icon { color: #e8b339; }
  .lang { display: inline-flex; align-items: center; gap: 5px; }
  .lang-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--dot, #8b98a5); }
  .updated { margin-left: auto; }
  .badges { display: flex; gap: 6px; flex-wrap: wrap; }
  .badge { font-size: 10.5px; font-weight: 700; letter-spacing: .4px; padding: 3px 8px; border-radius: 6px; text-transform: uppercase; }
  .badge.new { background: rgba(63, 185, 80, .15); color: var(--new); border: 1px solid rgba(63, 185, 80, .35); }
  .badge.archived { background: rgba(110, 118, 129, .15); color: var(--archived); border: 1px solid rgba(110, 118, 129, .35); }
  .badge.category { background: rgba(92, 107, 192, .12); color: var(--accent-2); border: 1px solid rgba(92, 107, 192, .3); }
  .badge.paid { background: rgba(240, 180, 41, .15); color: var(--paid); border: 1px solid rgba(240, 180, 41, .35); }
  .badge.awesome { background: rgba(139, 92, 246, .15); color: #a78bfa; border: 1px solid rgba(139, 92, 246, .35); }
  .dl-row { display: flex; }
  .release-chip {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    width: 100%; font-size: 12.5px; font-weight: 700; color: #06121f;
    background: var(--accent); border: 1px solid var(--accent);
    padding: 8px 12px; border-radius: 8px; text-decoration: none;
    transition: background .15s, border-color .15s;
  }
  .release-chip:hover { background: #3F51B5; border-color: #3F51B5; }
  .empty { text-align: center; color: var(--muted); padding: 60px 0; font-size: 15px; }
  .hidden { display: none; }
  footer { position: sticky; bottom: 0; background: rgba(11, 15, 20, .88); backdrop-filter: blur(12px); border-top: 1px solid var(--border); }
  .footer-inner { max-width: 1200px; margin: 0 auto; display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; padding: 10px 24px; color: var(--muted); font-size: 12.5px; text-align: center; }
  .gen-line b { color: var(--accent); font-weight: 600; }
  #gen-date { color: var(--text); font-weight: 600; }
  footer a { color: var(--accent); text-decoration: none; }
  footer a:hover { text-decoration: underline; }
  @media (max-width: 1024px) { .grid { grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); } }
  @media (max-width: 900px) { .toolbar { gap: 10px; } .search-wrap { flex: 1 1 100%; } }
  @media (max-width: 640px) { header { padding: 40px 16px 28px; } .logo { font-size: 26px; } .tagline { font-size: 14px; } .stats { gap: 8px; margin-top: 18px; } .stat { padding: 6px 14px; font-size: 13px; } .toolbar { padding: 10px 16px; margin-bottom: 20px; } select { flex: 1 1 45%; padding: 9px 10px; } main { padding: 0 16px 48px; } .grid { grid-template-columns: minmax(0, 1fr); gap: 12px; } .card { padding: 16px; } }
  @media (max-width: 480px) { #count { display: none; } .badges { flex-wrap: wrap; } .toolbar { gap: 8px; } }
</style>
</head>
<body>
<header>
  <div class="logo"><span class="grad">Shizuku Apps Directory</span></div>
  <p class="tagline">Curated collection of apps using Shizuku &mdash; updated daily.</p>
  <div class="stats">
    <span class="stat"><b id="stat-total">0</b> apps</span>
    <span class="stat"><b id="stat-awesome">0</b> from awesome-shizuku</span>
    <span class="stat"><b id="stat-new">0</b> new this week</span>
    <span class="stat">Updated <b id="stat-updated">&mdash;</b></span>
  </div>
</header>
<div class="toolbar">
  <div class="search-wrap">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
    <input id="search" type="search" placeholder="Search apps, topics, languages&hellip;" autocomplete="off">
  </div>
  <select id="sort" aria-label="Sort order">
    <option value="stars">Sort: Most stars</option>
    <option value="updated">Sort: Updated</option>
    <option value="name">Sort: Name A&ndash;Z</option>
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
  <span id="count"></span>
</div>
<main>
  <div id="grid" class="grid"></div>
  <p id="empty" class="empty hidden">No apps match your search.</p>
</main>
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
    grid: document.getElementById("grid"), empty: document.getElementById("empty"),
    count: document.getElementById("count"), search: document.getElementById("search"),
    sort: document.getElementById("sort"), category: document.getElementById("category-filter"),
    source: document.getElementById("source-filter"),
  };
  document.getElementById("stat-total").textContent = fmtFull.format(DATA.total);
  document.getElementById("stat-awesome").textContent = fmtFull.format(DATA.awesome || 0);
  document.getElementById("stat-new").textContent = fmtFull.format(DATA.fresh);
  const gen = new Date(DATA.generated_at);
  document.getElementById("stat-updated").textContent = gen.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  document.getElementById("gen-date").textContent = gen.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  (DATA.categories || []).forEach((cat) => {
    const opt = document.createElement("option"); opt.value = cat; opt.textContent = cat; el.category.append(opt);
  });
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
    const c = document.createElement("article"); c.className = "card";
    const top = document.createElement("div"); top.className = "card-top";
    const img = document.createElement("img"); img.className = "avatar"; img.alt = ""; img.loading = "lazy";
    img.src = repo.owner && repo.owner.avatar_url ? repo.owner.avatar_url : "";
    if (!img.src) img.style.display = "none";
    img.addEventListener("error", () => { img.style.display = "none"; });
    const names = document.createElement("div"); names.className = "card-name";
    const a = document.createElement("a"); a.href = repo.html_url || "#"; a.target = "_blank"; a.rel = "noopener";
    a.textContent = repo.full_name; names.append(a);
    const owner = document.createElement("div"); owner.className = "card-owner";
    owner.textContent = repo.owner && repo.owner.login ? "@" + repo.owner.login : ""; names.append(owner);
    top.append(img, names); c.append(top);
    const desc = document.createElement("p"); desc.className = "desc";
    desc.textContent = repo.description || ""; c.append(desc);
    const tags = (repo.topics || []).slice(0, 5);
    if (tags.length) {
      const tagsEl = document.createElement("div"); tagsEl.className = "tags";
      tags.forEach((t) => { const s = document.createElement("span"); s.className = "tag"; s.textContent = t; tagsEl.append(s); });
      const remaining = (repo.topics || []).length - 5;
      if (remaining > 0) { const more = document.createElement("span"); more.className = "tag"; more.textContent = "+" + remaining; tagsEl.append(more); }
      c.append(tagsEl);
    }
    const foot = document.createElement("div"); foot.className = "card-foot";
    if (typeof repo.stargazers_count === "number" && repo.stargazers_count > 0) {
      const stars = document.createElement("span"); stars.className = "stars";
      const starIcon = document.createElement("span"); starIcon.className = "star-icon"; starIcon.textContent = "\\u2605";
      stars.append(starIcon, document.createTextNode(" " + fmt.format(repo.stargazers_count))); foot.append(stars);
    }
    if (repo.language) {
      const lang = document.createElement("span"); lang.className = "lang";
      const dot = document.createElement("span"); dot.className = "lang-dot";
      dot.style.setProperty("--dot", LANG_COLORS[repo.language] || "#8b98a5");
      lang.append(dot, document.createTextNode(repo.language)); foot.append(lang);
    }
    const badges = document.createElement("span"); badges.className = "badges";
    if (repo.category) { const b = document.createElement("span"); b.className = "badge category"; b.textContent = repo.category; badges.append(b); }
    if (repo.added_at && Date.now() - new Date(repo.added_at).getTime() < 7 * 86400000) { const b = document.createElement("span"); b.className = "badge new"; b.textContent = "New"; badges.append(b); }
    if (repo.archived) { const b = document.createElement("span"); b.className = "badge archived"; b.textContent = "Archived"; badges.append(b); }
    if (repo.isPaid) { const b = document.createElement("span"); b.className = "badge paid"; b.textContent = "Paid"; badges.append(b); }
    if (repo.source && repo.source.startsWith("awesome")) { const b = document.createElement("span"); b.className = "badge awesome"; b.textContent = "awesome-shizuku"; badges.append(b); }
    if (badges.childElementCount) foot.append(badges);
    const updated = document.createElement("span"); updated.className = "updated";
    const commitAt = repo.pushed_at || repo.updated_at;
    if (commitAt) updated.textContent = "updated " + timeAgo(commitAt);
    foot.append(updated); c.append(foot);
    const release = repo.release || {};
    if (release.tag) {
      const dlRow = document.createElement("div"); dlRow.className = "dl-row";
      const rel = document.createElement("a"); rel.className = "release-chip";
      rel.href = release.apk_url || release.html_url || "#"; rel.target = "_blank"; rel.rel = "noopener";
      rel.textContent = release.apk_url ? "Download APK" : "View release";
      dlRow.append(rel); c.append(dlRow);
    }
    return c;
  }
  function visible(repos) {
    const q = el.search.value.trim().toLowerCase();
    const catFilter = el.category.value;
    const srcFilter = el.source.value;
    let list = repos.filter((r) => {
      if (!(r.release && r.release.apk_url)) return false;
      if (catFilter !== "all" && (r.category || "Miscellaneous") !== catFilter) return false;
      if (srcFilter === "awesome" && !(r.source && r.source.startsWith("awesome"))) return false;
      if (srcFilter === "search" && r.source && r.source.startsWith("awesome")) return false;
      if (!q) return true;
      return (
        r.full_name.toLowerCase().includes(q) ||
        (r.description || "").toLowerCase().includes(q) ||
        (r.language || "").toLowerCase().includes(q) ||
        (r.topics || []).some((t) => t.toLowerCase().includes(q)) ||
        (r.owner && r.owner.login && r.owner.login.toLowerCase().includes(q))
      );
    });
    const sortBy = el.sort.value;
    list = list.slice().sort((a, b) => {
      if (sortBy === "name") return a.full_name.localeCompare(b.full_name);
      if (sortBy === "updated") return (b.pushed_at || b.updated_at || "").localeCompare(a.pushed_at || a.updated_at || "");
      if (sortBy === "released") return ((b.release && b.release.published_at) || "").localeCompare((a.release && a.release.published_at) || "");
      if (sortBy === "added") return (b.added_at || "").localeCompare(a.added_at || "");
      return (b.stargazers_count || 0) - (a.stargazers_count || 0);
    });
    return list;
  }
  function render() {
    const list = visible(DATA.repos);
    el.grid.replaceChildren(...list.map(card));
    el.empty.classList.toggle("hidden", list.length !== 0);
    el.count.textContent = list.length + " of " + DATA.repos.length + " apps";
  }
  el.search.addEventListener("input", render);
  el.sort.addEventListener("change", render);
  el.category.addEventListener("change", render);
  el.source.addEventListener("change", render);
  render();
})();
</script>
</body>
</html>`;
}

main().catch((err) => { console.error(err); process.exit(1); });
