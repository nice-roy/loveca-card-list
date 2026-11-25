"""Download only missing BP08 editions for the private camera trial."""
import hashlib
import io
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

from PIL import Image

root = Path(__file__).resolve().parents[1]
folder = root / "outputs/private-bp08"
images = folder / "images"
images.mkdir(parents=True, exist_ok=True)
origin = "https://llofficial-cardgame.com"


def read_json(file):
    return json.loads(file.read_bytes())


def save(file, data):
    temp = file.with_suffix(file.suffix + ".part")
    temp.write_bytes(data)
    temp.replace(file)


def fetch(url, limit):
    req = Request(url, headers={"User-Agent": "LoveCa-Private-Reference-Collector/0.2"})
    with urlopen(req, timeout=45) as res:
        if res.status != 200 or res.geturl() != url:
            raise ValueError(f"Unexpected response for {url}")
        data = res.read(limit + 1)
        if len(data) > limit:
            raise ValueError(f"Response too large: {url}")
        return data


cards = read_json(root / "app/data/cards.json")
previous = read_json(Path(sys.argv[1]) / "data/reference-index.json")
old = {e["cardId"]: e["cardNumber"] for e in previous["entries"]}
missing = [c for c in cards if c["id"] not in old]
snapshot = {c["card_number"]: c for c in read_json(root / "docs/bp08/official-bp08.json")["cards"]}
if len(old) != 1913 or len(missing) != 141 or {c["cardNumber"] for c in missing} != set(snapshot):
    raise ValueError("Master or base index no longer matches this BP08 update")
records = {}
for page in (1, 2):
    file = folder / f"official-page-{page}.json"
    url = f"{origin}/manage/card-list-user/list?title=BP08&page={page}&per_page=100&sort=no"
    if not file.exists():
        save(file, fetch(url, 2 * 1024 * 1024))
    data = read_json(file)
    if data["page"] != page or data["total"] != 172 or data["per_page"] != 100:
        raise ValueError("Unexpected BP08 list")
    for row in data["items"]:
        number = row["card_number"]
        if number in records:
            raise ValueError(f"Duplicate edition: {number}")
        records[number] = row
if len(records) != 172:
    raise ValueError("Incomplete BP08 list")

manifest = []
manifest_file = folder / "manifest.json"
prior = {r["cardId"]: r for r in read_json(manifest_file)} if manifest_file.exists() else {}
names = set()
for card in missing:
    number = card["cardNumber"]
    row = records[number]
    if row["expansion"] != "BP08" or any(row[k] != snapshot[number][k] for k in ("id", "card_name", "rare", "card_kind")):
        raise ValueError(f"Official identity mismatch: {number}")
    picture = row["picture"]
    if not re.fullmatch(r"BP08/[A-Za-z0-9!_+.\-]+\.png", picture) or picture.lower() in names:
        raise ValueError(f"Unexpected or duplicate official filename: {picture}")
    names.add(picture.lower())
    image = images / Path(picture).name
    url = origin + "/wordpress/wp-content/images/cardlist/" + quote(picture, safe="/!-._")
    if image.exists():
        raw = image.read_bytes()
    else:
        raw = fetch(url, 12 * 1024 * 1024)
        time.sleep(0.5)
    checksum = hashlib.sha256(raw).hexdigest()
    saved = prior.get(card["id"])
    if saved and (saved["sha256"] != checksum or saved["source"] != url or saved["officialId"] != row["id"]):
        raise ValueError(f"Previously verified reference changed: {number}")
    with Image.open(io.BytesIO(raw)) as decoded:
        if decoded.format != "PNG" or min(decoded.size) < 100:
            raise ValueError(f"Invalid reference image: {number}")
        decoded.load()
        width, height = decoded.size
    if not image.exists():
        save(image, raw)
    manifest.append(dict(cardId=card["id"], cardNumber=number, officialId=row["id"], name=row["card_name"],
                         rarity=row["rare"], cardType=card["cardType"], source=url, file="images/" + image.name,
                         sha256=checksum, bytes=len(raw), width=width, height=height))
    if len(manifest) % 25 == 0:
        print(f"{len(manifest)}/{len(missing)}", flush=True)
save(manifest_file, (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode())
print(f"Ready: {len(manifest)} verified official images")
