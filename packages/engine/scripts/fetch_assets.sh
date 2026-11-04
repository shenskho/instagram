#!/usr/bin/env bash
# Downloads models and fonts into an assets folder (default: ./assets). Needs npm (only uses the npm registry).
set -euo pipefail
DEST="${1:-$(dirname "$0")/../assets}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$DEST/fonts" "$DEST/models/whisper-small" "$DEST/emoji"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$TMP"

echo "[1/4] fonts (Vazirmatn, OFL)"
npm pack vazirmatn@33.0.3 --silent >/dev/null
mkdir f && tar -xzf vazirmatn-*.tgz -C f
cp f/package/fonts/ttf/Vazirmatn-{Black,ExtraBold,Bold,Medium}.ttf "$DEST/fonts/"

echo "[2/4] person segmentation model (MediaPipe selfie, Apache-2.0)"
npm pack @mediapipe/selfie_segmentation@0.1.1675465747 --silent >/dev/null
mkdir s && tar -xzf mediapipe-selfie_segmentation-*.tgz -C s
cp s/package/selfie_segmentation.tflite "$DEST/models/"

echo "[3/4] speech model (Whisper small, CTranslate2 int8, MIT) — only needed for --stt local"
for i in 0 1 2 3; do
  npm pack "@skillninja/shortmovie-telop-model-p$i@1.0.0" --silent >/dev/null
  mkdir "w$i" && tar -xzf "skillninja-shortmovie-telop-model-p$i-1.0.0.tgz" -C "w$i"
done
cat w0/package/model.bin.part0 w1/package/model.bin.part1 w2/package/model.bin.part2 w3/package/model.bin.part3 > "$DEST/models/whisper-small/model.bin"
cp w0/package/{config.json,tokenizer.json,vocabulary.json,preprocessor_config.json} "$DEST/models/whisper-small/"
EXPECTED="$(cut -d' ' -f1 w0/package/model.sha256)"
ACTUAL="$(sha256sum "$DEST/models/whisper-small/model.bin" | cut -d' ' -f1)"
[ "$EXPECTED" = "$ACTUAL" ] || { echo "checksum mismatch for whisper model"; exit 1; }
echo "[4/4] emoji (Noto Emoji, Apache-2.0, via @svgmoji/noto) — rendered to PNG with resvg-py"
npm pack @svgmoji/noto@3.2.0 --silent >/dev/null
mkdir e && tar -xzf svgmoji-noto-3.2.0.tgz -C e
python3 "$HERE/make_emoji.py" e/package/sprites/all.svg "$DEST/emoji"
echo "assets ready in $DEST"
