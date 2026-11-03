"""Audio: voice cut to the timeline + cleaned, music bed ducked under the voice, sound effects."""
import os, subprocess, wave
import numpy as np
from . import fx, media

DEFAULT_VOICE_CHAIN = ("highpass=f=80,afftdn=nf=-30,acompressor=threshold=-20dB:ratio=3:attack=8:release=120,"
                       "loudnorm=I=-14:TP=-1.5:LRA=9")


def _write_wav(path, x):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(fx.SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())


def _make(s):
    t = s["type"]
    if t in fx.SFX: return fx.SFX[t]()
    if t == "rise": return fx.sfx_rise(s.get("dur", 1.8))
    if t == "riser": return fx.sfx_riser(s.get("dur", 0.8))
    if t == "ticks": return fx.sfx_ticks(s.get("dur", 1.0))
    if t == "rewind": return fx.sfx_rewind(s.get("dur", 0.75))
    raise ValueError(f"unknown sfx type: {t}")


def build_sfx(plan):
    FPS = plan.FPS
    n = int(plan.duration * fx.SR) + fx.SR
    out = np.zeros(n, np.float32)

    def put(sig, t_out, gain=1.0):
        a = int(t_out * fx.SR)
        if a < 0 or a >= n: return
        b = min(n, a + len(sig)); out[a:b] += sig[:b - a] * gain

    for s in plan.E.get("sfx", []):
        if s["type"] == "birds":
            for sg in plan.segs:
                if sg["spec"].get("reverse"): continue
                a0, a1 = max(s["t0"], sg["f0"] / FPS), min(s["t1"], sg["f1"] / FPS)
                if a1 - a0 > 0.2:
                    put(fx.sfx_birds(a1 - a0) * s.get("gain", 1.0), (sg["out0"] + (a0 * FPS - sg["f0"])) / FPS)
        elif s["type"] == "thuds":
            for t in plan.thuds:
                for to in plan.occurrences(t): put(fx.sfx_thud(), to)
        elif "role" in s:
            for sg in plan.segs:
                if sg["role"] == s["role"]: put(_make(s), sg["out0"] / FPS + s["at"])
        else:
            for to in plan.occurrences(s["t"], roles=(None,)): put(_make(s), to)
    for sg in plan.segs:
        tr = sg["spec"].get("transition_in")
        if tr in ("whip", "zoom_in"): put(fx.sfx_whoosh(), sg["out0"] / FPS - 0.18, 0.9)
        if tr == "flash": put(fx.sfx_swish(), sg["out0"] / FPS - 0.05)
        if tr == "glitch": put(fx.sfx_glitch(), sg["out0"] / FPS)
    return out * 0.75


def build_audio(plan, video_path, out_path):
    E, FPS = plan.E, plan.FPS
    sfx_path, mus_path = os.path.join(plan.work, "sfx.wav"), os.path.join(plan.work, "music.wav")
    _write_wav(sfx_path, build_sfx(plan))
    mcfg = E.get("audio", {}).get("music", {"gain_db": -20})
    _write_wav(mus_path, fx.music_bed(plan.duration + 0.5, bpm=mcfg.get("bpm", 100)) * (0 if mcfg.get("off") else 1))
    src_audio = media.has_audio(plan.source)
    ai = 0 if src_audio else 4   # no sound track: cut from generated silence instead
    trims, labels = [], []
    for i, sg in enumerate(plan.segs):
        d = len(sg["frames"]) / FPS
        a = sg["f0"] / FPS
        vol = "volume=0," if (sg["spec"].get("reverse") or sg["spec"].get("voice") is False) else ""
        trims.append(f"[{ai}:a]atrim=start={a:.4f}:end={a + d:.4f},asetpts=PTS-STARTPTS,{vol}"
                     f"afade=t=in:d=0.012,afade=t=out:st={max(0, d - 0.012):.4f}:d=0.012[a{i}]")
        labels.append(f"[a{i}]")
    chain = E.get("audio", {}).get("voice_chain", DEFAULT_VOICE_CHAIN) if src_audio else "anull"
    fc = ";".join(trims) + ";" + "".join(labels) + f"concat=n={len(plan.segs)}:v=0:a=1,aresample=48000,pan=mono|c0=0.5*c0+0.5*c1," \
         + chain + ",aresample=48000,asplit=2[voice][sc];" \
         + f"[2:a]volume={mcfg.get('gain_db', -20)}dB[mus];[mus][sc]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=300[duck];" \
         + "[3:a]volume=-2dB[fx];[voice][duck][fx]amix=inputs=3:normalize=0:duration=longest," \
         + "pan=stereo|c0=c0|c1=c0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,alimiter=limit=0.89[aout]"
    silence = [] if src_audio else ["-f", "lavfi", "-t", f"{media.probe(plan.source)['duration'] + 1:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", plan.source, "-i", video_path, "-i", mus_path, "-i", sfx_path, *silence,
                    "-filter_complex", fc, "-map", "1:v", "-map", "[aout]", "-c:v", "libx264", "-preset", "veryfast",
                    "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
                    "-t", f"{plan.duration:.3f}", "-movflags", "+faststart", out_path], check=True)
