# AutoReel — notes for coding agents

Automatic Instagram Reels editor. Persian-first UI and captions (RTL).

## Layout
- `apps/web` Next.js 16 panel (client components, Tailwind v4, RTL). Calls `/api/*` and `/files/*` through Next rewrites; uploads go straight to the API (`NEXT_PUBLIC_API_URL`).
- `apps/api` Fastify 5 + Drizzle + pg-boss. Single admin user from env. Cookie JWT. Files served from `STORAGE_DIR` with auth.
- `apps/worker` pg-boss consumer: `analyze` (joins clips first) → (user confirms transcript + brief in panel) → `direct` → `render`. Spawns the Python engine (`ENGINE_CMD`, default `autoedit`).
- `packages/director` Director interface. `RuleDirector` (`PlanBuilder` in `rule.ts`) = no-API baseline; `ClaudeDirector` = step 3 (stub). `previews.ts` renders the option previews in `apps/web/public/previews`.
- `packages/db` Drizzle schema + SQL migrations (`npm run db:generate` after schema changes). Migrations run on api/worker start.
- `packages/shared` types (`VideoStatus`, `StyleSettings`, `EditPlan`, `Brief`), the option catalog `EDIT_OPTIONS` in `catalog.ts` (option → params → choices, previews, `resolveTheme`), `retimeSegment`, `srcToOut`.
- `packages/engine` Python `autoedit` (analyze / validate / render / qc / gen). Plan format: `packages/engine/docs/toolbox.md`.
  Looks + skins `looks.py`, drawn places `scenes.py`, particles/flyovers `particles.py`, graphics `motion.py` + `gfx.py`, local image generator `imagegen.py`.
- Worker `imagegen.ts`: writes `STORAGE_DIR/capabilities.json`, downloads the generator model once, turns `gen`/`upload` scene places into files before validate.

## Rules
- DB paths are relative to `STORAGE_DIR` (shared by api and worker).
- Plans reference `source` / `output` relative to the plan file.
- Drizzle queries are lazy: always `await` them.
- `videos.options` is `Selection[]` (`{id, params}`); always read it through `normalizeSelections` (old rows hold plain ids).
- Every option the creator picks must appear in the plan with the details asked for; tag elements with `_opt`, `_label` (and `_auto: true` for the director's own choices) so `_usage` can show where.
- One theme per video: `resolveTheme` (shared) decides `look` / `skin`; the director's own transitions come from `SKIN_TRANSITIONS`. Don't add a graphic style that ignores the skin.
- Adding an option: add it to `EDIT_OPTIONS` (with `preview` names), a placer in `PlanBuilder`, the engine element/effect, a window in `previews.ts`, then render its previews with `--only`.
- Keep UI copy in Persian, plain and active; the caption-yellow highlight (`.cap`) marks the active item only.

## Commands
- `npm run dev` (api + web), `npm run dev:worker` (needs python engine + ffmpeg; normally run in Docker)
- `npm run typecheck`
- `npx tsx packages/director/src/selftest.ts <analysis.json> <segments.json> [--fix fix.json] [--brief brief.json] [--clips clips.json] [--out plan.json]`
- `npx tsx packages/director/src/previews.ts ... --list` (all preview names) / `--dry` (plans only)
