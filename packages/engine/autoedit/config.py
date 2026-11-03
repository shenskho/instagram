import os

_HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.environ.get("AUTOEDIT_ASSETS", os.path.abspath(os.path.join(_HERE, "..", "assets")))
OUT_W, OUT_H, OUT_FPS = 1080, 1920, 30


def asset(*parts):
    return os.path.join(ASSETS, *parts)


SEG_MODEL = asset("models", "selfie_segmentation.tflite")
WHISPER_DIR = asset("models", "whisper-small")
