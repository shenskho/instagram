"""Downloads the source package (sdist) of a PyPI project and checks its sha256.
Used by worker.Dockerfile to get stable-diffusion.cpp without depending on the pip version.
  python3 fetch_sdist.py <project> <version> <dest_dir>"""
import hashlib, json, os, sys, urllib.request

project, version, dest = sys.argv[1], sys.argv[2], sys.argv[3]
with urllib.request.urlopen(f"https://pypi.org/pypi/{project}/{version}/json", timeout=60) as r:
    info = json.load(r)
sdist = next(u for u in info["urls"] if u["packagetype"] == "sdist")
os.makedirs(dest, exist_ok=True)
out = os.path.join(dest, sdist["filename"])
h = hashlib.sha256()
with urllib.request.urlopen(sdist["url"], timeout=300) as r, open(out, "wb") as f:
    while True:
        buf = r.read(1 << 20)
        if not buf: break
        h.update(buf); f.write(buf)
if h.hexdigest() != sdist["digests"]["sha256"]:
    sys.exit(f"checksum mismatch for {sdist['filename']}")
print(out)
