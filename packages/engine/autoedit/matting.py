"""Person cut-out.
1) Segmenter: MediaPipe selfie model (fast, low-res, soft edges).
2) CleanPlate: when the camera is static, an image of the empty room is built from the video itself.
   It removes background bits the model wrongly kept (e.g. objects the same colour as clothing) and
   adds fast-moving arms/hands the model missed. Exposure changes of phone cameras are compensated.
3) Guided filter snaps the edge to the real image edges."""
import numpy as np
import cv2
from ai_edge_litert.interpreter import Interpreter
from .config import SEG_MODEL
from . import media


class Segmenter:
    def __init__(self, w, h, model_path=SEG_MODEL, threads=2):
        self.w, self.h = w, h
        self.it = Interpreter(model_path=model_path, num_threads=threads)
        self.it.allocate_tensors()
        self.i = self.it.get_input_details()[0]["index"]
        self.o = self.it.get_output_details()[0]["index"]

    def __call__(self, rgb):
        x = cv2.resize(rgb, (256, 256), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
        self.it.set_tensor(self.i, x[None]); self.it.invoke()
        m = cv2.resize(self.it.get_tensor(self.o)[0, :, :, 0], (self.w, self.h), interpolation=cv2.INTER_LINEAR)
        return np.clip((m - 0.35) / 0.4, 0, 1).astype(np.float32)


def guided_filter(I, p, r, eps):
    k = (2 * r + 1, 2 * r + 1)
    bf = lambda x: cv2.boxFilter(x, -1, k)
    mI, mp = bf(I), bf(p)
    a = (bf(I * p) - mI * mp) / (bf(I * I) - mI * mI + eps)
    b = mp - a * mI
    return bf(a) * I + bf(b)


_ELL = lambda d: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (d, d))


