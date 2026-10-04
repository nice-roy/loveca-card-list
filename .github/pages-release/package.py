"""Trusted static packaging. Never executes artifact code; no credentials needed for pack.

Raw ZIP: exactly dist.tar. Final ZIP: exactly final.tar + manifest.json.
Manifest is outside the upload directory, hashes all final files including _headers.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
import tarfile
import zipfile

import artifact
from guard import gh, require, strict_json


def sha(data):
    return hashlib.sha256(data).hexdigest()


def origin(value=None):
    value = os.environ.get('VITE_SYNC_API_URL', '') if value is None else value
    # One canonical origin only. No path, port, slash, userinfo, Unicode, query,
    # fragment, quotes, whitespace, CR/LF, wildcard or CSP separators.
    require(type(value) is str and re.fullmatch(
        r'https://loveca-card-list-sync\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.workers\.dev', value),
        'Invalid/missing approved sync origin')
    return value


def csp(value):
    return ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; font-src 'self'; connect-src " + origin(value) +
            "; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; "
            "form-action 'none'; frame-ancestors 'none'")


def headers(value):
    return ('/*\n  Content-Security-Policy: ' + csp(value) +
            '\n  X-Content-Type-Options: nosniff\n').encode()


def canonical_json(data):
    return (json.dumps(data, sort_keys=True, separators=(',', ':'), ensure_ascii=True) + '\n').encode()


def metadata(artifact_id, run_id, name):
    result = gh(f'/actions/artifacts/{int(artifact_id)}')
    artifact.validate_metadata(result, int(run_id), int(artifact_id), name)
    return result


def zip_members(data, names, api_digest, expected_digest):
    digest = sha(data)
    require(api_digest == 'sha256:' + digest and expected_digest == digest,
            'ZIP digest mismatch')
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        entries = z.infolist()
        require(len(entries) == len(names) and {e.filename for e in entries} == set(names),
                'Unexpected ZIP entries')
        total = 0
        result = {}
        for e in entries:
            require(stat.S_IFMT(e.external_attr >> 16) in (0, stat.S_IFREG)
                    and not e.flag_bits & 1, 'ZIP link/special/encrypted member')
            total += e.file_size
            require(total <= artifact.MAX_ARCHIVE, 'ZIP expanded bound exceeded')
            result[e.filename] = z.read(e)
        return result


def records(files):
    return [{'path': name, 'size': len(data), 'sha256': sha(data)}
            for name, data in sorted(files)]


def context():
    value = origin()
    return {'schema': 1, 'candidate_sha': os.environ['CANDIDATE_SHA'],
            'candidate_run': int(os.environ['CANDIDATE_RUN']), 'candidate_attempt': 1,
            'quality_run': int(os.environ['QUALITY_RUN']),
            'quality_attempt': int(os.environ['QUALITY_ATTEMPT']),
            'origin_sha256': sha(value.encode()),
            'node': '22.22.2', 'npm': '10.9.7', 'wrangler': '4.92.0',
            'playwright': '1.63.0'}


def check_content(files):
    value = origin()
    require(dict(files).get('_headers') == headers(value), 'Trusted header mismatch')
    require(any(value.encode() in data for name, data in files
                if name.endswith(('.js', '.mjs'))), 'Approved endpoint absent from JS bundle')


def pack():
    value = origin()
    m = metadata(os.environ['RAW_ARTIFACT_ID'], os.environ['CANDIDATE_RUN'],
                 f"pages-raw-{os.environ['CANDIDATE_RUN']}-1")
    payload = artifact.verify_zip(artifact.download_zip(m['id']), m['digest'],
                                  os.environ['RAW_ARTIFACT_DIGEST'])
    files = artifact.inspect_tar(payload)  # Reject any source-provided _headers.
    files.append(('_headers', headers(value)))
    check_content(files)
    root = Path(os.environ['RUNNER_TEMP']) / 'release-package'
    root.mkdir()
    manifest = canonical_json({**context(), 'files': records(files)})
    (root / 'manifest.json').write_bytes(manifest)
    with tarfile.open(root / 'final.tar', 'w', format=tarfile.USTAR_FORMAT) as archive:
        for name, data in sorted(files):
            info = tarfile.TarInfo(name)
            info.size, info.mode, info.uid, info.gid, info.mtime = len(data), 0o644, 0, 0, 0
            archive.addfile(info, io.BytesIO(data))
    require((root / 'final.tar').stat().st_size <= artifact.MAX_ARCHIVE, 'Final TAR too large')
    with open(os.environ['GITHUB_OUTPUT'], 'a') as out:
        out.write('manifest=' + sha(manifest) + '\n')
    print('Production artifact packaging: PASS (endpoint not printed)')


def verify(artifact_id, run_id, digest, manifest_digest, destination=None):
    m = metadata(artifact_id, run_id, f'pages-release-{int(run_id)}-1')
    z = zip_members(artifact.download_zip(m['id']), ('final.tar', 'manifest.json'), m['digest'], digest)
    require(len(z['manifest.json']) <= 2 * 1024 * 1024, 'Manifest exceeds bound')
    require(sha(z['manifest.json']) == manifest_digest, 'Manifest hash mismatch')
    manifest = strict_json(z['manifest.json'])
    require(z['manifest.json'] == canonical_json(manifest), 'Non-canonical manifest')
    files = artifact.inspect_tar(z['final.tar'], trusted_headers=headers(origin()))
    check_content(files)
    require(manifest == {**context(), 'files': records(files)}, 'File set/context mismatch')
    if destination is not None:
        require(not destination.exists(), 'Upload directory must be fresh')
        destination.mkdir(mode=0o700)
        for name, data in files:
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o644)
    return manifest, m


def check_local(manifest):
    root = Path(os.environ['RUNNER_TEMP']) / 'pages-static'
    actual = []
    for p in sorted(root.rglob('*')):
        require(not p.is_symlink(), 'Upload directory contains symlink')
        if p.is_dir():
            continue
        require(p.is_file() and not p.stat().st_mode & 0o111, 'Unsafe upload file type/mode')
        actual.append((p.relative_to(root).as_posix(), p.read_bytes()))
    require(records(actual) == manifest['files'], 'Upload files changed after verification')
    check_content(actual)


if __name__ == '__main__':
    try:
        if sys.argv[1] == 'origin':
            origin()
            print('Approved endpoint syntax: PASS')
        elif sys.argv[1] == 'pack':
            pack()
        else:
            raise RuntimeError('Unknown packaging mode')
    except Exception:
        print('Static packaging STOP (sensitive values suppressed)', file=sys.stderr)
        sys.exit(1)
