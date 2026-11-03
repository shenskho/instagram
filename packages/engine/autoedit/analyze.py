"""Video analysis: everything the director needs to write an edit plan.
Produces analysis.json + keyframes/ (one image per second for vision review)."""
import json, os, time
import numpy as np
import cv2
from . import media, stt as stt_mod
from .matting import Segmenter, head_info


def analyze(video, out_dir, stt="local", track_hz=4, keyframe_every=1.0, log=print):
    t0 = time.time()
    os.makedirs(os.path.join(out_dir, "keyframes"), exist_ok=True)
    info = media.probe(video)
    W, H = info["width"], info["height"]
    fps = 30
    audio = media.read_audio(video)
    pauses, thr = media.find_pauses(audio)
    log(f"  audio: {len(pauses)} pauses")

    # person track + keyframes in one decode pass
    seg = Segmenter(W, H)
    track, keyframes, bg_scores = [], [], []
    tstep = max(1, int(round(fps / track_hz)))
    kstep = max(1, int(round(fps * keyframe_every)))
    prev_bg, prev_rgb = None, None
    for i, rgb in media.iter_frames(video, fps, W, H):
        t = i / fps
        if i % kstep == 0:
            p = os.path.join(out_dir, "keyframes", f"t{t:06.2f}.jpg")
            cv2.imwrite(p, cv2.cvtColor(cv2.resize(rgb, (360, int(360 * H / W))), cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 85])
            keyframes.append({"t": round(t, 2), "path": os.path.relpath(p, out_dir)})
        if i % tstep == 0:
            m = seg(rgb)
            hi = head_info(m)
            ys, xs = np.where(m > 0.5)
            rec = {"t": round(t, 2), "present": bool(len(xs) > 500)}
            if len(xs) > 500:
                rec.update({"bbox": [round(xs.min() / W, 3), round(ys.min() / H, 3), round(xs.max() / W, 3), round(ys.max() / H, 3)],
                            "area": round(len(xs) / (W * H), 3)})
                if hi:
                    rec.update({"head_x": round(hi[0] / W, 3), "head_y": round(hi[1] / H, 3),
                                "head_w": round(hi[2] / W, 3) if hi[2] else None})
            track.append(rec)
            # camera stability: change of background pixels between samples (after exposure normalisation)
            bg = cv2.dilate((m > 0.3).astype(np.uint8), np.ones((41, 41), np.uint8)) == 0
            if prev_rgb is not None:
                both = bg & prev_bg
                if both.sum() > 20000:
                    a, b = rgb[both].astype(np.float32), prev_rgb[both].astype(np.float32)
                    g = np.median(a / np.maximum(b, 1), axis=0)
                    bg_scores.append(float(np.median(np.abs(a - b * g).max(1))))
            prev_bg, prev_rgb = bg, rgb
    static_score = float(np.percentile(bg_scores, 90)) if bg_scores else None
    log(f"  vision: {len(track)} track samples, {len(keyframes)} keyframes, camera score {static_score}")

    transcript = []
    if stt:
        tr = stt_mod.get(stt)
        transcript = tr.transcribe(audio)
        log(f"  speech: {len(transcript)} segments via {tr.name}")

    # distance labels help the director pick zoom / effects
    for r in track:
        hw = r.get("head_w")
        r["shot"] = None if not hw else ("close" if hw > 0.3 else "medium" if hw > 0.17 else "wide")

    A = {
        "video": os.path.abspath(video),
        "info": info,
        "transcript": {"confirmed": False, "engine": stt, "segments": transcript},
        "pauses": pauses,
        "camera": {"static": static_score is not None and static_score < 12, "score": static_score},
        "person_track": track,
        "keyframes": keyframes,
        "elapsed_s": round(time.time() - t0, 1),
    }
    with open(os.path.join(out_dir, "analysis.json"), "w", encoding="utf-8") as f:
        json.dump(A, f, ensure_ascii=False, indent=1)
    # contact sheet for a quick human / vision look
    ims = [cv2.imread(os.path.join(out_dir, k["path"])) for k in keyframes[::2]][:24]
    if ims:
        h, w = ims[0].shape[:2]
        cols = 8
        rows = [np.hstack(ims[i:i + cols] + [np.zeros_like(ims[0])] * (cols - len(ims[i:i + cols]))) for i in range(0, len(ims), cols)]
        cv2.imwrite(os.path.join(out_dir, "contact.jpg"), cv2.resize(np.vstack(rows), None, fx=0.5, fy=0.5))
    log(f"  analysis written ({A['elapsed_s']}s)")
    return A
