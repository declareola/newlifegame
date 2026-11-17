# NewLife — where the code lives

_Last updated: 2026-10-28 (workspace restore + Round 16 re-verification)._

## What is in this folder

| File | What it is |
| --- | --- |
| `newlife-r16-source.tar.gz` | The project: `client/`, `server/`, `uploads/`, all scripts and every status document. No `node_modules`, no build output, **no secrets** (`server/.env`, `server/data/*.db` are excluded), no screenshots. ~18 MB |
| `newlife-r16-full.tar.gz` | The same, **plus** `client/screenshots/` and the CC0 assets under `client/public/assets/`. ~62 MB |
| `r16-restore-day.png` | 12:00 on the Long Bridge deck — the blue `sky_day` photograph |
| `r16-restore-night.png` | 22:00 at the same spot — dark sky, lit lamps, lit windows |
| `r16-restore-bridge.png` | The deck mid-span, looking along the span |
| `README.md`, `ROUND16-STATUS.md`, … | The project's own documentation |

## How to run it from either archive

```bash
tar xzf newlife-r16-source.tar.gz && cd client/.. # (the archive extracts the project root)
chmod +x run.sh
./run.sh                      # installs both packages, builds the client, serves :3000
bash client/fetch-assets.sh   # optional: refetches the CC0 models/textures/HDRIs
```

The game is a Node server (`server/`) that serves the built Vite client
(`client/dist`) on port 3000 — open `http://localhost:3000`. It needs a
persistent process and a writable SQLite file; it is not a static site.

## Secrets that are deliberately not published

`server/.env` (JWT secret), `server/data/*.db` (player database) and
`client/public/assets/` (CC0 assets that `fetch-assets.sh` downloads) are excluded
from every archive. The server generates a new `JWT_SECRET` on first run.

## Vercel

**The game cannot be deployed to Vercel as it stands, and nothing has been deployed.**

Two separate reasons:

1. **Topology.** `server/` is Express + Socket.IO + better-sqlite3: a long-lived process
   with a writable file on disk. Vercel runs stateless functions. Deploying the client
   alone gives you a login screen that cannot reach an API, no saved progress and no
   multiplayer — a shell, not the game.
2. **This connector.** Vercel's API here takes deployment files inline, not as workspace
   paths. The built client is ~5.5 MB (4 MB of it the three HDRIs), so it cannot be
   shipped through a tool call.

The correct piece of work is the split deployment, and it needs one thing I do not have:

* the code in GitHub (`push` needs a token — see `PUSH-TO-GITHUB.md`), then
  **Vercel → New Project → import `declareola/newlifegame` → Root Directory `client`,
  Framework `Vite`, Output `dist`** for the client, and
* the server on a host that gives it a process and a disk (Render, Railway, Fly.io, or
  any VM) with `JWT_SECRET` set, and `VITE_API_URL`/`CLIENT_ORIGIN` pointed at each other
  so the static client talks to that server.

Until then the playable build is the local one: `./run.sh`, then `http://localhost:3000`.

## Git history

The workspace restore of 2026-10-28 removed the local `.git` directory that held
Round 16's six commits, so the archives carry the **files**, not the commit
history. Re-initialise and push when credentials are available:

```bash
git init -b main
git add -A && git commit -m "NewLife — Round 16"
git remote add origin https://github.com/declareola/newlifegame.git
git push origin main      # needs a PAT: see PUSH-TO-GITHUB.md
```
