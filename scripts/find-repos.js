#!/usr/bin/env node
"use strict";

/**
 * Build a curated list of Android apps that use Shizuku.
 *
 * Usage:
 *   node scripts/find-repos.js [--max-pages N] [--delay MS] [--queries "q1|q2"]
 *                               [--ignore-ttl-days N] [--release-ttl-days N]
 *                               [--stale-days N] [--no-awesome]
 *
 * Two discovery sources:
 *   1. GitHub search + Shizuku dependency verification (big queries are
 *      auto-sliced by star ranges so nothing past the 1000-result cap is missed)
 *   2. awesome-shizuku curated lists (main README + CLOSED_SOURCE, ARCHIVED, RISH pages)
 *
 * Set GITHUB_TOKEN for higher rate limits.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "repos.json");
const IGNORED_FILE = path.join(DATA_DIR, "ignored.json");

// ---- GitHub search config ----
const DEFAULT_QUERIES = [
  "topic:shizuku",
  "topic:shizuku-app",
  "topic:shizuku-module",
  '"shizuku" in:name,description',
  '"shizuku" in:readme',
  "dev.rikka.shizuku in:readme",
  "rikka.shizuku in:readme",
];
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_DELAY_MS = 2000;
const DEFAULT_IGNORE_TTL_DAYS = 30;
const DEFAULT_RELEASE_TTL_DAYS = 7;
const DEFAULT_STALE_DAYS = 90;
const CONCURRENCY = 24;

// GitHub search caps results at 1000 per query. When a query reports a larger
// total, we slice it into disjoint star ranges so every repo is reachable.
const MAX_SEARCH_RESULTS = 1000;
const STAR_BUCKETS = [
  "stars:>=1000",
  "stars:500..999",
  "stars:100..499",
  "stars:50..99",
  "stars:20..49",
  "stars:10..19",
  "stars:5..9",
  "stars:0..4",
];

// ---- awesome-shizuku sources ----
const AWESOME_OWNER = "timschneeb";
const AWESOME_REPO = "awesome-shizuku";
const AWESOME_MD_PATHS = [
  { path: "README.md", label: "awesome-shizuku" },
  { path: "pages/CLOSED_SOURCE.md", label: "awesome-shizuku-closed-source" },
  { path: "pages/ARCHIVED.md", label: "awesome-shizuku-archived" },
];

// ---- Shizuku verification ----
const GRADLE_PROBE_PATHS = [
  "app/build.gradle",
  "app/build.gradle.kts",
  "build.gradle",
  "build.gradle.kts",
  "gradle/libs.versions.toml",
];
const SHIZUKU_MARKERS = [
  "dev.rikka.shizuku",
  "rikka.shizuku",
  "rikka.shizuku.api",
  "rikka.shizuku.runner",
];

function parseArgs(argv) {
  const args = {
    queries: DEFAULT_QUERIES,
    maxPages: DEFAULT_MAX_PAGES,
    delay: DEFAULT_DELAY_MS,
    ignoreTtlDays: DEFAULT_IGNORE_TTL_DAYS,
    releaseTtlDays: DEFAULT_RELEASE_TTL_DAYS,
    staleDays: DEFAULT_STALE_DAYS,
    noAwesome: false,
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--max-pages":
        args.maxPages = parseInt(argv[++i], 10) || DEFAULT_MAX_PAGES;
        break;
      case "--delay":
        args.delay = parseInt(argv[++i], 10) || DEFAULT_DELAY_MS;
        break;
      case "--queries":
        args.queries = argv[++i].split("|").map((q) => q.trim()).filter(Boolean);
        break;
      case "--ignore-ttl-days":
        args.ignoreTtlDays = parseInt(argv[++i], 10) || DEFAULT_IGNORE_TTL_DAYS;
        break;
      case "--release-ttl-days":
        args.releaseTtlDays = parseInt(argv[++i], 10) || DEFAULT_RELEASE_TTL_DAYS;
        break;
      case "--stale-days":
        args.staleDays = parseInt(argv[++i], 10) || DEFAULT_STALE_DAYS;
        break;
      case "--no-awesome":
        args.noAwesome = true;
        break;
      default:
        console.warn(`Unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let quietWarnings = false;

function requestHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "shizuku-apps-directory",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function pickRepo(item) {
  return {
    full_name: item.full_name,
    html_url: item.html_url,
    description: item.description || "",
    homepage: item.homepage || "",
    stargazers_count: item.stargazers_count || 0,
    forks_count: item.forks_count || 0,
    language: item.language || "",
    topics: Array.isArray(item.topics) ? item.topics : [],
    archived: !!item.archived,
    owner: item.owner
      ? { login: item.owner.login, avatar_url: item.owner.avatar_url }
      : null,
    created_at: item.created_at || "",
    updated_at: item.updated_at || "",
    pushed_at: item.pushed_at || "",
  };
}

// Fetch one page of search results; returns { items, total, ok, rateLimited }.
async function searchPage(query, page, delay) {
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", withNoForks(query));
  url.searchParams.set("per_page", "100");
  url.searchParams.set("page", String(page));
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  if (delay > 0 && page > 1) await sleep(delay);
  const res = await githubGet(url);
  if (!res) return { items: [], total: 0, ok: false, rateLimited: false };
  if (!res.ok) return { items: [], total: 0, ok: false, rateLimited: !!res.rateLimited };
  const body = await res.json();
  return {
    items: Array.isArray(body.items) ? body.items : [],
    total: body.total_count ?? 0,
    ok: true,
    rateLimited: false,
  };
}

async function searchRepositories(query, maxPages, delay) {
  const found = [];
  const first = await searchPage(query, 1, 0);
  if (!first.ok) return { found, stopped: first.rateLimited };
  found.push(...first.items);

  // Queries whose total exceeds GitHub's 1000-result cap are sliced into
  // disjoint star ranges so nothing past the cap is silently missed.
  if (first.total > MAX_SEARCH_RESULTS) {
    console.log(`  [${query}] ${first.total} matches — slicing by stars to beat the 1000-result cap`);
    for (const bucket of STAR_BUCKETS) {
      const sliced = await searchPage(`${query} ${bucket}`, 1, 0);
      if (!sliced.ok) return { found, stopped: sliced.rateLimited };
      found.push(...sliced.items);
      console.log(`    [${query} ${bucket}] page 1: ${sliced.items.length} repos (${sliced.total} in bucket)`);
      for (let page = 2; page <= maxPages; page++) {
        const next = await searchPage(`${query} ${bucket}`, page, delay);
        if (!next.ok) return { found, stopped: next.rateLimited };
        if (next.items.length === 0) break;
        found.push(...next.items);
        if (next.items.length < 100) break;
      }
    }
    return { found, stopped: false };
  }

  console.log(`  [${query}] page 1: ${first.items.length} repos (${first.total} match in total)`);
  for (let page = 2; page <= maxPages; page++) {
    const next = await searchPage(query, page, delay);
    if (!next.ok) return { found, stopped: next.rateLimited };
    if (next.items.length === 0) break;
    found.push(...next.items);
    console.log(`  [${query}] page ${page}: ${next.items.length} repos`);
    if (next.items.length < 100) break;
  }
  return { found, stopped: false };
}

async function githubGet(url, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 4;
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt++;
    try {
      const res = await fetch(url, { headers: requestHeaders(), signal: AbortSignal.timeout(20000) });
      if (res.ok) return res;
      if (res.status === 403 || res.status === 429) {
        const remaining = res.headers.get("x-ratelimit-remaining");
        const retryAfter = res.headers.get("retry-after");
        if (attempt < maxAttempts) {
          // Back off on Retry-After if GitHub gave one, else exponential backoff.
          const waitMs = retryAfter
            ? Math.min(parseInt(retryAfter, 10) * 1000 || 5000, 30000)
            : Math.min(2000 * 2 ** (attempt - 1), 30000);
          if (!quietWarnings) {
            console.warn(`  Rate limited (HTTP ${res.status}), remaining: ${remaining ?? "?"} — retrying in ${Math.round(waitMs / 1000)}s (${attempt}/${maxAttempts})`);
          }
          await sleep(waitMs);
          continue;
        }
        if (!quietWarnings) {
          console.warn(`  Rate limited (HTTP ${res.status}), remaining: ${remaining ?? "?"}`);
        }
        return { ok: false, rateLimited: remaining === "0" };
      }
      return res;
    } catch (err) {
      if (attempt < maxAttempts) {
        await sleep(1000 * attempt);
        continue;
      }
      console.warn(`  Network error: ${err.message}`);
      return null;
    }
  }
  return null;
}

function withNoForks(query) {
  return /\bfork:/i.test(query) ? query : `${query} fork:false`;
}

async function rawFetch(fullName, filePath) {
  const [owner, repo] = fullName.split("/");
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/HEAD/${encodedPath}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (res.status === 200) return { ok: true, body: await res.text() };
    return { ok: false, body: null };
  } catch {
    return { ok: false, body: null };
  }
}

async function verifyShizukuUsage(fullName) {
  for (const gradlePath of GRADLE_PROBE_PATHS) {
    const r = await rawFetch(fullName, gradlePath);
    if (!r.ok) continue;
    const content = r.body.toLowerCase();
    for (const marker of SHIZUKU_MARKERS) {
      if (content.includes(marker)) {
        return { verified: true, marker: gradlePath };
      }
    }
  }
  return { verified: false, marker: null };
}

function hasShizukuTopic(repo) {
  const topics = (repo.topics || []).map((t) => t.toLowerCase());
  return topics.some((t) => t.includes("shizuku"));
}

async function treeCheck(repo) {
  const branch = repo.default_branch || "HEAD";
  const url = `https://api.github.com/repos/${repo.full_name}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const res = await githubGet(url);
  if (!res || !res.ok) return { verified: false, marker: null };
  try {
    const body = await res.json();
    const hit = (body.tree || [])
      .map((f) => f.path)
      .find((p) => /build\.gradle(\.kts)?$/.test(p) || /libs\.versions\.toml$/.test(p));
    return hit ? { verified: true, marker: hit } : { verified: false, marker: null };
  } catch {
    return { verified: false, marker: null };
  }
}

async function runPool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

function guessCategory(repo) {
  const text = [
    repo.description || "",
    (repo.topics || []).join(" "),
    repo.full_name,
  ].join(" ").toLowerCase();

  // Keyword -> category, ordered most-specific first. Short, ambiguous words
  // ("ai", "log", "tv") use word-boundary matching so "available" doesn't
  // match "ai" and "logcat" doesn't match "log" before "debug" does.
  const CATEGORY_KEYWORDS = [
    ["Device Owner (DPM)", ["device owner", "dpm", "work profile"]],
    ["Patching", ["revanced", "patcher", "patch", "magisk"]],
    ["AI agents", ["\bai\b", "\bllm\b", "\bmcp\b", "chatgpt", "\bllama\b", "ai agent"]],
    ["Automation", ["automat", "tasker", "macro", "workflow", "\bscript\b"]],
    ["Privacy", ["privacy", "permission", "appops", "tracker", "firewall", "\bvpn\b"]],
    ["Software management", ["app manager", "debloat", "freeze", "uninstall", "disable", "backup"]],
    ["Installer & app stores", ["installer", "\bapk\b", "app store", "updater", "package installer", "split apk"]],
    ["Task manager", ["task manager", "\bprocess\b", "\bkill\b", "\bmemory\b", "\bram\b"]],
    ["Power management", ["battery", "charging", "\bpower\b", "wake", "suspend", "\bdoze\b"]],
    ["File management", ["file manager", "file explorer", "file access", "\bstorage\b", "sd card", "root explorer"]],
    ["Network", ["\bwifi\b", "\bbluetooth\b", "\bnfc\b", "\bdns\b", "network", "\bproxy\b", "5g", "\blte\b"]],
    ["Audio", ["\baudio\b", "\bvolume\b", "\bsound\b", "music", "equalizer", "\bdsp\b", "microphone"]],
    ["Input methods", ["keyboard", "keymap", "\binput\b", "gesture", "\btouch\b", "button remap"]],
    ["Display management", ["display", "refresh rate", "\bscreen\b", "brightness", "\bhz\b", "rotation", "resolution"]],
    ["Quick settings", ["quick setting", "qs tile", "\btile\b", "toggle"]],
    ["Terminals", ["terminal", "termux", "console", "shell emulator"]],
    ["Development utilities", ["debug", "developer", "\badb\b", "\blog\b", "\bshell\b", "inspector", "monitor", "\btest\b"]],
    ["Entertainment", ["\bmedia\b", "\bvideo\b", "\bstream\b", "manga", "anime", "\bgame\b", "\bplayer\b"]],
    ["Productivity", ["productiv", "\bnote\b", "\btodo\b", "\bcalendar\b", "\btimer\b", "\bfocus\b"]],
    ["Communication", ["\bchat\b", "\bmessage\b", "\bcall\b", "\bsms\b", "discord", "telegram"]],
    ["Games", ["\bgaming\b", "controller", "emulator", "gacha"]],
    ["Customization", ["theme", "customiz", "wallpaper", "\bicon\b", "launcher", "dark mode", "\baccent\b", "\bcolor\b", "material", "\bfont\b", "animation"]],
    ["Vendor-specific", ["pixel", "samsung", "xiaomi", "oneui", "miui", "oppo", "vivo", "oneplus"]],
    ["Android TV", ["android tv", "\btv\b", "leanback", "fire tv"]],
  ];

  for (const [cat, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((kw) => new RegExp(kw).test(text))) return cat;
  }
  return "Miscellaneous";
}

// ============================================================
// Source 2: Parse awesome-shizuku markdown lists
// ============================================================

// Extract GitHub owner/repo from a URL (returns null for non-GitHub links)
function parseGithubRepoUrl(url) {
  const m = String(url || "").match(/github\.com\/([^/]+)\/([^/?#]+)/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

// Parse a single markdown list item line into an app entry
// Format: * [Name](URL) - Description `License` [(Source code)](source_url)
// Also handles: * [Name](URL) ✨ - Description `License`
function parseAwesomeLine(line, category) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("* [") && !trimmed.startsWith("- [")) return null;

  // Skip ToC entries: - [Category](#category-slug) or * [Category](#category-slug)
  if (/^\s*[-*]\s*\[.+?\]\(#.+?\)\s*$/.test(trimmed)) return null;

  // Extract name and URL from [Name](URL)
  const nameMatch = trimmed.match(/\[(.+?)\]\(([^)]+)\)/);
  if (!nameMatch) return null;
  const name = nameMatch[1];
  const url = nameMatch[2];

  // Extract description: everything after the first `- ` (or after the link if no dash)
  let description = "";
  const dashIdx = trimmed.indexOf(" - ");
  if (dashIdx !== -1) {
    description = trimmed.slice(dashIdx + 3);
  } else {
    // Some items are just [Name](URL) `License`
    description = trimmed.slice(nameMatch[0].length).trim();
  }

  // Extract license: last backtick-enclosed value
  const licenseMatch = description.match(/`([^`]+)`\s*$/);
  const license = licenseMatch ? licenseMatch[1] : "";

  // Clean description: remove license, source code link, paid/IAP markers
  description = description
    .replace(/\s*\[?\(?Source code\)?\]?\(.*?\)\)?/gi, "")
    .replace(/\s*`[^`]*`\s*$/g, "")
    .replace(/\s*💰\s*/g, "")
    .replace(/\s*`Paid`\s*/g, "")
    .replace(/\s*`IAP`\s*/g, "")
    .replace(/\s*`Ads`\s*/g, "")
    .replace(/\s*`15-minute trial`\s*/g, "")
    .replace(/\s*`No license`\s*/g, "")
    .replace(/\s*✨\s*/g, "")
    .trim()
    .replace(/^-\s*/, "")
    .trim();

  // Extract source code link if present
  let sourceUrl = "";
  const sourceMatch = trimmed.match(/\[Source code\]\(([^)]+)\)/i);
  if (sourceMatch) sourceUrl = sourceMatch[1];

  // Determine if it's a GitHub repo
  const githubRepo = parseGithubRepoUrl(sourceUrl || url);

  // Check if it's paid/IAP
  const isPaid = /💰|Paid|IAP|Ads/i.test(trimmed);

  return {
    name,
    url,
    description,
    license,
    sourceUrl,
    githubRepo,
    category,
    isPaid,
  };
}

