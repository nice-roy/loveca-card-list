"""Check the private static candidate using the repository's Pages packager."""
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile

root = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(root / ".github/pages-preview"), str(root / ".github/pages-release")]
import artifact
import package

candidate = root / "outputs/camera-candidate"
archive = io.BytesIO()
with tarfile.open(fileobj=archive, mode="w", format=tarfile.USTAR_FORMAT) as tar:
    for item in sorted(candidate.rglob("*")):
        if item.is_symlink():
            raise ValueError(f"Unexpected link: {item}")
        if item.is_file():
            tar.add(item, arcname=item.relative_to(candidate).as_posix(), recursive=False)

files = dict(artifact.inspect_tar(archive.getvalue()))
rules = package.headers(package.origin(), camera=True)
package.check_content([*files.items(), ("_headers", rules)])
index_name = "data/reference-index.json"
header = json.loads(files["camera-engine/" + index_name])
part_count = header.pop("partCount")
header["entries"] = []
for i in range(part_count):
    header["entries"].extend(json.loads(files[f"camera-engine/data/reference-{i}.json"]))
if header != json.loads((Path(sys.argv[1]) / index_name).read_bytes()):
    raise ValueError("Reconstructed index differs from the source.")
cards = {c["id"]: c["cardNumber"] for c in json.loads((root / "app/data/cards.json").read_bytes())}
if len(header["entries"]) != len(cards) or {e["cardId"]: e["cardNumber"] for e in header["entries"]} != cards:
    raise ValueError("Edition identity mismatch.")
normal = root / "dist"
normal_files = {p.relative_to(normal).as_posix(): p for p in normal.rglob("*") if p.is_file()}
if normal_files.keys() != files.keys():
    raise ValueError("Release build file set differs from the camera candidate.")
for name, file in normal_files.items():
    if file.read_bytes() != files[name]:
        raise ValueError(f"Release build differs from the camera candidate: {name}")
report = dict(files=len(files), total_bytes=sum(map(len, files.values())),
              largest_bytes=max(map(len, files.values())), reference_parts=part_count,
              matched_editions=len({e["cardId"] for e in header["entries"]}), catalog_editions=len(cards))
print(report)
report["asset_sha256"] = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
(candidate.parent / "camera-candidate-manifest.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
(candidate.parent / "camera-candidate-headers.txt").write_bytes(rules)
bundle = candidate.parent / "camera-candidate-pages.tar"
with tarfile.open(bundle, "w", format=tarfile.USTAR_FORMAT) as tar:
    for name, content in sorted({**files, "_headers": rules}.items()):
        member = tarfile.TarInfo(name)
        member.size = len(content)
        tar.addfile(member, io.BytesIO(content))
packed = artifact.inspect_tar(bundle.read_bytes(), trusted_headers=rules)
package.check_content(packed)
if dict(packed) != {**files, "_headers": rules}:
    raise ValueError("Final camera package differs from audited files")
