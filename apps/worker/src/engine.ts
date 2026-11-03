import { spawn } from "node:child_process";
import os from "node:os";

/** Runs the Python engine (`autoedit ...`). Lines are streamed to onLine for progress. */
export const ENGINE_CMD = process.env.ENGINE_CMD ?? "autoedit";
export const RENDER_WORKERS = Number(process.env.RENDER_WORKERS ?? Math.max(1, os.cpus().length - 1));

export function runEngine(args: string[], onLine?: (line: string) => void): Promise<{ code: number; stdout: string; tail: string }> {
  return new Promise((resolve, reject) => {
    const [cmd, ...pre] = ENGINE_CMD.split(" ");
    const p = spawn(cmd, [...pre, ...args], { env: { ...process.env, PYTHONUNBUFFERED: "1" } });
    let stdout = "";
    const tail: string[] = [];
    const feed = (buf: Buffer, isErr: boolean) => {
      const text = buf.toString();
      if (!isErr) stdout += text;
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim() || line.includes("XNNPACK")) continue;
        tail.push(line); if (tail.length > 30) tail.shift();
        onLine?.(line);
      }
    };
    p.stdout.on("data", (b) => feed(b, false));
    p.stderr.on("data", (b) => feed(b, true));
    p.on("error", reject);
    p.on("close", (code) => resolve({ code: code ?? 1, stdout, tail: tail.join("\n") }));
  });
}
