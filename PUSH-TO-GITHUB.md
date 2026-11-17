# Pushing NewLife to GitHub

Target: <https://github.com/declareola/newlifegame>

**State:** the repository here is committed and ready. `git remote` is set,
the history is a clean fast-forward on top of the repo's existing `main`
(`aeff41c Initial commit`), and there are **6 NewLife commits waiting to push**.

**What is missing:** this workspace has no GitHub credentials — `git push` stops
at `could not read Username for 'https://github.com'`. Nothing else is in the
way. Pick either route below.

---

## Route A — give this session a token (fastest, I do it)

1. GitHub → Settings → Developer settings → **Personal access tokens →
   Fine-grained tokens** → *Generate new token*
2. Repository access: **Only select repositories → newlifegame**
3. Permissions: **Repository permissions → Contents: Read and write**
4. Expiration: 7 days is plenty
5. Paste the token (`github_pat_…`) in a reply here.

I will push once and **not** store it in the repo, in `.git/config`, or in any
file. Revoke it afterwards and it is harmless.

If you would rather not paste a token into chat, use Route B.

---

## Route B — you push it (nothing shared)

`newlife-round16.bundle` in the workspace root is a **self-contained** bundle of
the full history (52 MB, includes every commit). Verified: it clones on its own.

```bash
# 1. download newlife-round16.bundle from the workspace

# 2. clone from the bundle
git clone -b main newlife-round16.bundle newlifegame
cd newlifegame

# 3. point it at GitHub and push
git remote set-url origin https://github.com/declareola/newlifegame.git
git push origin main
```

The existing `main` on GitHub is an ancestor of this history, so this is a plain
fast-forward — no force needed.

Then, in the working copy (assets are deliberately **not** in git):

```bash
bash client/fetch-assets.sh   # fetches the CC0 skies, textures, models
./run.sh                      # installs deps, builds, serves on :3000
```

---

## What is in the commit — and what deliberately is not

**Committed (298 files):** all source (`client/src`, `server/src`), the test
suites, the backup/restore scripts, `run.sh`, the status documents
(`ROUND14-STATUS.md`, `ROUND16-STATUS.md`), the screenshots, the CI workflow, the
reference material in `uploads/`, and `client/ASSET-CREDITS.md`.

**Not committed, on purpose:**

| Path | Why | How it comes back |
|------|-----|-------------------|
| `client/node_modules`, `server/node_modules` | dependencies | `./run.sh` / `npm install` |
| `client/dist` | build output | `./run.sh` (or `npx vite build`) |
| `client/public/assets` | CC0 downloads | `bash client/fetch-assets.sh` |
| `server/.env` | **secrets** (JWT_SECRET) | regenerated on first run |
| `server/data/*.db` | player database | created on first run |
| `backups/*.tar.gz` | local archives | — |

That last group matters: the database and `.env` are the two things "nothing is
to be lost" is really about, and neither belongs in a public repository. They
live in the backups (`./backup.sh`) instead.

## One fix that this round forced

`client/fetch-assets.sh` still listed the *old* day sky (`kloofendal_48d…`) —
the one whose zenith measures rgb(162,146,139), i.e. white. Committing the
Round 16 code without changing the fetch script would have meant that a clean
clone anywhere else quietly got the grey-sheet sky back: the bug would be fixed
on this machine only. The script now pulls `autumn_field_puresky` (blue zenith)
and `viale_giuseppe_garibaldi` (the lit town at night), and the reason is
written next to the line.
