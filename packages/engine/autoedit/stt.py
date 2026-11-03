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


def get(name="local", **kw):
    return {"local": LocalWhisper, "elevenlabs": ElevenLabsScribe}[name](**kw)
