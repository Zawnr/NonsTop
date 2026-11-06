# NonsTop

Personal workspace for notes, tasks, ideas and projects, modelled on Notion: nested pages, databases with custom properties, and several views of the same data. Installable as a PWA on laptop and Android, works offline, self-hosted.

Status: `v1.0.0-rc.1`, release candidate of MVP 1. All must-have functions are built; MVP 1 is done after 14 days of daily use. See `docs/requirements.md` and `docs/plans/2026-11-04-nonstop-mvp-1.md`.

## Features

- Pages: nested pages, sidebar tree with drag, favorites, trash and restore, page and row templates, duplicate.
- Editor: block editor with slash menu, checklists, callouts, inline databases. Block menu to move and indent blocks, also by tap.
- Databases: typed properties (text, number, select, status, date, checkbox, URL, relation), table, list and board views with filters, sorts and groups.
- Work: "Proyek" template with Ticket and Epic databases, backlog and board views; turn an idea page or checklist item into a ticket.
- Capture: quick note into the Inbox from the launcher shortcut or "+ Catatan".
- Reminders: a time on a date property sends a push to every device on that day, with a countdown in the app.
- Offline: the app and data live on each device and sync when online; concurrent edits keep the other version.

## Requirements

- Node.js 22 or newer, pnpm 12
- Linux or WSL2

## Quick start

```bash
pnpm install
pnpm configure      # choose a password; writes .env with the hash and VAPID keys
pnpm start      # builds the web app and serves everything at http://127.0.0.1:8787
```

To keep it running after the terminal closes, use tmux:

```bash
scripts/serve-tmux.sh            # start in tmux session "nonstop-server"
scripts/serve-tmux.sh restart    # after pulling an update
scripts/serve-tmux.sh stop
tmux attach -t nonstop-server    # watch the log; detach with Ctrl+b, then d
```

Phone access over HTTPS: see `docs/tailscale.md`.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | API on :8787 and Vite dev server on :5173 with hot reload |
| `pnpm start` | Production build and server |
| `pnpm backup` | Manual backup (safe while the server runs) |
| `pnpm restore` | List backups. `pnpm restore latest` or `pnpm restore <name>` restores one; stop the server first |
| `pnpm restore-check` | Restore drill: backs up into a scratch folder, restores it there and compares every table and file. Safe while the server runs |
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
- Reminders use the laptop's time zone (printed at start as `[reminders] time zone …`). Set `TZ` to change it.
