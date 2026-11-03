# AutoReel — notes for coding agents

Automatic Instagram Reels editor. Persian-first UI and captions (RTL).

## Layout
- `apps/web` Next.js 16 panel (client components, Tailwind v4, RTL). Calls `/api/*` and `/files/*` through Next rewrites; uploads go straight to the API (`NEXT_PUBLIC_API_URL`).
- `apps/api` Fastify 5 + Drizzle + pg-boss. Single admin user from env. Cookie JWT. Files served from `STORAGE_DIR` with auth.
- `apps/worker` pg-boss consumer: `analyze` → (user confirms transcript in panel) → `direct` → `render`. Spawns the Python engine (`ENGINE_CMD`, default `autoedit`).
- `packages/director` Director interface. `RuleDirector` = no-API baseline; `ClaudeDirector` = step 3 (stub).
- `packages/db` Drizzle schema + SQL migrations (`npm run db:generate` after schema changes). Migrations run on api/worker start.
- `packages/shared` types (`VideoStatus`, `StyleSettings`, `EditPlan`) and `retimeSegment`.
- `packages/engine` Python `autoedit` (analyze / validate / render / qc). Plan format: `packages/engine/docs/toolbox.md`.

## Rules
- DB paths are relative to `STORAGE_DIR` (shared by api and worker).
- Plans reference `source` / `output` relative to the plan file.
- Drizzle queries are lazy: always `await` them.
- Keep UI copy in Persian, plain and active; the caption-yellow highlight (`.cap`) marks the active item only.

## Commands
- `npm run dev` (api + web), `npm run dev:worker` (needs python engine + ffmpeg; normally run in Docker)
- `npm run typecheck`
- `npx tsx packages/director/src/selftest.ts <analysis.json> <segments.json> [fix.json]`
