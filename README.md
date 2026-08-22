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

Apps are collected via GitHub search and verified by probing for the **Shizuku dependency** in Gradle build files:

- `dev.rikka.shizuku` in `build.gradle` / `build.gradle.kts`
- `rikka.shizuku` references in the build configuration
- Repos with the `shizuku` topic are auto-verified

Candidates that fail verification go into `data/ignored.json` so they are not re-checked on every run.

Set `GITHUB_TOKEN` for higher rate limits and full tree-scan verification.

## The site

The site features:

- **Search** across names, descriptions, owners, and topics
- **Category filter** — Customization, Development utilities, Privacy, etc.
- **Sorting** — updated, stars, name, release date, newest added
- **Cards** — avatar, owner, description, topics, stars, language, badges
- **Download** — links to the newest release with an APK asset
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
```

## Contributing

Know a Shizuku app that should be here? It will be picked up automatically by the daily search. Found a bug? Open an issue.

## License

This repository contains **data only** — repo metadata fetched from the GitHub API. All app code belongs to its respective authors; the directory is just an index.
