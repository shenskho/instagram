"""Video/audio I/O helpers built on ffmpeg."""
import json, subprocess
import numpy as np


def probe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                          "stream=codec_type,width,height,avg_frame_rate:format=duration",
                          "-of", "json", path], capture_output=True, check=True).stdout
    d = json.loads(out)
    v = next(s for s in d["streams"] if s["codec_type"] == "video")
    num, den = (v.get("avg_frame_rate") or "30/1").split("/")
    fps = float(num) / float(den) if float(den) else 30.0
    has_audio = any(s["codec_type"] == "audio" for s in d["streams"])
    # ffmpeg applies display rotation when decoding, so read the decoded size
    w, h = decoded_size(path)
    return {"width": w, "height": h, "duration": float(d["format"]["duration"]), "fps": fps, "has_audio": has_audio}


def decoded_size(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                         capture_output=True, check=True).stdout
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                          "stream=width,height:stream_side_data=rotation", "-of", "json", path],
                         capture_output=True, check=True).stdout
    s = json.loads(out)["streams"][0]
    w, h = s["width"], s["height"]
    rot = 0
    for sd in s.get("side_data_list", []) or []:
        rot = int(sd.get("rotation", 0) or 0)
    if abs(rot) % 180 == 90:
        w, h = h, w
    assert len(raw) == w * h, "unexpected decoded frame size"
    return w, h


def iter_frames(path, fps, w, h, first=0, last=None, step=1):
    """Yield (frame_index, rgb) at a constant fps, optionally only a range / every `step` frames."""
    vf = f"fps={fps}"
    if last is not None or first:
        end = last if last is not None else 10 ** 9
        vf += f",select='between(n\\,{first}\\,{end})'"
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", path, "-vf", vf, "-vsync", "0", "-f", "rawvideo",
                          "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    size = w * h * 3
    i = first
    try:
        while True:
            buf = p.stdout.read(size)
            if len(buf) < size:
                break
            if (i - first) % step == 0:
                yield i, np.frombuffer(buf, np.uint8).reshape(h, w, 3)
            i += 1
    finally:
        p.stdout.close(); p.wait()


def read_frames(path, fps, w, h, first, last):
    return {i: f for i, f in iter_frames(path, fps, w, h, first, last)}


def has_audio(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path],
                         capture_output=True, check=True).stdout
    return bool(out.strip())


def read_audio(path, sr=16000):
    """Mono float audio. A video without a sound track reads as silence of the same length."""
    if not has_audio(path):
        d = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                                 capture_output=True, check=True).stdout.strip() or 0)
        return np.zeros(int(d * sr), np.float32)
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768


def level_envelope(audio, sr=16000, rate=100):
    """Voice level 0..1 at `rate` Hz (drives audio-reactive graphics)."""
    hop = sr // rate
    rms = np.sqrt(np.convolve(audio ** 2, np.ones(hop * 3) / (hop * 3), mode="same")[::hop] + 1e-10)
    db = 20 * np.log10(rms)
    lo, hi = np.percentile(db, 20), np.percentile(db, 98)
    return np.clip((db - lo) / max(1e-6, hi - lo), 0, 1)


def energy_db(audio, sr=16000, hop_s=0.05):
    hop = int(sr * hop_s)
    n = len(audio) // hop
    fr = audio[:n * hop].reshape(n, hop)
    return 20 * np.log10(np.sqrt((fr ** 2).mean(1)) + 1e-9)


def find_pauses(audio, sr=16000, min_len=0.25):
    """Low-energy stretches (candidate cut points). Threshold adapts to the recording."""
    db = energy_db(audio, sr)
    if not len(db) or db.max() - db.min() < 6:   # silence or a flat hum: nothing to cut
        return [], float(db.max()) if len(db) else 0.0
    speech = np.percentile(db, 60)
    floor = np.percentile(db, 8)
    thr = floor + (speech - floor) * 0.45
    quiet = db < thr
    pauses, start = [], None
    for i, q in enumerate(list(quiet) + [False]):
        if q and start is None:
            start = i
        elif not q and start is not None:
            if (i - start) * 0.05 >= min_len:
                pauses.append([round(start * 0.05, 2), round(i * 0.05, 2)])
            start = None
    return pauses, float(thr)
