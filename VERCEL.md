# NewLife on Vercel — what is deployed, and what is not

_2026-10-28._

## Live

| | |
| --- | --- |
| GitHub | https://github.com/declareola/newlifegame (public, branch `main`) |
| Vercel project | `newlifegame` — `prj_ypvqrlbQpOH65DHfUYkX9PGbqpFn`, linked to the repo |
| Production deployment | `dpl_2nHo3pbTt9Pj6RK9pc77yQFUCasC`, state **READY**, built from commit `353a1c6` |
| URL | https://newlifegame-adc1jiwte-declareonline-gmailcoms-projects.vercel.app |
| Settings | Framework Vite · build `cd client && npm ci && npm run build` · output `client/dist` |

Every push to `main` produces a production deployment automatically (Vercel's Git
integration deployed `353a1c6` on top of `cf5acfc` without being asked).

## Two things stand between that URL and a playable game

**1. Vercel Authentication is on.** Both deployment URLs answer `302` to
`vercel.com/sso-api`, so only members of the Vercel team can open them. The
Vercel connector exposes no endpoint for deployment protection, so this one is a
dashboard toggle:

> Vercel → project **newlifegame** → **Settings → Deployment Protection →
> Vercel Authentication → Disabled → Save**

(Or add a custom domain: this project's protection is
`all_except_custom_domains`, so a domain of your own bypasses it.)

**2. The server is not hosted anywhere.** Vercel is serving the Vite client only.
`server/` is Express + Socket.IO + better-sqlite3 — a long-lived process with a
writable SQLite file. Vercel functions are stateless, so the server cannot live
there. Until it is hosted, the deployed client loads and renders, and then every
`/api` call has nothing to answer it: no login, no saves, no multiplayer.

The client is now built to be hosted separately (`src/auth/api.js`): with no
`VITE_API_ORIGIN` it behaves exactly as it always has (same-origin, `/api`); with
it set, the REST calls and the Socket.IO connection both go to that server.

## Finishing it (one host, ~10 minutes)

1. Deploy `server/` somewhere with a process **and** a disk — Render, Railway,
   Fly.io, or any VM — with a persistent volume mounted at `server/data`:
   ```
   npm ci && node src/index.js        # PORT from the platform, default 3000
   JWT_SECRET=<generated>             # or let it generate and mount server/.env
   CLIENT_ORIGIN=https://<your vercel domain>
   ```
2. In Vercel → newlifegame → **Settings → Environment Variables** add
   `VITE_API_ORIGIN = https://<your server host>` for Production, then redeploy
   (Vite inlines it at build time, so it needs a rebuild, not just a restart).
3. Turn off Vercel Authentication (point 1 above).

After that the same build the repo ships serves the full game: login, the
server-authoritative economy, property, jobs and multiplayer.

## Local, today

```bash
./run.sh          # installs, builds, serves http://localhost:3000 — the whole game
```
