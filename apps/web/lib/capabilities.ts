"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import type { Capabilities } from "./types";

/** Worker capabilities; polled while the image generator model is still downloading. */
export function useCapabilities(): Capabilities | null {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const c = await api<Capabilities>("/api/capabilities");
        if (stop) return;
        setCaps(c);
        if (!c.imagegen.available && c.imagegen.downloading) timer = setTimeout(load, 8000);
      } catch { /* the picker works without it */ }
    };
    void load();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, []);
  return caps;
}
