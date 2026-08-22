#!/usr/bin/env node
"use strict";

/**
 * Build a curated list of Android apps that use Shizuku.
 *
 * Usage:
 *   node scripts/find-repos.js [--max-pages N] [--delay MS] [--queries "q1|q2"]
 *                               [--ignore-ttl-days N] [--release-ttl-days N]
 *                               [--no-awesome]
 *
 * Two discovery sources:
 *   1. GitHub search + Shizuku dependency verification
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
const DEFAULT_DELAY_MS = 1500;
const DEFAULT_IGNORE_TTL_DAYS = 30;
const DEFAULT_RELEASE_TTL_DAYS = 7;
const CONCURRENCY = 24;

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

async function searchRepositories(query, maxPages, delay) {
  const found = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = new URL("https://api.github.com/search/repositories");
    url.searchParams.set("q", withNoForks(query));
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    url.searchParams.set("sort", "stars");
    url.searchParams.set("order", "desc");
    const res = await githubGet(url);
    if (!res) break;
    if (!res.ok) {
      if (res.rateLimited) return { found, stopped: true };
      break;
    }
    const body = await res.json();
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) break;
    found.push(...items);
    const total = body.total_count ?? 0;
    console.log(`  [${query}] page ${page}: ${items.length} repos (${total} match in total)`);
    if (found.length >= total || items.length < 100) break;
    if (delay > 0) await sleep(delay);
  }
  return { found, stopped: false };
}

async function githubGet(url) {
  try {
    const res = await fetch(url, { headers: requestHeaders(), signal: AbortSignal.timeout(20000) });
    if (!res.ok && (res.status === 403 || res.status === 429)) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      if (!quietWarnings) {
        console.warn(`  Rate limited (HTTP ${res.status}), remaining: ${remaining ?? "?"}`);
      }
      return { ok: false, rateLimited: remaining === "0" };
    }
    return res;
  } catch (err) {
    console.warn(`  Network error: ${err.message}`);
    return null;
  }
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

  const CATEGORY_KEYWORDS = {
    "Customization": ["theme", "customiz", "wallpaper", "icon", "launcher", "dark mode", "accent", "color", "material", "font", "animation"],
    "Development utilities": ["debug", "developer", "adb", "log", "terminal", "shell", "inspector", "monitor", "test"],
    "File management": ["file manager", "file explorer", "file access", "storage", "sd card", "root explorer"],
    "Automation": ["automat", "tasker", "macro", "script", "auto", "workflow"],
    "Privacy": ["privacy", "permission", "appops", "tracker", "block", "firewall", "vpn"],
    "Display management": ["display", "refresh rate", "screen", "brightness", "hz", "rotation", "resolution"],
    "Power management": ["battery", "charging", "power", "wake", "suspend", "doze"],
    "Audio": ["audio", "volume", "sound", "music", "equalizer", "dsp", "microphone"],
    "Installer & app stores": ["install", "apk", "store", "updater", "package installer", "split apk"],
    "Input methods": ["keyboard", "keymap", "input", "gesture", "touch", "button remap"],
    "Network": ["wifi", "bluetooth", "nfc", "dns", "network", "proxy", "5g", "lte"],
    "Entertainment": ["media", "video", "stream", "manga", "anime", "game", "player"],
    "Productivity": ["productiv", "note", "todo", "calendar", "timer", "focus"],
    "Communication": ["chat", "message", "call", "sms", "discord", "telegram"],
    "Quick settings": ["quick setting", "qs tile", "tile", "toggle"],
    "Software management": ["app manager", "debloat", "freeze", "uninstall", "disable", "backup"],
    "Task manager": ["task manager", "process", "kill", "memory", "ram"],
    "Games": ["game", "gaming", "controller", "emulator", "gacha"],
    "Vendor-specific": ["pixel", "samsung", "xiaomi", "oneui", "miui", "oppo", "vivo", "oneplus"],
    "Device Owner (DPM)": ["device owner", "dpm", "work profile", "managed"],
    "AI agents": ["ai", "agent", "llm", "mcp", "chatgpt", "llama"],
    "Android TV": ["android tv", "tv app", "leanback", "fire tv"],
    "Terminals": ["terminal", "termux", "console", "shell emulator"],
    "Patching": ["patch", "mod", "revanced", "patcher", "magisk"],
  };

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) return cat;
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
  for (const query of args.queries) {
    const { found, stopped } = await searchRepositories(query, args.maxPages, args.delay);
    candidates.push(...found);
    if (stopped) {
      rateLimited = true;
      break;
    }
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
      entry = { ...prev, verified: true };
    } else {
      entry = { ...pickRepo(repo), verified: true };
    }
    if (marker) entry.marker = marker;
    entry.category = prev ? prev.category : guessCategory(repo);
    entry.source = entry.source || "search";
    entry.added_at = prev ? prev.added_at : nowIso;
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

          // Look up the repo via GitHub API
          const repoData = await lookupGithubRepo(app.githubRepo);
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
    const isApkAsset = (a) => /\.apk$/i.test((a && a.name) || "");
    const r = list.find((x) => (x.assets || []).some(isApkAsset)) || list[0];
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
