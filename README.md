# ProClubs Tracker (ProClubs 速查)

A standalone, bilingual (Traditional Cantonese / English) web app for EA Sports FC players to view live Pro Clubs stats and run AI-driven performance analysis.

**Status:** Early development, deployed on Vercel. Working (user-reported): EA proxy, Discord login, public search and club pages. Deployed 2026-11-13 per the user (the `club_cache` table was added in Neon) but not yet tried: Ask AI on live club data with a shared 15-minute cache. See [Current State](#current-state) and the progress pages.

## Product Summary
- **Live on-demand proxy:** the server fetches player and club stats from official EA sources per request. No global data is stored.
- **No per-user club storage:** club data is fetched live from EA and kept in one shared cache for about 15 minutes, the same for everyone. (An earlier 'saved clubs' idea was dropped on 2026-11-13.)
- **Ask AI:** a signed-in user searches and adds 1 to 4 clubs and asks a question. One club: its statistics and members. 2 to 4: clubs against each other, and members across clubs. The app computes every number itself; the model only explains them. Deployed 2026-11-13 per the user; not yet tried.
- **Bilingual everywhere:** the UI and the AI reports are available in Traditional Cantonese (zh-HK) and English.

## Planned Components
| Component | Purpose |
|---|---|
| Proxy API Engine | Server-side live fetch from EA FC endpoints, with short-lived caching and a basic in-memory rate limit (shared per-user limiting is planned for M3) |
| Auth & Profile | Secure login (Discord) |
| Shared club cache | A club fetched from EA is reused by all users for 15 minutes (table `club_cache`); keeps EA calls low |
| AI Analysis Pipeline | Clubs are compared in code; a compact digest plus the user's question go to the LLM, which returns a validated bilingual report and bar-chart data |
| Bilingual UI | Built 2026-11-13, awaiting redeploy: a small in-repo i18n (no package). Every page shows ONE language, Cantonese by default, with an English switch in the header (remembered in a cookie) |

## Current State
Last reviewed 2026-11-13. Milestones M0 to M2 are done (with caveats), M3 works, the public pages work (user-reported), Ask AI on live clubs is deployed (user-reported) but untried. **Open work and risks are tracked in the progress pages (`progress.en.html` / `progress.zh-HK.html`), which are the source of truth for status.**

| Area | State |
|---|---|
| EA proxy (`/api/ea/<endpoint>`) | 10 endpoints, parsed and raw output. Verified live for `memberStats` and `overallStats`; others tested on saved samples |
| Login | Discord via Auth.js; sign-in verified on Vercel (user-reported) |
| Shared club cache | Built 2026-11-13, tested on in-process Postgres and with fakes; deployed with the `club_cache` table added in Neon (user-reported); the user saw the cache serve a repeat ask without refreshing `fetchedAt` (user-reported). A member radar chart (one club) and a 'Refresh now' button on the Ask AI page (fetches the chosen clubs from EA again, limited to once a minute per club and 20 per hour, costs no AI tokens) were built 2026-11-14, awaiting redeploy. Charts now include every related member: vertical columns for season totals and line charts (colour plus marker shape, tap a name to show or hide a line) for the newest 10 league matches, built 2026-11-14, awaiting redeploy. Recent league matches (the newest 10, a fifth EA call per club) now feed match-by-match charts and the AI, built 2026-11-14, awaiting redeploy. Charts (member goals, assists and success rates for one club; win rate and goals per game for several) are drawn by the page from computed numbers with no AI tokens, built 2026-11-13, awaiting redeploy. Ask AI follow-up questions in one conversation are live and user-confirmed (2026-11-13) (the thread is kept in the browser tab only; `LLM_MAX_TURNS`, default 8; raise `LLM_USER_DAILY_LIMIT` to use full conversations). Renamed to ProClubs Tracker / ProClubs 速查; sign-in button or avatar menu (with Sign out) and the language switch are at the top right (built 2026-11-13, awaiting redeploy). Bilingual framework and first visual pass BUILT 2026-11-13 (the user confirmed the mobile layout and light/dark mode work on their phone): one language per page (Cantonese default, English switch in the header, cookie), one stylesheet with light and dark colours and a phone layout. Club names were blank on the choose page `/select`: cause was a double parse in the search loader; fixed with regression tests and confirmed displayed after redeploy (user-reported) |
| Public pages (`/`, `/select`, `/club/<id>`) | No login. Search a club by name: one match opens the club page, several open a choose page. A club page shows the record, rates and every member's statistics. EA calls are protected by per-visitor and global limits and a circuit breaker. Deployed; search is reported working (user-reported); the choose page and club page are not yet confirmed. Clubs only (no member search). |
| Ask AI (`/analysis`) | Search a club to add it (up to 4, kept in the page URL). **One club:** its own statistics and every member (season stats, pass/shot/tackle success %, career totals). **2 to 4 clubs:** compare clubs with each other, or members across clubs. Data comes through the shared 15-minute cache, else live from EA. Login required. Built and tested with mocks and real SQL; deployed (user-reported) but **never tried by the user and never run against real EA** |
| Tests | `npm test` (354 tests), `npm run typecheck`, `npm run build`. They do not cover pages, API routes or real services |
| Known gaps | The new language switch and visual design have not been seen in a browser (phone width and dark mode unchecked by eye); the Cantonese wording is unreviewed; no end-to-end tests; `npm audit` reports a high-severity `postcss` advisory in `next` (fix is a breaking upgrade) |

What is actually installed (the stack table below separates it from what is only planned):

| Layer | Choice | Status |
|---|---|---|
| App | Next.js 15 (App Router) + TypeScript, npm | in use |
| Hosting | Vercel free tier, functions pinned to Singapore by `vercel.json` (deployed; user-reported okay; the EA proxy was originally tested only from US East, so suspect the region first if EA starts blocking; fallback: small fixed-IP VPS) | in use |
| Database | Neon Postgres + Drizzle ORM | in use |
| Auth | Auth.js (next-auth v5 beta), Discord OAuth, JWT sessions | in use |
| LLM | Small adapter for OpenAI-compatible chat-completions endpoints, configured by env vars (the Vercel AI SDK from the original plan was not used) | built, unrun |
| Tests | Vitest + PGlite (in-process Postgres) | in use |
| i18n | In-repo module (`lib/i18n.ts`, `lib/ui-text.ts`; Cantonese default, English) | built, not deployed. next-intl was NOT used |
| Charts | Recharts | **planned, not installed** (the AI page draws simple bars itself) |
| End-to-end tests | Playwright | **planned, not installed** |

Key files (see `CLAUDE.md` for the full layout):

| File | Role |
|---|---|
| `progress.en.html` / `progress.zh-HK.html` | Progress tracker pages (English / Cantonese) |
| `progress-data.js` | **Single source of truth** for milestones, item statuses, risks and the activity log |
| `progress-render.js` | Shared renderer. Reads `data-lang` on `<html>` |
| `progress.css` | Shared styles (light/dark, responsive) |
| `CLAUDE.md` | Context and working rules for AI assistants |
| `app/`, `lib/`, `db/`, `auth.ts` | The Next.js app: pages (`/`, `/select`, `/club/<id>`, `/profile`, `/analysis`), API routes, EA proxy and parsers, club cache and AI logic, database schema |
| `tests/`, `scripts/`, `fixtures/`, `drizzle/` | Tests, helper scripts, real EA response samples, SQL migrations |

### Proxy usage
`GET /api/ea/<endpoint>?platform=common-gen5&...` with `<endpoint>` one of `search` (`clubName`), `clubInfo` and `overallStats` (`clubIds`), `memberStats` and `memberCareerStats` (`clubId`), `matches` (`clubIds`, `matchType=leagueMatch|playoffMatch|friendlyMatch`, optional `maxResultCount=1..10`). Three more come from community SDK docs (all verified returning 200 on 2026-11-11): `playoffAchievements` (`clubId`), `currentSeasonLeaderboard`, `searchCurrentSeason` (`clubName`). `allTimeLeaderboard` (platform only) was verified on 2026-11-11. `friendlyMatch` is accepted by EA but returned an empty array for the test club. `maxResultCount` was tried once (returned 1 match, inconclusive). It returns `{ endpoint, parsed, parseError, raw }`: `parsed` is typed data with real numbers, `raw` is EA's untouched response, and `parseError` explains why `parsed` is null if EA changes a shape. Cached for 60 seconds, stores nothing. Deployed on Vercel; all endpoints returned 200 on 2026-11-11.

### Build, deploy and health check
1. `npm install && npm run build`
2. Deploy to Vercel (`npx vercel --prod`, or import the repo).
3. Open `https://<your-deployment>/api/ea/search?platform=common-gen5&clubName=test`. Expect HTTP 200 with JSON. A 503 `upstream_blocked` means EA may be blocking us: stop and investigate, don't work around it.

### Auth and database setup (M3, not yet configured)
Code for Discord login and the database schema exists but has never run. To enable it:
1. Create a free [Neon](https://neon.tech) project and copy its connection string.
2. Create a Discord application at the Discord developer portal and add the redirect URL `<your-site>/api/auth/callback/discord`.
3. Set `DATABASE_URL`, `AUTH_SECRET` (`npx auth secret`), `AUTH_DISCORD_ID` and `AUTH_DISCORD_SECRET` (see `.env.example`) locally in `.env.local` and on Vercel.
4. Apply the schema: `DATABASE_URL=... npx drizzle-kit push` (SQL is also in `drizzle/`). Then **verify**: in the Neon SQL editor, for the same database your Vercel `DATABASE_URL` points at, run `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;` and check all eight tables are there. `drizzle-kit push` once printed "Changes applied" while a table was missing.
5. Redeploy, then open `/profile`.

### Applying the club cache table (do this before deploying the Ask AI code)
The new migration `drizzle/0003_club_cache.sql` only **adds** the `club_cache` table; it deletes and changes nothing. (An earlier plan with a duplicate-merge script was dropped; do NOT run any merge script.) (1) In your own shell run `DATABASE_URL=... npx drizzle-kit push` with the same database URL Vercel uses; if it ever asks whether to truncate a table, answer **No** and tell the assistant. (2) Verify: in the Neon SQL editor, on the same database, run `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;` and expect `club_cache` in the list. (3) Redeploy. Never paste the connection string into a chat.

### AI analysis (M5, built but never run with a real model)
`/analysis` lets a signed-in user search and add 1 to 4 clubs, type a question, and get a written report plus tables and bar charts. The app computes every number itself; the model only explains them, and its answer is validated against a strict schema and drawn by fixed components (never rendered as HTML). Club data comes from a shared cache (about 15 minutes) or live from EA; live fetches use the same per-visitor limit, global ceiling and circuit breaker as the public pages. To enable it, apply the latest migration (see above) and set the `LLM_*` and `CHAT_DAILY_CAP_USD` variables in `.env.example`; with none set, the page says the AI service is not set up. `LLM_PROVIDER=fake` gives a keyless demo with placeholder text. The adapter targets "OpenAI-compatible" chat-completions endpoints; check your provider's docs for its base URL and model name. Spending is capped in USD per day in the database; also set a limit in your provider's console.

## Keeping the records current
Every change to this project (a feature, a fix, a decision, a new risk, a new file, env var or command) must also update, in the same sitting: **`progress-data.js`** (item statuses, a dated log entry in English **and** Cantonese, the `updated` date, risks), then **`CLAUDE.md`** and **`README.md`** where they describe it. Run `npm run progress:check` to see whether any project file is newer than those three; it exits with an error if so. It compares file times only, so it is a reminder, not proof the update was good. `npm test` also checks that the progress data is well-formed and renders in both languages.

## Tests
`npm test` runs the Vitest suite (354 tests, about 7 seconds); `npm run typecheck` runs `tsc --noEmit`. The suite needs no network, credentials or database: it builds club captures from saved EA responses in `fixtures/`, mocks EA and the LLM, and runs the spending-cap and rate-limit SQL on an in-process Postgres (PGlite). It does not cover React pages, API route handlers or anything against the real Neon database, EA or an LLM, so a green run is not proof the deployed app works.

## Viewing the Progress Pages
No build step. Open `progress.en.html` or `progress.zh-HK.html` in a browser.

## Updating Progress
1. Edit `progress-data.js` only. Set an item's `status` to `done`, `progress`, `todo` or `blocked`.
2. Add a dated entry to `log` (with `en` and `zh` text) and bump `updated`.
3. Reload either page.

## Known Risks
- **This folder is not under git.** A scripted edit once emptied five files; they were restored from backups. Put the project under git before more changes.
- EA's Pro Clubs endpoints are **unofficial and undocumented**. They can change, break or rate-limit without notice.
- EA answered Vercel once, but may still block or throttle shared IPs under real traffic. If so, the proxy moves to a fixed-IP host.
- LLM cost and latency grow with the number of clubs per analysis (up to 4); uncached clubs also wait for live EA calls inside the 60-second route limit (never measured).

## Roadmap
M0 Kick-off → M1 Architecture/stack → M2 Proxy API → M3 Auth → M4 Snapshots (replaced by the shared club cache) → M5 AI Analyzer → M6 Bilingual UI → M7 QA/security/launch. Live status is in the progress pages.
