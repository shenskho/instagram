"""Command line:
  autoedit analyze VIDEO [-o DIR] [--stt local|none]
  autoedit validate PLAN [--fix]
  autoedit render PLAN [-j WORKERS] [--skip-validate]
  autoedit qc OUTPUT PLAN [-o sheet.jpg]
"""
import argparse, json, math, os, subprocess, sys


def _print_report(rep):
    for k in ("errors", "warnings", "fixes"):
        for it in rep[k]:
            print(f"  [{k[:-1]}] {it['where']}: {it['msg']}")
    print("  OK" if rep["ok"] else "  FAILED")


def cmd_analyze(a):
    from .analyze import analyze
    out = a.out or os.path.splitext(a.video)[0] + "_analysis"
    analyze(a.video, out, stt=None if a.stt == "none" else a.stt)
    print(out)


def cmd_validate(a):
    from .validate import validate
    rep, E = validate(a.plan, fix=a.fix)
    if a.fix and rep["fixes"]:
        with open(a.plan, "w", encoding="utf-8") as f:
            json.dump(E, f, ensure_ascii=False, indent=1)
    if a.json:
        print(json.dumps(rep, ensure_ascii=False, indent=1))
    else:
        _print_report(rep)
    sys.exit(0 if rep["ok"] else 1)


def cmd_render(a):
    from .render import render
    if not a.skip_validate:
        from .validate import validate
        rep, _ = validate(a.plan, check_layout=False)
        if not rep["ok"]:
            _print_report(rep); sys.exit(1)
    render(a.plan, workers=a.workers)


def cmd_qc(a):
    """Contact sheet of the rendered video at every graphic / segment start (for human or vision review)."""
    from .render import Plan
    plan = Plan(a.plan)
    times = []
    for sg in plan.segs:
        times.append(sg["out0"] / plan.FPS + 0.3)
    for g in plan.E.get("graphics", []):
        if "role" in g:
            for sg in plan.segs:
                if sg["role"] == g["role"]: times.append(sg["out0"] / plan.FPS + g["at"] + g["dur"] * 0.6)
        else:
            times += plan.occurrences(g["t0"] + (g["t1"] - g["t0"]) * 0.6, roles=(None,))
    frames = sorted(set(min(plan.total - 1, int(t * plan.FPS)) for t in times))
    sel = "+".join(f"eq(n\\,{f})" for f in frames)
    cols = 8
    rows = math.ceil(len(frames) / cols)
    out = a.out or os.path.splitext(a.output)[0] + "_qc.jpg"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", a.output, "-vf", f"select='{sel}',scale=270:480,tile={cols}x{rows}",
                    "-vsync", "vfr", "-frames:v", "1", out], check=True)
    print(out)


def main():
    p = argparse.ArgumentParser(prog="autoedit", description="Automatic short-form video editor")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("analyze"); s.add_argument("video"); s.add_argument("-o", "--out"); s.add_argument("--stt", default="local")
    s.set_defaults(fn=cmd_analyze)
    s = sub.add_parser("validate"); s.add_argument("plan"); s.add_argument("--fix", action="store_true"); s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_validate)
    s = sub.add_parser("render"); s.add_argument("plan"); s.add_argument("-j", "--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    s.add_argument("--skip-validate", action="store_true"); s.set_defaults(fn=cmd_render)
    s = sub.add_parser("qc"); s.add_argument("output"); s.add_argument("plan"); s.add_argument("-o", "--out"); s.set_defaults(fn=cmd_qc)
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
