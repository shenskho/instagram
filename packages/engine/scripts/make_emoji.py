"""Cuts the emoji the engine uses out of the Noto emoji sprite (@svgmoji/noto) and renders them to 512px PNGs.
Usage: python make_emoji.py <all.svg> <out_dir>      (needs: pip install resvg-py)"""
import os, re, sys
import resvg_py

# name -> Noto code point id in the sprite
EMOJI = {
    "fire": "1F525", "laugh": "1F602", "shock": "1F631", "heart": "2764", "like": "1F44D", "hundred": "1F4AF",
    "eyes": "1F440", "party": "1F389", "idea": "1F4A1", "star": "2B50", "money": "1F4B0", "clap": "1F44F",
    # icons for the "prohibit" sign and particles
    "phone": "1F4F1", "bill": "1F4B5", "clock": "23F0", "candy": "1F36C", "leaf": "1F342", "bell": "1F514",
    "mail": "1F4E7", "pin": "1F4CD", "rocket": "1F680", "ufo": "1F6F8", "plane": "2708", "balloon": "1F388",
    "bird": "1F426", "thumbs": "1F44D", "speech": "1F4AC", "check": "2705", "cross": "274C",
}


def main(sprite, out):
    os.makedirs(out, exist_ok=True)
    data = open(sprite, encoding="utf-8").read()
    for name, cp in EMOJI.items():
        i = -1
        for pat in (cp, cp + "-FE0F"):
            i = data.find(f' id="{pat}"')
            if i >= 0: break
        if i < 0:
            print(f"missing {name} ({cp})"); continue
        start = data.rfind("<svg", 0, i)
        # walk to the matching </svg> (symbols can hold nested <svg> elements)
        depth, pos = 0, start
        for m in re.finditer(r"<svg\b|</svg>", data[start:]):
            depth += 1 if m.group(0) == "<svg" else -1
            if depth == 0:
                pos = start + m.end(); break
        svg = data[start:pos]
        svg = re.sub(r'^<svg([^>]*)>', lambda m: '<svg' + m.group(1).replace(f' id="{pat}"', "")
                     + ' xmlns:xlink="http://www.w3.org/1999/xlink">' if "xlink" not in m.group(1) else m.group(0), svg, count=1)
        png = resvg_py.svg_to_bytes(svg_string=svg, width=512, height=512)
        with open(os.path.join(out, f"{name}.png"), "wb") as f:
            f.write(bytes(png))
    print(f"emoji ready in {out}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
