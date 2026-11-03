"use client";
/** Same-origin calls go through Next rewrites (/api -> API server). Uploads go straight to the API (no proxy size limit). */
export const DIRECT_API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    credentials: "include",
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth/login")) {
    window.location.href = "/login";
    throw new ApiError(401, "unauthorized");
  }
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error ?? `خطای ${res.status}`);
  return data as T;
}

/** Fields go first so the API knows title and point of view before the files stream in. */
export function uploadVideo(files: File[], title: string, pov: string, onProgress: (p: number) => void): Promise<{ id: string }> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("title", title);
    fd.append("pov", pov);
    for (const f of files) fd.append("file", f);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${DIRECT_API}/api/videos`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: { id?: string; error?: string } = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* not json */ }
      if (xhr.status >= 200 && xhr.status < 300 && body.id) resolve({ id: body.id });
      else reject(new ApiError(xhr.status, body.error ?? `آپلود انجام نشد (خطای ${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, "اتصال به سرور برقرار نشد. سرور API روشنه؟"));
    xhr.send(fd);
  });
}
