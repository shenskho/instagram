/**
 * The optional local image generator (stable-diffusion.cpp + SD-Turbo, see packages/engine/autoedit/imagegen.py).
 * - capabilities.json in STORAGE_DIR tells the panel whether it can be used (the API reads it).
 * - The model (about 2 GB) is downloaded once into STORAGE_DIR/models, in the background, with resume.
 * - Scene places the director asked to generate are made before rendering; results are cached by text + style.
 */
import fs from "node:fs";
import path from "node:path";
import { runEngine } from "./engine.ts";
import type { EditPlan, ImagegenPayload } from "@autoreel/shared";
import { imagegenKey } from "@autoreel/shared";

export function setupImagegen(storage: string, log: (m: string) => void) {
  const MODE = (process.env.IMAGEGEN ?? "auto").toLowerCase();   // auto | off
  if (!process.env.AUTOEDIT_SD_MODEL) process.env.AUTOEDIT_SD_MODEL = path.join(storage, "models", "sd_turbo-f16-q8_0.gguf");
  const capPath = path.join(storage, "capabilities.json");
  const dir = path.join(storage, "imagegen");
  fs.mkdirSync(dir, { recursive: true });

  const write = (imagegen: Record<string, unknown>) => {
    fs.writeFileSync(capPath, JSON.stringify({ imagegen, updatedAt: new Date().toISOString() }, null, 1));
  };

  async function status(): Promise<{ available: boolean; reason: string; downloaded?: number }> {
    if (MODE === "off") return { available: false, reason: "off" };
    const r = await runEngine(["gen-status"]);
    try { return JSON.parse(r.stdout.trim().split("\n").pop() || "{}"); } catch { return { available: false, reason: "engine" }; }
  }

  let downloading = false;
  async function refresh() {
    const st = await status();
    write({ ...st, downloading });
    return st;
  }

  /** Downloads the model when the binary is there but the model is not (runs once, in the background). */
  async function ensureModel() {
    const st = await refresh();
    if (st.available || st.reason !== "no-model" || downloading) return;
    downloading = true;
    log("imagegen: downloading the model (about 2 GB, once)…");
    const total = 2_020_000_000;
    write({ ...st, downloading: true, progress: Math.round(((st.downloaded ?? 0) / total) * 100) });
    const r = await runEngine(["fetch-model", "--dest", process.env.AUTOEDIT_SD_MODEL!], (line) => {
      const m = /^download (\d+) (\d+)/.exec(line.trim());
      if (m) write({ available: false, reason: "no-model", downloading: true, progress: Math.round((Number(m[1]) / (Number(m[2]) || total)) * 100) });
    });
    downloading = false;
    if (r.code !== 0) {
      log(`imagegen: model download failed:\n${r.tail}`);
      write({ available: false, reason: "download-failed", downloading: false, error: r.tail.slice(-600) });
      return;
    }
    await refresh();
    log("imagegen: model ready");
  }

  /** Generates one image (cached). Returns the absolute PNG path. */
  async function generate(text: string, style: string): Promise<string> {
    const key = imagegenKey(text, style);
    const out = path.join(dir, `${key}.png`);
    if (fs.existsSync(out)) return out;
    const r = await runEngine(["gen", text, "--style", style, "--out", out]);
    if (r.code !== 0 || !fs.existsSync(out)) throw new Error(`image generation failed:\n${r.tail}`);
    return out;
  }

  /** Preview job from the panel: writes <key>.status.json next to the image. */
  async function preview({ key, text, style }: ImagegenPayload) {
    const statusPath = path.join(dir, `${key}.status.json`);
    const put = (s: Record<string, unknown>) => fs.writeFileSync(statusPath, JSON.stringify(s));
    put({ status: "working", text, style });
    try {
      const out = await generate(text, style);
      put({ status: "done", text, style, path: path.relative(storage, out).split(path.sep).join("/") });
    } catch (e) {
      put({ status: "failed", text, style, error: (e as Error).message.slice(-400) });
    }
  }

  /**
   * Scene places from the director → files the engine can read. Uploaded files are referenced relative to the plan;
   * generated places are made now. When the generator is not available, a drawn place stands in (with a note).
   */
  async function resolvePlaces(plan: EditPlan, planAbs: string, onStage: (s: string) => void) {
    const rel = (p: string) => path.relative(path.dirname(planAbs), p).split(path.sep).join("/");
    const gens = plan.effects.flatMap((e) => (e.type === "scene" ? (e.places as Array<Record<string, unknown>>) : [])).filter((p) => p.kind === "gen");
    let st: { available: boolean; reason: string } | null = null;
    let done = 0;
    for (const e of plan.effects) {
      if (e.type !== "scene") continue;
      const places = (e.places as Array<Record<string, unknown>>) ?? [];
      const out: Array<Record<string, unknown>> = [];
      for (const p of places) {
        if (p.kind === "upload") {
          const file = path.join(storage, String(p.file));
          if (!fs.existsSync(file)) continue;
          out.push({ kind: /\.(mp4|mov|webm|mkv|m4v)$/i.test(file) ? "video" : "image", path: rel(file) });
        } else if (p.kind === "gen") {
          st ??= await status();
          done++;
          if (st.available) {
            onStage(`ساختن تصویر محیط ${done} از ${gens.length}`);
            try { out.push({ kind: "image", path: rel(await generate(String(p.text), String(p.style))) }); continue; }
            catch (err) { (plan._notes ??= []).push(`ساختن «${p.text}» نشد؛ یک محیط آماده جاش گذاشتم.`); log(String(err)); }
          } else {
            (plan._notes ??= []).push(`مدل تصویرساز هنوز آماده نیست؛ به‌جای «${p.text}» یک محیط آماده گذاشتم.`);
          }
          out.push({ kind: "drawn", id: guessDrawn(String(p.text)) });
        } else out.push(p);
      }
      e.places = out.length ? out : [{ kind: "drawn", id: "jungle" }];
    }
  }

  return { refresh, ensureModel, preview, resolvePlaces, MODE };
}

/** Closest built-in place for a written place name. */
function guessDrawn(text: string): string {
  const t = text.replace(/‌/g, " ");
  const pairs: Array<[RegExp, string]> = [
    [/جنگل|forest|jungle|درخت/i, "jungle"], [/ساحل|دریا|beach|sea|ocean|جزیره/i, "beach"], [/فضا|مریخ|سیاره|کهکشان|space|mars|galaxy/i, "space"],
    [/شهر|خیابان|city|street|برج/i, "city_night"], [/کویر|بیابان|صحرا|desert/i, "desert"], [/برف|کوه|snow|mountain|یخ/i, "snow"],
    [/زیر آب|زیر دریا|under|reef|مرجان/i, "underwater"], [/غروب|sunset|طلوع/i, "sunset"], [/آسمان|ابر|sky|cloud/i, "sky"],
  ];
  return pairs.find(([re]) => re.test(t))?.[1] ?? "sky";
}
