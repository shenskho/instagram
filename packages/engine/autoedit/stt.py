"""Speech-to-text backends. All return the same structure:
[{"start": s, "end": e, "text": "...", "words": [{"w": "...", "s": s, "e": e}, ...]}, ...]"""
import numpy as np
from .config import WHISPER_DIR


class LocalWhisper:
    """faster-whisper 'small' (int8, CPU). Free and offline, but weak for Persian: use for tests only."""
    name = "local-whisper-small"

    def __init__(self, model_dir=WHISPER_DIR, threads=2):
        from faster_whisper import WhisperModel
        self.model = WhisperModel(model_dir, device="cpu", compute_type="int8", cpu_threads=threads)

    def transcribe(self, audio16k, language="fa", prompt=None):
        segs, _ = self.model.transcribe(np.asarray(audio16k, np.float32), language=language, beam_size=5,
                                        word_timestamps=True, initial_prompt=prompt, condition_on_previous_text=False)
        out = []
        for s in segs:
            out.append({"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip(),
                        "words": [{"w": w.word.strip(), "s": round(w.start, 2), "e": round(w.end, 2)} for w in s.words]})
        return out


class ElevenLabsScribe:
    """Step 2: hosted STT with word timestamps (supports Persian). Needs an API key."""
    name = "elevenlabs-scribe"

    def __init__(self, api_key=None):
        raise NotImplementedError("ElevenLabs Scribe is wired up in step 2 of the roadmap.")


def speech_regions(audio16k, sr=16000):
    """Where someone is speaking (Silero VAD, shipped with faster-whisper). [[t0, t1], ...] in seconds."""
    try:
        from faster_whisper.vad import get_speech_timestamps, VadOptions
    except ImportError:  # no local STT installed: assume the whole track may contain speech
        return [[0.0, round(len(audio16k) / sr, 2)]] if len(audio16k) else []
    ts = get_speech_timestamps(np.asarray(audio16k, np.float32), VadOptions(min_silence_duration_ms=300, speech_pad_ms=120))
    return [[round(x["start"] / sr, 2), round(x["end"] / sr, 2)] for x in ts]


def keep_spoken(segments, regions, min_overlap=0.3):
    """Whisper invents text over silence and music; keep segments that mostly overlap detected speech."""
    out = []
    for s in segments:
        d = max(0.01, s["end"] - s["start"])
        ov = sum(max(0.0, min(s["end"], b) - max(s["start"], a)) for a, b in regions)
        if ov / d >= min_overlap:
            out.append(s)
    return out


def get(name="local", **kw):
    return {"local": LocalWhisper, "elevenlabs": ElevenLabsScribe}[name](**kw)
