"""Private deterministic mock photographs for the 1–20 card UI test."""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import random
from PIL import Image, ImageEnhance, ImageOps

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--legacy-reference", type=Path)
parser.add_argument("--follow-up", action="store_true", help="Retest non-first matches and cover groups absent from the first sample")
args = parser.parse_args()
if args.follow_up and not args.legacy_reference:
    parser.error("--follow-up requires --legacy-reference")
source = args.legacy_reference or root / "outputs/private-bp08"
if args.legacy_reference:
    out = root / "outputs/private-legacy/batch-photos"
    master = {c["id"]: c for c in json.loads((root / "app/data/cards.json").read_bytes())}
    buckets = defaultdict(list)
    known = {}
    for line in (source / "images-manifest.jsonl").read_bytes().splitlines():
        entry = json.loads(line)
        for cid in entry["masterCardIds"]:
            card = master[cid]
            assert card["cardNumber"] == entry["cardNumber"] and cid not in known
            known[cid] = dict(cardId=cid, file=entry["imageFile"], sha256=entry["sha256"])
            buckets[entry["product"], card["cardType"]].append(known[cid])
    bp08 = json.loads((root / "outputs/private-bp08/manifest.json").read_bytes())
    assert set(known) == set(master) - {c["cardId"] for c in bp08} and len(known) == 1913
    rng = random.Random(20261126)
    cards, remaining = [], []
    for key in sorted(buckets):
        group = buckets[key]
        rng.shuffle(group)
        cards.append(group.pop())
        remaining.extend(group)
    cards.extend(rng.sample(remaining, 209 - len(cards)))
    rng.shuffle(cards)
else:
    out = source / "batch-photos"
    cards = json.loads((source / "manifest.json").read_bytes())
# First arrangement offered by the SE2 trial for each count.
layouts = [(1,1),(2,1),(3,1),(2,2),(3,2),(3,2),(4,2),(4,2),(3,3),(5,2),
           (4,3),(4,3),(5,3),(7,2),(5,3),(4,4),(6,3),(6,3),(5,4),(5,4)]
photos = []
offset = 0
for n, (cols, rows) in enumerate(layouts, start=1):
    if args.legacy_reference:
        selected = cards[offset:offset+n]
        if n == 20:
            selected.append(selected[0])
    else:
        selected = [cards[((offset+i)*37) % len(cards)] for i in range(n)]
    offset += n
    if n == 20:
        selected[-1] = selected[0]  # Two physical copies must add two.
    photos.append(selected)

if args.follow_up:
    results = json.loads((out / "results.json").read_bytes())
    assert len(results) == 20 and all(case["saved"] for case in results)
    matches = [m for case in results for m in case["matches"]]
    seen_groups = {g for m in matches for g in master[m["id"]]["groupIds"]}
    missing_groups = [cid for cid in known if set(master[cid]["groupIds"]) - seen_groups]
    difficult = sorted({m["id"] for m in matches if m["rank"] != 1 or m["preset"] not in ("", m["id"])})
    similar_editions = [cid for cid in known if master[cid]["name"] == "ディストーション"]
    retests = list(dict.fromkeys(missing_groups + similar_editions + difficult))
    photos = []
    for cycle in range(3):
        ids = retests.copy() if cycle == 0 else sorted(set(difficult + similar_editions))
        rng.shuffle(ids)
        photos.extend([[known[cid] for cid in ids[i:i+6]] for i in range(0, len(ids), 6)])
    out = out.parent / "follow-up"

out.mkdir(parents=True, exist_ok=True)
cases = []
for sequence, selected in enumerate(photos, start=1):
    n = len(selected)
    cols, rows = layouts[n-1]
    w, h, margin = 300, 420, 52
    surface = Image.new("RGB", (cols*w+2*margin, rows*h+2*margin), "#69635b")
    for i, card in enumerate(selected):
        if args.legacy_reference:
            assert hashlib.sha256((source / card["file"]).read_bytes()).hexdigest() == card["sha256"]
        with Image.open(source / card["file"]) as original:
            rgba = original.convert("RGBA")
            if rgba.width > rgba.height:
                rgba = rgba.transpose(Image.Transpose.ROTATE_90)
            rgba = ImageOps.contain(rgba, (w-12, h-16), Image.Resampling.LANCZOS)
            rgba = ImageEnhance.Brightness(rgba).enhance(0.91 + (i % 5)*0.027)
            variation = sequence if args.follow_up else 0
            rgba = rgba.rotate((i+n+variation)%5-2, Image.Resampling.BICUBIC, expand=True)
            x = margin + (i%cols)*w + (w-rgba.width)//2 + i%3-1
            y = margin + (i//cols)*h + (h-rgba.height)//2
            surface.paste(rgba, (x,y), rgba)
    filename = f"batch-{sequence:02}.jpg"
    surface.save(out/filename, quality=84)
    cases.append(dict(n=n, cols=cols, rows=rows, width=surface.width, height=surface.height,
                      margin=margin, file=filename, cards=[c["cardId"] for c in selected]))
if not args.follow_up:
    assert len({card for case in cases for card in case["cards"]}) == (209 if args.legacy_reference else 141)
(out/"cases.json").write_text(json.dumps(cases, ensure_ascii=False, indent=2), encoding="utf-8")
