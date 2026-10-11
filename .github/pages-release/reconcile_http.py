"""Exact http_verify function extracted from published ad057dc; not release.py entrypoints."""
import os, re
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import artifact, package
from guard import require

def http_verify(base, manifest):
    # Review candidate: native curl identity, no browser/script execution.
    import subprocess
    import tempfile

    require(re.fullmatch(r'https://(?:[0-9a-f]{8}\.)?loveca-card-list\.pages\.dev', base), 'Unsafe HTTP base')
    # Do not silently change an explicitly configured proxy/network route.
    require(not any(os.environ.get(k) for k in (
        'http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY')),
        'HTTP_PROXY_CONFIGURATION_STOP')
    child_env = {'PATH': '/usr/bin:/bin', 'LANG': 'C'}
    try:
        version = subprocess.run(['/usr/bin/curl', '-q', '--version'],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                 stderr=subprocess.DEVNULL, env=child_env,
                                 timeout=5, check=False)
        match = re.match(rb'curl ([0-9]+)\.([0-9]+)\.([0-9]+) ', version.stdout)
        require(version.returncode == 0 and match is not None
                and tuple(map(int, match.groups())) >= (8, 4, 0), 'HTTP_CLIENT_VERSION_STOP')
    except Exception:
        raise RuntimeError('HTTP_CLIENT_VERSION_STOP') from None

    def check_file(f):
        if f['path'] == '_headers':
            return  # _headers is configuration, not a public asset.
        # Same path construction, with the artifact's existing safe-path grammar.
        require(all(re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]*', p)
                    for p in f['path'].split('/')), 'Unsafe HTTP path')
        path = '/' if f['path'] == 'index.html' else '/' + f['path']
        with tempfile.TemporaryDirectory(prefix='pages-http-') as directory:
            body_path = Path(directory) / 'body'
            header_path = Path(directory) / 'headers'
            args = [
                '/usr/bin/curl', '-q', '--silent', '--globoff', '--path-as-is',
                '--proto', '=https', '--proto-redir', '=https',
                '--disallow-username-in-url', '--no-netrc', '--no-location',
                '--max-redirs', '0', '--retry', '0', '--request', 'GET',
                '--max-time', '30', '--max-filesize', str(artifact.MAX_FILE + 1),
                '--header', 'Accept-Encoding: identity',
                '--header', 'Cache-Control: no-cache',
                '--dump-header', str(header_path), '--output', str(body_path),
                '--write-out', '%{http_code}', '--url', base + path,
            ]
            try:
                result = subprocess.run(args, stdin=subprocess.DEVNULL,
                                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                        env=child_env, timeout=35, check=False)
            except Exception:
                raise RuntimeError('HTTP_TRANSPORT_STOP') from None
            # Includes TLS/DNS/timeout/size-limit errors. No retries or fallback client.
            require(result.returncode == 0, 'HTTP_TRANSPORT_STOP')
            require(result.stdout == b'200', 'HTTP_STATUS_STOP')
            with body_path.open('rb') as source:
                body = source.read(artifact.MAX_FILE + 1)
            require(len(body) == f['size'] and package.sha(body) == f['sha256'],
                    'Served file does not match manifest')
            if f['path'].endswith('.html'):
                with header_path.open('rb') as source:
                    raw = source.read(65537)
                require(len(raw) <= 65536 and raw.endswith(b'\r\n\r\n'), 'HTTP_HEADERS_STOP')
                blocks = raw[:-4].split(b'\r\n\r\n')
                # Only informational blocks may precede the final response.
                require(all(re.fullmatch(rb'HTTP/(?:1\.[01]|2|3) 1[0-9]{2}(?: [^\r\n]*)?',
                                         b.split(b'\r\n', 1)[0])
                            and not re.match(rb'HTTP/[^ ]+ 101(?: |$)', b)
                            for b in blocks[:-1]), 'HTTP_HEADERS_STOP')
                lines = blocks[-1].split(b'\r\n')
                require(re.fullmatch(rb'HTTP/(?:1\.[01]|2|3) 200(?: [^\r\n]*)?', lines[0]),
                        'HTTP_HEADERS_STOP')
                headers = {}
                for line in lines[1:]:
                    name, separator, value = line.partition(b':')
                    require(separator and re.fullmatch(rb'[!#$%&\x27*+.^_`|~0-9A-Za-z-]+', name)
                            and b'\r' not in value and b'\n' not in value, 'HTTP_HEADERS_STOP')
                    name = name.decode('ascii').lower()
                    if name in ('content-security-policy', 'x-content-type-options'):
                        require(name not in headers, 'HTTP_HEADERS_STOP')
                        headers[name] = value.lstrip(b' \t').decode('iso-8859-1')
                require(headers.get('content-security-policy') == package.csp(package.origin())
                        and headers.get('x-content-type-options') == 'nosniff', 'Live CSP/header mismatch')

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(check_file, manifest['files']))
