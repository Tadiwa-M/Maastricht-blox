"""Builds build/gallery/index.html: every screenshot, still and video of the project, newest first,
with what each one shows. Media stay where the tools wrote them (build/ is not in git); the captions
live in docs/gallery.json (in git), so the record survives even when the files are only on one machine.

    python scripts/gallery.py            # rebuild the page (new files get a stub caption to fill in)
    python scripts/gallery.py --open     # ... and open it in the browser

Caption entry (docs/gallery.json, keyed by path under build/):
    {"title": "...", "note": "...", "engine": "unity|web", "look": "classic|verse|manga", "kind": "ok|bug|test"}
"""
from __future__ import annotations

import html
import json
import sys
import webbrowser
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
CAPTIONS = ROOT / "docs" / "gallery.json"
OUT = BUILD / "gallery" / "index.html"
MEDIA = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp4", ".webm"}
VIDEO = {".mp4", ".webm"}
# Where screenshots and films land (see unity.ps1, film.mjs, shots.sh, testscene). Not film/frames (raw frames).
SOURCES = ["shots", "film", "film/stills", "film_looks", "testscene", "gallery/extra"]


def find_media() -> list[Path]:
    found: list[Path] = []
    for rel in SOURCES:
        d = BUILD / rel
        if d.is_dir():
            found += [p for p in d.iterdir() if p.is_file() and p.suffix.lower() in MEDIA]
    return found


def load_captions() -> dict[str, dict]:
    return json.loads(CAPTIONS.read_text(encoding="utf-8-sig")) if CAPTIONS.exists() else {}


def guess(rel: str) -> dict:
    name = Path(rel).stem
    return {"title": name.replace("_", " "), "note": "",
            "engine": "unity" if "unity" in name or rel.startswith("shots/u") else "web",
            "look": "verse" if "verse" in name else "manga" if "manga" in name else "classic", "kind": "test"}


def card(rel: str, cap: dict, when: datetime, size: int) -> str:
    src = "../" + rel
    e = html.escape
    media = (f'<video src="{e(src)}" controls preload="metadata"></video>' if Path(rel).suffix.lower() in VIDEO
             else f'<a href="{e(src)}" target="_blank"><img src="{e(src)}" loading="lazy" alt="{e(cap["title"])}"></a>')
    tags = " ".join(f'<span class="tag {e(cap.get(k, ""))}">{e(cap.get(k, ""))}</span>' for k in ("engine", "look", "kind"))
    note = e(cap.get("note") or "no caption yet: add one in docs/gallery.json")
    return (f'<figure data-engine="{e(cap.get("engine", ""))}" data-kind="{e(cap.get("kind", ""))}">{media}'
            f'<figcaption><b>{e(cap["title"])}</b> {tags}<p>{note}</p>'
            f'<small>{when:%Y-%m-%d %H:%M} · {size / 1e6:.1f} MB · build/{e(rel)}</small></figcaption></figure>')


PAGE = """<!doctype html><meta charset="utf-8"><title>Maastricht Blox: gallery</title>
<style>
body{{margin:0;font:14px/1.4 system-ui,sans-serif;background:#16181c;color:#e8e6e1}}
header{{padding:16px 24px;position:sticky;top:0;background:#16181cee;border-bottom:1px solid #333;z-index:1}}
h1{{margin:0 0 8px;font-size:20px}} h2{{margin:28px 24px 8px;font-size:15px;color:#aaa}}
button{{background:#2a2d33;color:#e8e6e1;border:1px solid #444;border-radius:6px;padding:4px 10px;cursor:pointer}}
button.on{{background:#c33;border-color:#c33}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:16px;padding:0 24px}}
figure{{margin:0;background:#1f2227;border-radius:8px;overflow:hidden}}
img,video{{width:100%;display:block;aspect-ratio:16/9;object-fit:cover;background:#000}}
figcaption{{padding:10px 12px}} p{{margin:6px 0}} small{{color:#888;word-break:break-all}}
.tag{{font-size:11px;padding:1px 6px;border-radius:4px;background:#333;margin-left:4px}}
.tag.bug{{background:#7a2b2b}} .tag.ok{{background:#2b6a3a}} .tag.verse{{background:#6a2b7a}}
</style>
<header><h1>Maastricht Blox: gallery</h1>
<button data-f="all" class="on">all</button> <button data-f="unity">Unity</button> <button data-f="web">web</button>
<button data-f="nobug">hide bugs</button> <span style="color:#888;margin-left:12px">{count} items · built {built}</span></header>
{body}
<script>
document.querySelectorAll('button').forEach(b=>b.onclick=()=>{{
  document.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));
  const f=b.dataset.f;
  document.querySelectorAll('figure').forEach(el=>el.style.display=
    f==='all'||el.dataset.engine===f||(f==='nobug'&&el.dataset.kind!=='bug')?'':'none');
}});
</script>"""


def main() -> None:
    captions = load_captions()
    items = []
    for p in find_media():
        rel = p.relative_to(BUILD).as_posix()
        if rel not in captions:
            captions[rel] = guess(rel)
        st = p.stat()
        items.append((datetime.fromtimestamp(st.st_mtime), rel, st.st_size))
    CAPTIONS.write_text(json.dumps(dict(sorted(captions.items())), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    items.sort(reverse=True)
    body, day = [], None
    for when, rel, size in items:
        if when.date() != day:
            if day is not None:
                body.append("</div>")
            day = when.date()
            body.append(f'<h2>{day:%A %d %B %Y}</h2><div class="grid">')
        body.append(card(rel, captions[rel], when, size))
    if day is not None:
        body.append("</div>")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(PAGE.format(count=len(items), built=f"{datetime.now():%Y-%m-%d %H:%M}", body="\n".join(body)),
                   encoding="utf-8")
    missing = [r for _, r, _ in items if not captions[r].get("note")]
    print(f"{OUT} ({len(items)} items; {len(missing)} without a caption)")
    if "--open" in sys.argv:
        webbrowser.open(OUT.as_uri())


if __name__ == "__main__":
    main()
