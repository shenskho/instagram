"""Join several uploaded clips into one vertical source video.
Every clip is brought to the same size, frame rate and sound format first, so the editor sees one
continuous recording. Clips that are not vertical are placed over a blurred copy of themselves
instead of being cropped hard. Clips without sound get silence."""
import json, os, subprocess
from . import media


def join(clips, out, w=None, h=None, fps=30, log=print):
    if not clips:
        raise ValueError("no clips to join")
    infos = [media.probe(c) for c in clips]
    if w is None:  # don't upscale phone footage for nothing: 720p sources stay 720p (faster to render)
        w = 1080 if max(min(i["width"], i["height"]) for i in infos) >= 1000 else 720
        h = w * 16 // 9
    args, graph, pairs, bounds, t = [], [], [], [], 0.0
    for i, (path, inf) in enumerate(zip(clips, infos)):
        args += ["-i", path]
        d = inf["duration"]
        aspect = (inf["width"] / inf["height"]) / (w / h)
        tail = f"setsar=1,fps={fps},trim=0:{d:.3f},setpts=PTS-STARTPTS,format=yuv420p[v{i}]"
        if 0.85 <= aspect <= 1.15:  # close to 9:16: fill the frame
            graph.append(f"[{i}:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},{tail}")
        else:                       # landscape or square: fit it over a blurred, darker copy
            graph.append(f"[{i}:v]split=2[bg{i}][fg{i}];"
                         f"[bg{i}]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},boxblur=36:2,eq=brightness=-0.07[bb{i}];"
                         f"[fg{i}]scale={w}:{h}:force_original_aspect_ratio=decrease[ff{i}];"
                         f"[bb{i}][ff{i}]overlay=(W-w)/2:(H-h)/2,{tail}")
        if inf["has_audio"]:
            graph.append(f"[{i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=0:{d:.3f},asetpts=PTS-STARTPTS[a{i}]")
        else:
            graph.append(f"anullsrc=r=48000:cl=stereo,atrim=0:{d:.3f},asetpts=PTS-STARTPTS[a{i}]")
        pairs.append(f"[v{i}][a{i}]")
        bounds.append({"index": i, "name": os.path.basename(path), "start": round(t, 3), "end": round(t + d, 3),
                       "has_audio": inf["has_audio"], "width": inf["width"], "height": inf["height"]})
        t += d
    graph.append("".join(pairs) + f"concat=n={len(clips)}:v=1:a=1[v][a]")
    log(f"  joining {len(clips)} clips ({t:.1f}s)")
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args, "-filter_complex", ";".join(graph), "-map", "[v]", "-map", "[a]",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", out], check=True)
    # the encoded length can differ by a frame; stretch the last boundary to the real end
    bounds[-1]["end"] = round(media.probe(out)["duration"], 3)
    with open(os.path.splitext(out)[0] + "_clips.json", "w", encoding="utf-8") as f:
        json.dump(bounds, f, ensure_ascii=False, indent=1)
    return bounds


def needs_normalising(path, w=1080, h=1920):
    """A single upload is used as-is unless it is far from vertical (it would be framed badly)."""
    inf = media.probe(path)
    aspect = (inf["width"] / inf["height"]) / (w / h)
    return not (0.85 <= aspect <= 1.15)
