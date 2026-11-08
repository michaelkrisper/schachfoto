# CLAUDE.md

Schachfoto: installable web app that recognises a chess position from a photo and
shows the best moves. Static PWA in `public/` (vanilla ES modules, no build step) plus
one Cloudflare Pages Function, `functions/api/recognize.js`, which asks Google Gemini
(free tier) for the position. Stockfish 19 runs in the browser. Hosted on Cloudflare
Pages (https://schachfoto.pages.dev), deployed by CI. UI German.

## Commands

Node 26 (`.nvmrc`).

```sh
npm ci
cp .dev.vars.example .dev.vars    # GEMINI_API_KEY, ACCESS_CODE for local recognition
npm run dev                       # wrangler pages dev public on http://localhost:8793
npm run check                     # Biome + node:test unit tests = CI job "check"
npm run lint:fix                  # apply Biome fixes
node scripts/browser-check.mjs [url] [shot.png]   # headless Chrome smoke test, default dev server
npm run deploy                    # manual deploy: stamps a copy in dist/, wrangler pages deploy
```

- CI (`ci.yml`): `check` on every push/PR; on `main` "Version tag", then `deploy`
  stamps `public/sw.js` and runs `wrangler pages deploy public`. Needs secret
  `CLOUDFLARE_API_TOKEN` and variable `CLOUDFLARE_ACCOUNT_ID`; without the token the
  deploy is skipped with a warning.
- The browser check is not in CI. It needs Chrome (Worker + WASM), not a lightweight
  headless browser. `VIEWPORT=375x667` simulates a small phone.
- Run `npm run dev` as a background task; `pkill -f` with a pattern that also matches
  your own shell command kills that command too.

## Architecture

- `public/js/app.js`: views (start, busy, board in edit or analysis mode), state in
  localStorage, calls `/api/recognize` with header `x-access-code`. `board.js`: SVG
  board. `photo.js`: downscales to 1568 px on the long edge before upload.
- `public/js/position.js`: board model, FEN, plausibility limits (one king per side,
  max eight pawns, extra pieces cost pawns), `orientByPawns` (fixes photos taken from
  Black's side). Shared by the browser and the function.
- `public/js/engine.js`: UCI wrapper around the Stockfish worker; one analysis at a
  time, a new `analyse()` cancels the previous one. `vendor/chess.js` for move rules.
- `functions/api/recognize.js`: access code check, Gemini call with structured output
  (eight rank strings), validation. Models in `MODELS` are tried in order; on
  429/500/503/524 the next one is used, since each has its own free quota.
- `public/_headers`: `sw.js` `no-cache`, `/vendor/*` one day.

## Service worker (`public/sw.js`)

- Two caches: `sf-shell-<hash>` (`SHELL`: app code, pieces, icon, manifest) and
  `sf-assets-<hash>` (`ASSETS`: `/vendor/`, Stockfish wasm 1.8 MB). The repo holds
  `-dev` instead of the hash; the deploy runs `scripts/stamp-sw.mjs`, which hashes
  each list's files. A cache is renamed exactly when its files change. Never bump
  anything by hand.
- Install fetches only what a cache of the same name lacks (`cache: 'reload'`), so a
  code change does not download the engine again. Shell requests are cache-then-refresh;
  vendor hits are served without refresh. Activate deletes only outdated `sf-` caches.
- A new file the app needs offline goes into `SHELL` (or `ASSETS` for vendor files);
  `tests/stamp-sw.test.js` fails if a listed file does not exist.

## Conventions

- Biome (single quotes, 110 columns) covers `public/js`, `public/sw.js`,
  `scripts/stamp-sw.mjs`, `functions/`, `tests/`, root JSON; not HTML/CSS.
- UI text and error messages German; code, comments, identifiers, commits English.
- Dev dependencies only (Biome, wrangler). Vendor files keep their licences (GPLv3
  Stockfish, BSD chess.js, CC BY-SA pieces); our code is MIT.

## Rules and pitfalls

- No API costs: recognition stays on the Gemini free tier (a version on a paid API
  was built and dropped). Measured 2026-10: 3.6 Flash ~12-15 s and correct, 3.8 Flash
  runs into >120 s timeouts, 3.5 Flash-Lite is fast but wrong. The free tier often
  answers 503; that is Google, not the code.
- Secrets `GEMINI_API_KEY` and `ACCESS_CODE` live only in Cloudflare. Never set them
  from a non-interactive shell (Claude Code `!` commands, pipes): wrangler then stores
  an empty value. Michi runs `npx wrangler pages secret put … --project-name schachfoto`
  in his own terminal; redeploy afterwards.
- Stockfish stays the lite single-threaded build: multi-threaded WASM needs
  cross-origin isolation (COOP/COEP), and the app must run on iOS without it.
- A fresh deployment takes 1-2 minutes to be reachable; test against the deployment
  URL that wrangler prints (`https://<id>.schachfoto.pages.dev`).
- Recognition has only been tested with rendered board diagrams; real phone photos
  of wooden boards are untested.

## Workflow

- Every change starts with a GitHub issue. Branch `<issue>-<slug>` from `main`,
  open a PR with `Closes #<issue>`. Never push to `main` directly.
- PRs auto-merge (squash) once CI and the "Linked ticket" check pass; drafts are not merged.
- Versions exist only as git tags `vX.Y.Z`. Every merge to `main` tags the next patch;
  never edit version numbers in files. Minor/major releases: Actions -> Release.
- Merging to `main` deploys to Cloudflare Pages automatically (CI workflow).
- Details: CONTRIBUTING.md.