// Parse an awesome-shizuku markdown file and return app entries
function parseAwesomeMarkdown(markdown, sourceLabel) {
  const apps = [];
  let currentCategory = "Miscellaneous";
  const lines = markdown.split("\n");

  for (const line of lines) {
    // Track category headers (### Category)
    const catMatch = line.match(/^#{2,4}\s+(.+)/);
    if (catMatch) {
      // Clean markdown links from category names: [Text](url) -> Text
      currentCategory = catMatch[1].trim().replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
      continue;
    }

    // Parse list items
    const entry = parseAwesomeLine(line, currentCategory);
    if (entry) {
      apps.push({ ...entry, source: sourceLabel });
    }
  }

  return apps;
}

// Fetch an awesome-shizuku markdown file
async function fetchAwesomeMarkdown(filePath) {
  const url = `https://raw.githubusercontent.com/${AWESOME_OWNER}/${AWESOME_REPO}/master/${filePath}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (res.status === 200) return await res.text();
    console.warn(`  Failed to fetch ${filePath}: HTTP ${res.status}`);
    return null;
  } catch (err) {
    console.warn(`  Failed to fetch ${filePath}: ${err.message}`);
    return null;
  }
}

// Look up a GitHub repo via the API (free search or direct lookup)
async function lookupGithubRepo(fullName) {
  const url = `https://api.github.com/repos/${fullName}`;
  const res = await githubGet(url);
  if (!res || !res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv);

  const existing = loadJson(DATA_FILE, []);
  const existingList = Array.isArray(existing) ? existing : [];
  const existingByKey = new Map(existingList.map((r) => [r.full_name.toLowerCase(), r]).filter(([k]) => k));
  let ignored = loadJson(IGNORED_FILE, {});
  if (!ignored || typeof ignored !== "object" || Array.isArray(ignored)) ignored = {};

  const final = new Map();
  const nowIso = new Date().toISOString();
  const ignoreTtlMs = args.ignoreTtlDays * 24 * 60 * 60 * 1000;

  // ============================================================
  // Source 1: GitHub search
  // ============================================================
  console.log(`Source 1: GitHub search (${args.queries.length} queries)...`);
  const candidates = [];
  let rateLimited = false;
  // Run queries with a small pool — GitHub tolerates ~2-3 concurrent search
  // streams with GITHUB_TOKEN (30 req/min), and it's much faster than serial.
  const searchResults = await runPool(args.queries, 3, async (query) => {
    const { found, stopped } = await searchRepositories(query, args.maxPages, args.delay);
    return { found, stopped };
  });
  for (const { found, stopped } of searchResults) {
    candidates.push(...found);
    if (stopped) rateLimited = true;
  }

  // Re-add previously verified repos that weren't in this search
  const searchNames = new Set(candidates.map((c) => c.full_name.toLowerCase()));
  for (const repo of existingList) {
    if (!repo.full_name) continue;
    if (searchNames.has(repo.full_name.toLowerCase())) continue;
    if (repo.source && repo.source.startsWith("awesome-shizuku")) continue; // awesome entries handled separately
    candidates.push({
      full_name: repo.full_name,
      owner: repo.owner || { login: "" },
      _existing: true,
      _verified: !!repo.verified,
    });
  }

  const seen = new Set();
  const toVerify = [];
  for (const repo of candidates) {
    if (!repo.full_name) continue;
    if (seen.has(repo.full_name.toLowerCase())) continue;
    seen.add(repo.full_name.toLowerCase());
    toVerify.push(repo);
  }
  console.log(`  ${toVerify.length} unique candidates`);

  const results = await runPool(toVerify, CONCURRENCY, async (repo) => {
    const prevEntry = existingByKey.get(repo.full_name.toLowerCase());
    if (repo._verified || (prevEntry && prevEntry.verified)) {
      return { repo, verdict: "known", marker: prevEntry ? prevEntry.marker : null };
    }
    const ignoredKey = repo.full_name.toLowerCase();
    const ign = ignored[ignoredKey];
    if (ign && ign.checked_at && Date.now() - new Date(ign.checked_at).getTime() < ignoreTtlMs) {
      return { repo, verdict: "ignored" };
    }
    const hasTopic = repo.topics && hasShizukuTopic(repo);
    if (hasTopic) return { repo, verdict: "verified", marker: "topic" };
    const probe = await verifyShizukuUsage(repo.full_name);
    if (probe.verified) return { repo, verdict: "verified", marker: probe.marker };
    if (process.env.GITHUB_TOKEN) {
      const tree = await treeCheck(repo);
      if (tree.verified) {
        const r = await rawFetch(repo.full_name, tree.marker);
        if (r.ok) {
          const content = r.body.toLowerCase();
          if (SHIZUKU_MARKERS.some((m) => content.includes(m))) {
            return { repo, verdict: "verified", marker: tree.marker };
          }
        }
      }
    }
    return { repo, verdict: "rejected" };
  });

  let verified = 0;
  let rejected = 0;
  let known = 0;
  for (const { repo, verdict, marker } of results) {
    if (verdict === "ignored") continue;
    if (verdict === "rejected") {
      ignored[repo.full_name.toLowerCase()] = { checked_at: nowIso };
      rejected++;
      continue;
    }
    const prev = existingByKey.get(repo.full_name.toLowerCase());
    let entry;
    if (repo._existing) {
      // Re-added from a previous run because it wasn't in today's search —
      // keep its old last_seen so it ages out if it has genuinely vanished.
      entry = { ...prev, verified: true };
    } else {
      entry = { ...pickRepo(repo), verified: true };
    }
    if (marker) entry.marker = marker;
    entry.category = prev ? prev.category : guessCategory(repo);
    entry.source = entry.source || "search";
    entry.added_at = prev ? prev.added_at : nowIso;
    entry.last_seen = repo._existing ? (prev && prev.last_seen) || nowIso : nowIso;
    if (prev && prev.release) entry.release = prev.release;
    if (prev && prev.release_fetched_at) entry.release_fetched_at = prev.release_fetched_at;
    if (verdict === "known") known++;
    final.set(entry.full_name.toLowerCase(), entry);
    verified++;
  }
  console.log(`  Verified: ${verified} (${known} cached), Rejected: ${rejected}`);

  // ============================================================
  // Source 2: awesome-shizuku markdown lists
  // ============================================================
  if (!args.noAwesome) {
    console.log(`\nSource 2: awesome-shizuku markdown lists...`);
    let awesomeTotal = 0;
    let awesomeNew = 0;
    let awesomeSkipped = 0;

    for (const md of AWESOME_MD_PATHS) {
      const markdown = await fetchAwesomeMarkdown(md.path);
      if (!markdown) continue;
      const apps = parseAwesomeMarkdown(markdown, md.label);
      console.log(`  ${md.path}: ${apps.length} entries`);

      for (const app of apps) {
        // If it's a GitHub repo, try to get full metadata
        if (app.githubRepo) {
          const key = app.githubRepo.toLowerCase();
          if (final.has(key)) {
            // Already in the list from search — add awesome metadata
            const existing = final.get(key);
            if (!existing.awesome_source) existing.awesome_source = [];
            if (!existing.awesome_source.includes(md.label)) existing.awesome_source.push(md.label);
            if (app.category && existing.category === "Miscellaneous") {
              existing.category = app.category;
            }
            awesomeSkipped++;
            continue;
          }

          // Check ignore cache
          const ign = ignored[key];
          if (ign && ign.checked_at && Date.now() - new Date(ign.checked_at).getTime() < ignoreTtlMs) {
            awesomeSkipped++;
            continue;
          }

          // Preserve added_at and cached release info from a previous run so
          // existing apps are never re-marked as "new" and releases aren't
          // re-fetched (rate limits) every day.
          const prevAwesome = existingByKey.get(key);
          const awesomeAddedAt = prevAwesome ? prevAwesome.added_at : nowIso;
          const awesomeRelease = prevAwesome && prevAwesome.release ? prevAwesome.release : null;
          const awesomeReleaseFetchedAt =
            prevAwesome && prevAwesome.release_fetched_at ? prevAwesome.release_fetched_at : null;
          const awesomeCategory =
            prevAwesome && prevAwesome.category !== "Miscellaneous"
              ? prevAwesome.category
              : app.category || "Miscellaneous";

          // Reuse the previous entry's metadata when we already have a full
          // record for this repo — avoids ~200 GitHub API calls per run.
          const prevHasMetadata =
            prevAwesome &&
            prevAwesome.verified &&
            (prevAwesome.created_at || prevAwesome.stargazers_count > 0 ||
             (prevAwesome.topics && prevAwesome.topics.length > 0));
          let repoData = null;
          if (prevHasMetadata) {
            repoData = prevAwesome;
          } else {
            repoData = await lookupGithubRepo(app.githubRepo);
          }
          if (repoData && !repoData.message) {
            const entry = {
              ...pickRepo(repoData),
              verified: true,
              marker: "awesome-shizuku",
              category: awesomeCategory,
              source: md.label,
              awesome_source: prevAwesome && prevAwesome.awesome_source
                ? [...new Set([...prevAwesome.awesome_source, md.label])]
                : [md.label],
              description: app.description || repoData.description || "",
              added_at: awesomeAddedAt,
              last_seen: nowIso,
            };
            if (awesomeRelease) entry.release = awesomeRelease;
            if (awesomeReleaseFetchedAt) entry.release_fetched_at = awesomeReleaseFetchedAt;
            final.set(entry.full_name.toLowerCase(), entry);
            awesomeNew++;
            awesomeTotal++;
          } else {
            // Repo not found (deleted/private) — still add a basic entry
            const entry = {
              full_name: app.githubRepo,
              html_url: `https://github.com/${app.githubRepo}`,
              description: app.description,
              homepage: "",
              stargazers_count: 0,
              forks_count: 0,
              language: "",
              topics: [],
              archived: false,
              owner: { login: app.githubRepo.split("/")[0], avatar_url: "" },
              created_at: "",
              updated_at: "",
              pushed_at: "",
              verified: true,
              marker: "awesome-shizuku",
              category: awesomeCategory,
              source: md.label,
              awesome_source: prevAwesome && prevAwesome.awesome_source
                ? [...new Set([...prevAwesome.awesome_source, md.label])]
                : [md.label],
              added_at: awesomeAddedAt,
              last_seen: nowIso,
            };
            if (awesomeRelease) entry.release = awesomeRelease;
            if (awesomeReleaseFetchedAt) entry.release_fetched_at = awesomeReleaseFetchedAt;
            final.set(entry.full_name.toLowerCase(), entry);
            awesomeNew++;
            awesomeTotal++;
          }
        } else {
          // Non-GitHub app (Play Store, F-Droid, etc.)
          // Use a synthetic key based on the URL
          const key = `_store_${Buffer.from(app.url).toString("base64url").slice(0, 64)}`;
          if (final.has(key)) {
            awesomeSkipped++;
            continue;
          }
          // Preserve added_at from a previous run for store-only apps too.
          const prevStore = existingList.find((r) => r.html_url === app.url);
          const entry = {
            full_name: app.name,
            html_url: app.url,
            description: app.description,
            homepage: app.url,
            stargazers_count: 0,
            forks_count: 0,
            language: "",
            topics: [],
            archived: false,
            owner: { login: app.name, avatar_url: "" },
            created_at: "",
            updated_at: "",
            pushed_at: "",
            verified: true,
            marker: "awesome-shizuku",
            category: prevStore && prevStore.category !== "Miscellaneous"
              ? prevStore.category
              : app.category || "Miscellaneous",
            source: md.label,
            awesome_source: prevStore && prevStore.awesome_source
              ? [...new Set([...prevStore.awesome_source, md.label])]
              : [md.label],
            license: app.license,
            isPaid: app.isPaid,
            added_at: prevStore ? prevStore.added_at : nowIso,
            last_seen: nowIso,
          };
          final.set(key, entry);
          awesomeNew++;
          awesomeTotal++;
        }
      }
    }
    console.log(`  awesome-shizuku total: ${awesomeTotal} added, ${awesomeNew} new, ${awesomeSkipped} already in list`);
  }

  // ============================================================
  // Fetch release info
  // ============================================================
  // Prune search-sourced apps that haven't been seen in a long time
  // (renamed/deleted repos, or ones that dropped Shizuku support).
  // awesome-listed apps are always kept — the curated list is the source of truth.
  const staleMs = args.staleDays * 24 * 60 * 60 * 1000;
  let prunedCount = 0;
  for (const entry of [...final.values()]) {
    if (entry.source && entry.source.startsWith("awesome")) continue;
    if (!entry.last_seen) continue;
    if (Date.now() - new Date(entry.last_seen).getTime() > staleMs) {
      final.delete(entry.full_name.toLowerCase());
      prunedCount++;
    }
  }
  if (prunedCount > 0) {
    console.log(`  Pruned ${prunedCount} stale search-sourced apps (not seen in ${args.staleDays}d)`);
  }

  const sorted = [...final.values()].sort((a, b) => {
    const sa = typeof a.stargazers_count === "number" ? a.stargazers_count : -1;
    const sb = typeof b.stargazers_count === "number" ? b.stargazers_count : -1;
    if (sb !== sa) return sb - sa;
    return (a.full_name || "").localeCompare(b.full_name || "");
  });

  let releaseStopped = false;
  let releasedCount = 0;
  const releaseTtlMs = args.releaseTtlDays * 24 * 60 * 60 * 1000;
  const all = await runPool(sorted, CONCURRENCY, async (entry) => {
    if (releaseStopped) return entry;
    // Skip non-GitHub entries
    if (!entry.full_name || entry.full_name.includes("/")) {
      // valid GitHub full_name
    } else if (entry.html_url && !entry.html_url.includes("github.com")) {
      if (entry.release_fetched_at) return entry;
      return { ...entry, release: null, release_fetched_at: nowIso };
    }
    if (
      entry.release_fetched_at &&
      Date.now() - new Date(entry.release_fetched_at).getTime() < releaseTtlMs
    ) {
      if (entry.release && entry.release.tag) releasedCount++;
      return entry;
    }
    // Only fetch releases for GitHub repos
    if (!entry.full_name || !entry.full_name.includes("/")) {
      return { ...entry, release: null, release_fetched_at: nowIso };
    }
    const url = new URL(`https://api.github.com/repos/${entry.full_name}/releases`);
    url.searchParams.set("per_page", "10");
    const res = await githubGet(url);
    if (!res) return entry;
    if (!res.ok) {
      if (res.rateLimited) {
        releaseStopped = true;
        quietWarnings = true;
      }
      return entry;
    }
    let list = [];
    try { list = await res.json(); } catch { return entry; }
    const fetchedAt = new Date().toISOString();
    if (!Array.isArray(list) || list.length === 0) {
      return { ...entry, release: null, release_fetched_at: fetchedAt };
    }
    const isApkAsset = (a) => /\.(apk|apkm|xapk|apks)$/i.test((a && a.name) || "");
    const pickRelease = (releases) => {
      // Prefer the newest stable release with an installable asset; fall back
      // to a prerelease, then any release, then none.
      const withApk = releases.filter((x) => (x.assets || []).some(isApkAsset));
      return (
        withApk.find((x) => !x.prerelease) ||
        withApk.find((x) => x.prerelease) ||
        releases[0] ||
        null
      );
    };
    const r = pickRelease(list);
    if (!r) {
      return { ...entry, release: null, release_fetched_at: fetchedAt };
    }
    const apk = (r.assets || []).find(isApkAsset);
    const release = {
      tag: r.tag_name || "",
      name: r.name || "",
      published_at: r.published_at || "",
      html_url: r.html_url || "",
      apk_url: apk ? apk.browser_download_url : "",
      prerelease: !!r.prerelease,
    };
    releasedCount++;
    return { ...entry, release, release_fetched_at: fetchedAt };
  });

  // ============================================================
  // Write output
  // ============================================================
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2) + "\n");
  fs.writeFileSync(IGNORED_FILE, JSON.stringify(ignored, null, 2) + "\n");

  const newCount = [...final.keys()].filter((k) => !existingByKey.has(k)).length;
  const awesomeCount = all.filter((r) => r.source && r.source.startsWith("awesome")).length;
  const searchCount = all.filter((r) => !r.source || r.source === "search").length;
  console.log("");
  console.log(`GitHub search: ${searchCount} apps`);
  console.log(`awesome-shizuku: ${awesomeCount} apps`);
  console.log(`Release info: ${releasedCount} of ${all.length} apps`);
  console.log(`Total apps: ${all.length} (had ${existingList.length}, +${newCount} new)`);
  console.log(`Wrote ${DATA_FILE} and ${IGNORED_FILE}`);
  if (rateLimited) {
    console.warn("Note: GitHub API rate limit hit. Set GITHUB_TOKEN for higher limits.");
  }
  if (releaseStopped) {
    console.warn("Note: rate-limited while fetching release info; cached data retained.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