def _morph(mb, op, d):
    """Large dilate/erode done at 1/4 resolution (≈20x faster, same result at these sizes)."""
    if d < 31:
        return (cv2.dilate if op == "dil" else cv2.erode)(mb, _ELL(d))
    h, w = mb.shape
    small = cv2.resize(mb, (w // 4, h // 4), interpolation=cv2.INTER_AREA if op == "dil" else cv2.INTER_NEAREST)
    small = (small > 0).astype(np.uint8) if op == "dil" else small
    small = (cv2.dilate if op == "dil" else cv2.erode)(small, _ELL(max(3, d // 4 | 1)))
    return cv2.resize(small, (w, h), interpolation=cv2.INTER_NEAREST)


class CleanPlate:
    def __init__(self, plate=None, known=None):
        self.plate = plate.astype(np.float32) if plate is not None else None
        self.known = known

    # ---------------------------------------------------------------- build
    @classmethod
    def build(cls, video, seg, fps, w, h, step=3, min_count=4):
        """Two passes: average background pixels, then repeat with per-frame exposure normalisation."""
        k = _ELL(61)
        ref, refk = None, None
        for _ in range(2):
            acc = np.zeros((h, w, 3), np.float64); cnt = np.zeros((h, w), np.float64)
            for _, rgb in media.iter_frames(video, fps, w, h, step=step):
                bgm = cv2.dilate((seg(rgb) > 0.3).astype(np.uint8), k) == 0
                f = rgb.astype(np.float32)
                g = np.ones(3, np.float32)
                if ref is not None:
                    samp = bgm & refk & (ref.max(2) < 245) & (ref.max(2) > 20)
                    if samp.sum() > 5000:
                        g = np.median(f[samp] / np.maximum(ref[samp], 1), axis=0)
                        if np.median(np.abs(f[samp] - ref[samp] * g).max(1)) > 14:
                            continue  # camera moved in this frame; don't pollute the plate
                acc[bgm] += f[bgm] / g; cnt[bgm] += 1
            ref = (acc / np.maximum(cnt, 1)[..., None]).astype(np.float32)
            refk = cnt >= min_count
        return cls(np.clip(ref, 0, 255), refk)

    def save(self, path):
        np.savez_compressed(path, plate=self.plate.astype(np.uint8), known=self.known)

    @classmethod
    def load(cls, path):
        d = np.load(path)
        return cls(d["plate"], d["known"])

    # ---------------------------------------------------------------- per frame
    def refine(self, rgb, m):
        if self.plate is None:
            return guided_filter(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255, m, 4, 1e-3).clip(0, 1)
        f = rgb.astype(np.float32)
        pf, known = self.plate, self.known
        far = _morph((m > 0.3).astype(np.uint8), "dil", 121) == 0
        samp = far & known & (pf.max(2) < 245) & (pf.max(2) > 20)
        if samp.sum() <= 5000:
            return m
        fs, ps = f[samp][::7], pf[samp][::7]          # subsample: medians on ~100k pixels are plenty
        ratio = np.median(fs / np.maximum(ps, 1), axis=0)
        if np.median(np.abs(fs - ps * ratio).max(1)) > 14:
            return m  # camera moved / scene changed: plate not valid for this frame
        mb = (m > 0.5).astype(np.uint8)
        band_full = _morph(mb, "dil", 41) > 0
        ys, xs = np.where(band_full)
        if len(xs) == 0:
            return m
        H, W = m.shape
        y0, y1 = max(0, ys.min() - 12), min(H, ys.max() + 13)
        x0, x1 = max(0, xs.min() - 12), min(W, xs.max() + 13)
        # all per-pixel work happens inside the person's box only
        fc, mc, kc = f[y0:y1, x0:x1], m[y0:y1, x0:x1], known[y0:y1, x0:x1]
        pa = pf[y0:y1, x0:x1] * ratio
        fl, pal = fc.mean(2, keepdims=True) + 1, pa.mean(2, keepdims=True) + 1
        chroma = np.abs(fc / fl - pa / pal).sum(2) * 85
        lum_ratio = (fl / pal)[..., 0]
        d = np.abs(fc - pa).max(2)
        shadow = (lum_ratio > 0.45) & (lum_ratio < 0.92) & (chroma < 12)
        d = cv2.GaussianBlur(np.where(shadow, d * 0.25, d), (0, 0), 1.2)
        mbc = mb[y0:y1, x0:x1]
        band = band_full[y0:y1, x0:x1]
        core = cv2.erode(mbc, _ELL(25)) > 0
        deep = _morph(mbc, "ero", 81) > 0
        db = cv2.GaussianBlur(d, (0, 0), 3)
        r = mc.copy()
        r[(mc > 0.3) & ~core & kc & (d < 11)] = 0                      # model kept a piece of the room (edge)
        r[(mc > 0.3) & core & ~deep & kc & (db < 8)] = 0               # ...or a bigger chunk that matches the room
        add = (mc < 0.5) & band & kc & (d > 42)                         # model missed a moving arm/hand
        r = np.maximum(r, add.astype(np.float32) * np.clip((d - 42) / 20, 0, 1))
        n, lab = cv2.connectedComponents((r > 0.4).astype(np.uint8))
        if n > 1:
            keep = np.unique(lab[core & (lab > 0)])
            r = np.where(np.isin(lab, keep) | (r <= 0.4), r, 0)
        r = cv2.morphologyEx(r, cv2.MORPH_OPEN, _ELL(5))
        r = cv2.morphologyEx(r, cv2.MORPH_CLOSE, _ELL(9))
        guide = cv2.cvtColor(rgb[y0:y1, x0:x1], cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
        out = np.zeros_like(m)
        out[y0:y1, x0:x1] = np.clip(guided_filter(guide, r.astype(np.float32), 5, 1e-3), 0, 1)
        return out


def head_info(mask):
    """(head_cx, head_cy, head_width) in source pixels, from the top of the silhouette."""
    rows = np.where(mask.max(axis=1) > 0.5)[0]
    if len(rows) == 0:
        return None
    H, W = mask.shape
    top = rows[0]
    band = mask[top:top + int(H * 0.16)] > 0.5
    xs = band.sum(axis=0)
    if xs.sum() == 0:
        return None
    cx = float((xs * np.arange(W)).sum() / xs.sum())
    ws = [(mask[r] > 0.5).sum() for r in range(top + 50, min(H, top + 120), 10)]
    return cx, top + H * 0.11, float(np.median(ws)) if ws else None
