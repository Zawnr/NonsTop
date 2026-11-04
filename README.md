# NonsTop

Personal workspace for notes, tasks, ideas and projects, modelled on Notion: nested pages, databases with custom properties, and several views of the same data. Installable as a PWA on laptop and Android, works offline, self-hosted.

Status: MVP 1 in progress (sprint 0, foundation). See `docs/requirements.md` and `docs/plans/2026-11-04-nonstop-mvp-1.md`.

## Requirements

- Node.js 22 or newer, pnpm 12
- Linux or WSL2

## Quick start

```bash
pnpm install
pnpm configure      # choose a password; writes .env with the hash and VAPID keys
pnpm start      # builds the web app and serves everything at http://127.0.0.1:8787
```

Phone access over HTTPS: see `docs/tailscale.md`.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | API on :8787 and Vite dev server on :5173 with hot reload |
| `pnpm start` | Production build and server |
| `pnpm backup` | Manual backup (safe while the server runs) |
| `pnpm restore` | List backups. `pnpm restore latest` or `pnpm restore <name>` restores one; stop the server first |
| `pnpm test` | Unit tests (Vitest) for all packages |
| `pnpm e2e` | Browser tests (Playwright) on laptop and Android viewports; run `pnpm build` first |
| `pnpm lint` / `pnpm typecheck` | ESLint and TypeScript checks |

## Layout

```
apps/server     Hono API, SQLite (Drizzle), auth, push, backup
apps/web        React + Vite PWA
packages/shared Request schemas and types used by both
e2e             Playwright tests
docs            Requirements, plans, guides
data/           Live database and files (git-ignored)
backups/        Daily backups (git-ignored)
```

## Data and backups

- Everything lives in `data/nonstop.db` (SQLite) and `data/files/`.
- The server makes one backup per day at or after `BACKUP_HOUR` and keeps the newest `BACKUP_KEEP_DAYS`.
- Restore moves the current data to `data/pre-restore-<time>/` before copying the backup in, so nothing is deleted.
