# Shizuku Apps Directory

> Curated collection of apps using Shizuku — updated daily.

A curated, automatically-maintained directory of **Android apps that use Shizuku**. It is built from GitHub data every day by a GitHub Actions workflow and published to GitHub Pages.

**Live site:** <https://rushiranpise.github.io/shizuku-modules/>

## What this repo does

Two things run automatically in [GitHub Actions](https://github.com/rushiranpise/shizuku-modules/actions) (daily at 03:00 UTC, plus on every push and manual trigger):

1. **Discover & verify** — [`scripts/find-repos.js`](scripts/find-repos.js) crawls GitHub and produces the curated list in [`data/repos.json`](data/repos.json).
2. **Build & deploy** — [`scripts/build-site.js`](scripts/build-site.js) renders the static site from that data into [`site/index.html`](site/index.html), which is deployed to GitHub Pages.

Only **new** apps are added on each run — already-known repos are never duplicated, so the list grows over time instead of churning.

## How apps are discovered

Apps are collected from three sources:

1. **GitHub search** — verified by probing for the **Shizuku dependency** in Gradle build files (`dev.rikka.shizuku` in `build.gradle` / `build.gradle.kts`, `rikka.shizuku` references, the `shizuku` topic), with a git-tree scan and a `shizu_store.json` probe as fallbacks.
2. **awesome-shizuku** — the curated lists (README + CLOSED_SOURCE, ARCHIVED, RISH pages).
3. **ShizuCoreFetch store** — the ShizuCoreFetch Android store exposes its curated app list as public JSON; every entry there declares Shizuku usage, so it rescues apps our own probes miss and enriches existing entries with real package names, categories, and release URLs.

Candidates that fail verification go into `data/ignored.json` so they are not re-checked on every run. Repos that carry an opt-in **`shizu_store.json`** at their root (the ShizuCoreFetch convention) are auto-verified and enriched with `package_name`, `category`, `license`, homepage, and screenshots.

**App icons** — repos that publish via fastlane expose their real app icon at `fastlane/metadata/android/en-US/images/icon.png` (or a variant), which the crawler probes with raw fetches and stores as `icon_url`, so cards show the actual app icon instead of the GitHub owner avatar.

Set `GITHUB_TOKEN` for higher rate limits and full tree-scan verification.

## The site

The site features:

- **Search** across names, descriptions, owners, and topics
- **Category filter** — Customization, Development utilities, Privacy, etc.
- **Recency filter** — narrow to apps updated in the last 7 / 30 / 90 days
- **Sorting** — recently updated, stars, name, latest release, newest added
- **Cards** — real app icon (via fastlane metadata when available), owner, description, topics, stars, language, badges, and a relative "updated X ago" line
- **Download** — links to the newest release with an APK asset
- **Store links** — Play Store buttons from the package names declared in `shizu_store.json` / the ShizuCoreFetch store
- **Toggles** — "Only with APK" and "Favorites" (♥ saved locally in your browser)
- **Detail modal** — click any card for stars, license, release info, store/GitHub/homepage links and the live-rendered README
- **Pagination** — 60 cards at a time with "Show more" and "Load all"
- **Shareable URLs** — search/filter/sort state lives in the query string, so a filtered view can be bookmarked or shared
- **RSS feed** — `feed.xml` (Atom) with the newest apps, linked in the footer
- **Visitor counter** — live visit stats in the header
- Responsive layout for phones and desktops

## Running locally

Requires Node.js 18+.

```bash
# 1. Crawl & update the app list (needs GITHUB_TOKEN for full scans)
GITHUB_TOKEN=your_token node scripts/find-repos.js

# 2. Build the site
node scripts/build-site.js
```

`find-repos.js` accepts options:

```
node scripts/find-repos.js [--max-pages N] [--delay MS] [--queries "q1|q2"]
                            [--ignore-ttl-days N] [--release-ttl-days N]
                            [--icon-ttl-days N] [--no-awesome] [--no-store]
```

## Contributing

Know a Shizuku app that should be here? It will be picked up automatically by the daily search. Found a bug? Open an issue.

Apps that carry a **`shizu_store.json`** at their root are auto-verified and enriched with real package names, categories, licenses, and store links — and apps publishing via **fastlane** automatically get their real icon shown.

## Credits & acknowledgments

This directory wouldn't exist without the work of others:

- **[Shizuku](https://github.com/RikkaApps/Shizuku)** by RikkaApps — the app itself, and the `dev.rikka.shizuku` library every app in this list builds on.
- **[awesome-shizuku](https://github.com/timschneeb/awesome-shizuku)** by timschneeb — the curated list of Shizuku apps (including the CLOSED_SOURCE / ARCHIVED / RISH pages) that seeds part of our list.
- **[ShizuCoreFetch](https://github.com/elhizazi1/ShizuCoreFetch)** by elhizazi1 — its public store data rescues apps our own verification misses and enriches entries with real package names, categories, and release URLs. The `shizu_store.json` opt-in convention is theirs.
- **App icons** — icons shown on cards come from each app's own **fastlane** metadata (`fastlane/metadata/android/.../icon.png`); they belong to their respective developers.
- **App metadata** — fetched from the [GitHub API](https://docs.github.com/en/rest) and the awesome-shizuku / ShizuCoreFetch lists; all apps and their code belong to their respective authors.
- **Visitor counter** — the site's visit stats are provided by [freevisitorcounters.com](https://www.freevisitorcounters.com).

## License

This repository contains **data only** — repo metadata fetched from the GitHub API. All app code belongs to its respective authors; the directory is just an index.
