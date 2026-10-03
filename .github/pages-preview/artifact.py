"""Verify a same-run ZIP digest, then inspect its TAR before writing static files.

Never extractall(), execute, import or source any artifact content.
"""
import hashlib
import io
import json
import os
import re
import stat
import sys
import tarfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

from guard import REPO, gh, require

MAX_ARCHIVE = 100 * 1024 * 1024
MAX_FILE = 25 * 1024 * 1024
MAX_FILES = 10000
BANNED = {"_worker.js", "functions", "wrangler.toml", "wrangler.json",
          "wrangler.jsonc", "node_modules", "_headers", "_redirects", "_routes.json",
          "package.json", "package-lock.json"}
EXTENSIONS = {".html", ".css", ".js", ".mjs", ".json", ".svg", ".png", ".jpg",
              ".jpeg", ".gif", ".webp", ".avif", ".ico", ".txt", ".woff", ".woff2",
              ".ttf", ".otf"}
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data:; font-src 'self'; connect-src 'none'; worker-src 'none'; "
       "frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; "
       "frame-ancestors 'none'")
HEADERS = "/*\n  Content-Security-Policy: " + CSP + "\n  X-Content-Type-Options: nosniff\n"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def download_zip(artifact_id):
    url = f"https://api.github.com/repos/{REPO}/actions/artifacts/{artifact_id}/zip"
    request = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + os.environ["GH_TOKEN"],
        "Accept": "application/vnd.github+json", "User-Agent": "pages-preview-guard"})
    try:
        urllib.request.build_opener(NoRedirect).open(request, timeout=30)
        raise RuntimeError("Expected signed artifact redirect")
    except urllib.error.HTTPError as error:
        require(error.code == 302, "Artifact download endpoint rejected request")
        signed = error.headers["Location"]
    parsed = urllib.parse.urlparse(signed)
    require(parsed.scheme == "https" and bool(parsed.hostname), "Invalid artifact download URL")
    # Critical: GitHub Authorization is NOT forwarded to artifact storage.
    with urllib.request.urlopen(signed, timeout=60) as response:
        data = response.read(MAX_ARCHIVE + 1)
    require(len(data) <= MAX_ARCHIVE, "Artifact ZIP exceeds bound")
    return data


def validate_metadata(metadata, run_id, artifact_id, name):
    require(metadata["id"] == artifact_id, "Wrong artifact ID")
    require(metadata["workflow_run"]["id"] == run_id, "Artifact belongs to another run")
    require(metadata["name"] == name and metadata["expired"] is False,
            "Wrong/expired artifact")
    require(0 < metadata["size_in_bytes"] <= MAX_ARCHIVE, "Invalid artifact size")
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", metadata.get("digest", "")) is not None,
            "Artifact API digest absent or invalid")


def verify_zip(data, api_digest, upload_digest):
    actual = hashlib.sha256(data).hexdigest()
    require(api_digest == "sha256:" + actual, "Artifact API digest mismatch")
    require(upload_digest == actual, "Artifact upload digest mismatch")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = archive.infolist()
        require(len(members) == 1 and members[0].filename == "dist.tar",
                "ZIP must contain only dist.tar")
        entry = members[0]
        kind = stat.S_IFMT(entry.external_attr >> 16)
        require(kind in (0, stat.S_IFREG), "ZIP symlink/special file rejected")
        require(entry.file_size <= MAX_ARCHIVE and not entry.flag_bits & 1,
                "ZIP payload oversized/encrypted")
        return archive.read(entry)


def inspect_tar(data):
    require(len(data) <= MAX_ARCHIVE, "TAR exceeds bound")
    archive = tarfile.open(fileobj=io.BytesIO(data), mode="r:")
    files, names, total = [], set(), 0
    for entry in archive:
        require(len(names) < MAX_FILES, "Too many TAR members")
        name = entry.name.rstrip("/")
        if name == "." and entry.isdir():
            continue  # GNU tar -C dist -cf archive . root entry
        if name.startswith("./"):
            name = name[2:]
        require(name and not name.startswith("/") and "\\" not in name,
                "Absolute/ambiguous path rejected")
        parts = name.split("/")
        require(all(p and not p.startswith(".") and p.lower() not in BANNED
                    and re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]*", p) for p in parts),
                "Hidden, reserved or unsafe path rejected")
        require(name.lower() not in names, "Duplicate/case-colliding TAR member")
        names.add(name.lower())
        require(entry.isfile() or entry.isdir(), "TAR symlink/hardlink/special file rejected")
        require(not entry.pax_headers and not entry.sparse, "Extended/sparse TAR rejected")
        if entry.isdir():
            continue
        require(Path(name).suffix.lower() in EXTENSIONS, "Non-static extension rejected")
        require(not entry.mode & 0o111, "Executable file mode rejected")
        require(0 <= entry.size <= MAX_FILE, "File exceeds Pages size limit")
        total += entry.size
        require(total <= MAX_ARCHIVE, "Expanded artifact exceeds bound")
        files.append((name, archive.extractfile(entry).read()))
    require(any(name == "index.html" for name, _ in files), "index.html missing")
    # No file may also be the ancestor directory of another file.
    file_names = {n for n, _ in files}
    for name in file_names:
        require(not any(str(parent) in file_names for parent in Path(name).parents),
                "File/directory collision")
    archive.close()
    return files


def write_static(files, destination):
    require(not destination.exists(), "Destination must be fresh")
    destination.mkdir(mode=0o700)
    for name, data in files:
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as output:
            output.write(data)
        target.chmod(0o644)
    # Trusted Preview-only header. Never accept PR-supplied Pages routing/headers.
    (destination / "_headers").write_text(HEADERS)


def main():
    raw_id = os.environ["ARTIFACT_ID"]
    require(re.fullmatch(r"[1-9][0-9]*", raw_id) is not None, "Invalid artifact ID")
    artifact_id = int(raw_id)
    run_id = int(os.environ["GITHUB_RUN_ID"])
    name = f"pages-dist-{run_id}-{os.environ['GITHUB_RUN_ATTEMPT']}"
    metadata = gh(f"/actions/artifacts/{artifact_id}")
    validate_metadata(metadata, run_id, artifact_id, name)
    data = download_zip(artifact_id)
    payload = verify_zip(data, metadata["digest"], os.environ["ARTIFACT_DIGEST"])
    write_static(inspect_tar(payload), Path(os.environ["RUNNER_TEMP"]) / "pages-static")
    print("Same-run artifact digest and static file policy: PASS")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Artifact guard STOP:", str(error), file=sys.stderr)
        sys.exit(1)
