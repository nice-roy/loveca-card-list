"""Review candidate: release gates and receipts. CF requests are GET-only.

The workflow's single Wrangler action is the only CF writer. No automatic retries,
rollback, settings edits, data POSTs, source checkout or source execution here.
"""
import json
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import re
import sys
import time
import urllib.request

import artifact
import ledger
import package
from guard import (REPO, REPO_ID, OWNER, PROJECT, QUALITY_ID, QUALITY_PATH,
                   QUALITY_BLOB, gh, cf, require, strict_json, request_json, read_switch)

CANDIDATE_PATH = '.github/workflows/pages-candidate.yml'
PRODUCTION_PATH = '.github/workflows/pages-production.yml'
SHA = r'[0-9a-f]{40}'
DIGEST = r'[0-9a-f]{64}'
ACTIVE = ('queued', 'in_progress', 'waiting', 'pending', 'requested')
WORKFLOWS = {'Quality checks', 'Pages Preview', 'Pages Candidate', 'Pages Production'}


def inputs():
    return strict_json(Path(os.environ['GITHUB_EVENT_PATH']).read_bytes())['inputs']


def output(values):
    with open(os.environ['GITHUB_OUTPUT'], 'a') as out:
        for key, value in values.items():
            value = str(value)
            require('\n' not in value and '\r' not in value, 'Unsafe output')
            out.write(f'{key}={value}\n')


def summary(title, data):
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as out:
        out.write('\n## ' + title + '\n```json\n' + json.dumps(data, indent=2) + '\n```\n')


def number(value):
    require(re.fullmatch(r'[1-9][0-9]*', str(value)) is not None, 'Invalid positive ID')
    return int(value)


def entry(path):
    require(os.environ['GITHUB_REPOSITORY'] == REPO
            and os.environ['GITHUB_REF'] == 'refs/heads/main'
            and os.environ['GITHUB_EVENT_NAME'] == 'workflow_dispatch'
            and os.environ['GITHUB_RUN_ATTEMPT'] == '1', 'Wrong entry or rerun attempt')
    require(os.environ['GITHUB_ACTOR'] == OWNER
            and os.environ['GITHUB_TRIGGERING_ACTOR'] == OWNER, 'Wrong release actor')
    require(os.environ['GITHUB_WORKFLOW_REF'] == f'{REPO}/{path}@refs/heads/main',
            'Unexpected workflow definition')
    sha = os.environ['GITHUB_SHA']
    require(re.fullmatch(SHA, sha) and os.environ['TRUSTED_SHA'] == sha,
            'Workflow/source SHA mismatch')
    repo = gh('')
    require(repo['id'] == REPO_ID and repo['default_branch'] == 'main', 'Repository changed')
    require(gh('/branches/main')['commit']['sha'] == sha, 'main moved; new candidate required')
    require(gh(f'/contents/{QUALITY_PATH}?ref={sha}')['sha'] == QUALITY_BLOB,
            'quality.yml changed')
    return sha


def quality(run_id, attempt, sha):
    run_id, attempt = number(run_id), number(attempt)
    r = gh(f'/actions/runs/{run_id}')
    require(r['id'] == run_id and r['run_attempt'] == attempt
            and r['workflow_id'] == QUALITY_ID and r['path'] == QUALITY_PATH
            and r['name'] == 'Quality checks' and r['event'] == 'push'
            and r['head_branch'] == 'main' and r['head_sha'] == sha
            and r['status'] == 'completed' and r['conclusion'] == 'success',
            'Invalid/stale main Quality result')
    require(r['actor']['login'] == OWNER and r['triggering_actor']['login'] == OWNER,
            'Quality actor changed')
    for key in ('repository', 'head_repository'):
        require(r[key]['id'] == REPO_ID and r[key]['full_name'] == REPO
                and r[key]['fork'] is False, 'Foreign Quality repository')
    j = gh(f'/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100')
    require(len(j['jobs']) == j['total_count'], 'Incomplete Quality jobs')
    q = [v for v in j['jobs'] if v['name'] == 'quality']
    require(len(q) == 1 and q[0]['status'] == 'completed' and q[0]['conclusion'] == 'success',
            'Required quality job failed')


def candidate_gate():
    sha = entry(CANDIDATE_PATH)
    i = inputs()
    require(i['confirm'] == 'PREVIEW-ONLY' and i['candidate_sha'] == sha,
            'Candidate confirmation/SHA mismatch')
    quality(i['quality_run'], i['quality_attempt'], sha)
    package.origin()
    output({'sha': sha})


def project():
    p = cf()
    require(p['name'] == PROJECT and p['production_branch'] == 'main', 'Wrong project/branch')
    require(p['source']['type'] == 'github', 'Wrong project source')
    c = p['source']['config']
    require(c['owner'] == OWNER and c['repo_name'] == PROJECT
            and c['production_branch'] == 'main'
            and c['production_deployments_enabled'] is False
            and c['preview_deployment_setting'] == 'none', 'Git auto deploy/config changed')
    expected = ledger.expected_canonical()
    current = p['canonical_deployment']
    require(current['id'] == expected['id'] and current['environment'] == 'production'
            and current['deployment_trigger']['metadata']['commit_hash'] == expected['sha']
            and current['latest_stage']['name'] == 'deploy'
            and current['latest_stage']['status'] == 'success', 'Unapproved Production canonical')
    value = p['deployment_configs']['production']['env_vars']['VITE_SYNC_API_URL']
    require(value['type'] == 'plain_text' and value['value'] == package.origin(),
            'Pages Production endpoint differs from approved build endpoint')
    return expected


def live_configuration():
    require(read_switch() == 'true', 'Expected PAGES_PREVIEW_ENABLED=true; STOP, do not edit')
    v = gh('/actions/variables/VITE_SYNC_API_URL', os.environ['PAGES_VARIABLES_READ_TOKEN'])
    require(v['name'] == 'VITE_SYNC_API_URL' and v['value'] == package.origin(),
            'Live build endpoint changed')


def deployment_is_terminal(deployment):
    """Fail closed; only the observed superseded skip extends terminal statuses."""
    if not isinstance(deployment, dict):
        return False
    stage = deployment.get('latest_stage')
    if not isinstance(stage, dict) or not isinstance(stage.get('status'), str):
        return False
    if type(deployment.get('is_skipped')) is not bool:
        return False
    status = stage['status']
    if status in ('success', 'failure', 'canceled'):
        return deployment['is_skipped'] is False and deployment.get('skip_reason') is None
    return (status == 'skipped' and deployment['is_skipped'] is True
            and deployment.get('skip_reason') == 'superseded_queued_build')


def no_competitors():
    own = int(os.environ['GITHUB_RUN_ID'])
    for status in ACTIVE:
        for page in range(1, 11):
            r = gh(f'/actions/runs?status={status}&per_page=100&page={page}')
            require(r['total_count'] <= 1000, 'Actions conflict listing exceeds bound')
            for run in r['workflow_runs']:
                require(run['id'] == own or run['name'] not in WORKFLOWS,
                        'Competing Quality/Pages run; STOP')
            if page * 100 >= r['total_count']:
                break
    # Shared concurrency serializes these workflows; this also checks external CF activity.
    for page in range(1, 41):
        deployments = cf(f'/deployments?per_page=25&page={page}')
        require(isinstance(deployments, list), 'Invalid CF deployment list')
        for d in deployments:
            require(deployment_is_terminal(d),
                    'Cloudflare deployment not terminal')
        if len(deployments) < 25:
            return
    raise RuntimeError('Cloudflare conflict listing exceeds bound')


def current_context():
    return {k: os.environ[k] for k in ('CANDIDATE_SHA', 'CANDIDATE_RUN', 'QUALITY_RUN', 'QUALITY_ATTEMPT')}


def candidate_artifact():
    return package.verify(number(os.environ['FINAL_ARTIFACT_ID']),
                          number(os.environ['CANDIDATE_RUN']), os.environ['FINAL_ARTIFACT_DIGEST'],
                          os.environ['MANIFEST_DIGEST'], Path(os.environ['RUNNER_TEMP']) / 'pages-static')


def artifacts(run_id):
    r = gh(f'/actions/runs/{run_id}/artifacts?per_page=100')
    require(r['total_count'] == len(r['artifacts']), 'Incomplete candidate artifact listing')
    return r['artifacts']


def receipt():
    i = inputs()
    sha = entry(PRODUCTION_PATH)
    run_id = number(i['candidate_run'])
    require(i['confirm'] == 'PUBLISH' and re.fullmatch(DIGEST, i['manifest_sha256'])
            and re.fullmatch(DIGEST, i['artifact_digest'])
            and re.fullmatch(DIGEST, i['readiness_evidence_sha256'])
            and re.fullmatch(ledger.UUID, i['previous_id'])
            and re.fullmatch(SHA, i['previous_sha']), 'Invalid approval inputs')
    r = gh(f'/actions/runs/{run_id}')
    require(r['path'] == CANDIDATE_PATH and r['event'] == 'workflow_dispatch'
            and r['head_branch'] == 'main' and r['head_sha'] == sha and r['run_attempt'] == 1
            and r['status'] == 'completed' and r['conclusion'] == 'success'
            and r['actor']['login'] == OWNER and r['triggering_actor']['login'] == OWNER
            and r['repository']['id'] == REPO_ID and r['head_repository']['id'] == REPO_ID,
            'Candidate run identity/result invalid')
    jobs = gh(f'/actions/runs/{run_id}/attempts/1/jobs?per_page=100')
    require(len(jobs['jobs']) == jobs['total_count'] == 4, 'Unexpected candidate jobs')
    require({j['name'] for j in jobs['jobs']} == {'gate', 'build', 'package', 'preview'}
            and all(j['conclusion'] == 'success' for j in jobs['jobs']), 'Candidate jobs incomplete')
    matches = [a for a in artifacts(run_id) if a['name'] == f'pages-candidate-receipt-{run_id}-1']
    require(len(matches) == 1, 'Missing/ambiguous candidate receipt')
    m = matches[0]
    artifact.validate_metadata(m, run_id, m['id'], m['name'])
    z = package.zip_members(artifact.download_zip(m['id']), ('receipt.json',),
                            m['digest'], m['digest'][7:])
    require(len(z['receipt.json']) < 65536, 'Receipt too large')
    data = strict_json(z['receipt.json'])
    require(data['schema'] == 1 and data['candidate_sha'] == sha
            and data['candidate_run'] == run_id and data['candidate_attempt'] == 1
            and data['manifest_sha256'] == i['manifest_sha256']
            and data['artifact_digest'] == i['artifact_digest']
            and data['previous'] == {'id': i['previous_id'], 'sha': i['previous_sha']}
            and data['origin_sha256'] == package.sha(package.origin().encode()), 'Receipt differs from approval')
    quality(data['quality_run'], data['quality_attempt'], sha)
    os.environ.update({'CANDIDATE_SHA': sha, 'CANDIDATE_RUN': str(run_id),
                       'QUALITY_RUN': str(data['quality_run']), 'QUALITY_ATTEMPT': str(data['quality_attempt'])})
    return data


def review():
    data = receipt()
    package.verify(data['artifact_id'], data['candidate_run'], data['artifact_digest'],
                   data['manifest_sha256'])
    summary('REVIEW BEFORE ENVIRONMENT APPROVAL — no Production write', {
        **data, 'readiness_evidence_sha256': inputs()['readiness_evidence_sha256'],
        'approval_scope': 'One Production publish of these exact bytes; no rebuild; no automatic rollback'})


def approved(require_completed_job=True):
    # Never accept an earlier attempt's review or another run's completed job.
    run_id = number(os.environ['GITHUB_RUN_ID'])
    require(os.environ['GITHUB_RUN_ATTEMPT'] == '1', 'Approval cannot authorize a rerun')
    run = gh(f'/actions/runs/{run_id}')
    require(run['id'] == run_id and run['run_attempt'] == 1
            and run['path'] == PRODUCTION_PATH and run['event'] == 'workflow_dispatch'
            and run['head_branch'] == 'main' and run['head_sha'] == os.environ['GITHUB_SHA']
            and run['actor']['login'] == OWNER and run['triggering_actor']['login'] == OWNER,
            'Approval run/attempt/source identity mismatch')
    reviews = gh(f'/actions/runs/{run_id}/approvals')
    require(isinstance(reviews, list), 'Approval history unavailable')
    matching = [r for r in reviews if any(e['name'] == 'pages-production' for e in r['environments'])]
    require(len(matching) == 1 and matching[0]['state'] == 'approved'
            and matching[0]['user']['login'] == OWNER, 'Explicit owner Environment approval missing')
    if require_completed_job:
        jobs = gh(f'/actions/runs/{run_id}/attempts/1/jobs?per_page=100')
        require(jobs['total_count'] == len(jobs['jobs']), 'Approval jobs listing incomplete')
        matched = [j for j in jobs['jobs'] if j['name'] == 'approval']
        require(len(matched) == 1 and matched[0]['run_id'] == run_id
                and matched[0]['run_attempt'] == 1 and matched[0]['status'] == 'completed'
                and matched[0]['conclusion'] == 'success', 'Same-run approval job not successful')


def approval_binding(data):
    # Explicit tuple; later state fields (intent, upload manifest) do not change it.
    bound = {k: data[k] for k in ('candidate_sha', 'candidate_run', 'candidate_attempt',
             'artifact_id', 'artifact_digest', 'manifest_sha256', 'previous', 'origin_sha256')}
    bound.update({'release_run': number(os.environ['GITHUB_RUN_ID']), 'release_attempt': 1,
                  'readiness_evidence_sha256': inputs()['readiness_evidence_sha256']})
    return package.sha(package.canonical_json(bound))


def approval():
    require(os.environ['GITHUB_JOB'] == 'approval', 'Wrong approval job')
    data = receipt()  # entry, current main, Quality and exact candidate identity
    approved(require_completed_job=False)  # This job itself is still in progress.
    package.verify(data['artifact_id'], data['candidate_run'], data['artifact_digest'],
                   data['manifest_sha256'])
    binding = approval_binding(data)
    output({'binding': binding})
    summary('Owner approval bound to this run; no deployment and no Environment Secret',
            {'release_run': number(os.environ['GITHUB_RUN_ID']), 'attempt': 1,
             'candidate_sha': data['candidate_sha'], 'manifest_sha256': data['manifest_sha256'],
             'approval_binding': binding})


def publish_approval(data):
    require(os.environ['GITHUB_JOB'] == 'publish', 'Wrong publish job')
    approved()
    require(os.environ.get('APPROVAL_BINDING') == approval_binding(data),
            'Approval output does not match this run/artifact/manifest')


def state_path():
    return Path(os.environ['RUNNER_TEMP']) / 'release-state.json'


def preflight(mode):
    if mode == 'candidate':
        candidate_gate()
        manifest, meta = candidate_artifact()
        data = {**package.context(), 'artifact_id': meta['id'], 'artifact_digest': meta['digest'][7:],
                'manifest_sha256': os.environ['MANIFEST_DIGEST']}
        data['branch'] = 'production-candidate-' + data['candidate_sha'][:12] + '-' + str(data['candidate_run'])
        require(data['branch'] != 'main' and re.fullmatch(r'production-candidate-[0-9a-f]{12}-[1-9][0-9]*', data['branch']),
                'Unsafe candidate branch')
    else:
        data = receipt()
        publish_approval(data)
        manifest, _ = package.verify(data['artifact_id'], data['candidate_run'], data['artifact_digest'],
                                      data['manifest_sha256'], Path(os.environ['RUNNER_TEMP']) / 'pages-static')
        require(data['candidate_sha'] != inputs()['previous_sha'], 'Already on candidate source')
        require(re.fullmatch(ledger.UUID, data['preview']['id']) is not None, 'Invalid Preview ID')
        d = cf('/deployments/' + data['preview']['id'])
        verify_deployment(d, data, 'preview', data['preview']['url'])
        data['branch'] = 'main'
    live_configuration()
    no_competitors()
    before = project()
    if mode == 'production':
        require(before == data['previous'], 'Canonical moved since candidate/approval')
    data['previous'] = before
    data['manifest'] = manifest
    package.check_local(manifest)
    # Write durable single-use intent BEFORE Wrangler. If response is uncertain, STOP.
    if mode == 'production':
        data['intent_id'] = ledger.begin({
            'schema': 1, 'release_run': int(os.environ['GITHUB_RUN_ID']),
            'candidate_sha': data['candidate_sha'], 'candidate_run': data['candidate_run'],
            'artifact_id': data['artifact_id'], 'artifact_digest': data['artifact_digest'],
            'manifest_sha256': data['manifest_sha256'], 'previous': before,
            'readiness_evidence_sha256': inputs()['readiness_evidence_sha256']})
    state_path().write_bytes(package.canonical_json(data))
    output({'branch': data['branch'], 'sha': data['candidate_sha']})


def last_check(mode):
    # Called by wrangler-action preCommands after tools are installed, immediately before write.
    data = strict_json(state_path().read_bytes())
    entry(CANDIDATE_PATH if mode == 'candidate' else PRODUCTION_PATH)
    quality(data['quality_run'], data['quality_attempt'], data['candidate_sha'])
    live_configuration()
    no_competitors()
    # Do not resolve the in-progress intent as a successful baseline.
    p = cf()
    c = p['canonical_deployment']
    require(c['id'] == data['previous']['id']
            and c['deployment_trigger']['metadata']['commit_hash'] == data['previous']['sha'],
            'Canonical changed after preflight')
    config = p['source']['config']
    require(p['production_branch'] == 'main' and p['source']['type'] == 'github'
            and config['owner'] == OWNER and config['repo_name'] == PROJECT
            and config['production_branch'] == 'main'
            and config['production_deployments_enabled'] is False
            and config['preview_deployment_setting'] == 'none', 'Project changed before write')
    require(p['deployment_configs']['production']['env_vars']['VITE_SYNC_API_URL']['type'] == 'plain_text'
            and p['deployment_configs']['production']['env_vars']['VITE_SYNC_API_URL']['value'] == package.origin(),
            'Production endpoint changed before write')
    package.check_local(data['manifest'])
    if mode == 'production':
        publish_approval(data)
        records = ledger.entries()
        require(bool(records) and records[0]['id'] == data['intent_id'], 'Release intent changed')
        payload = ledger.provenance(records[0], completed=False)
        require(payload['release_run'] == int(os.environ['GITHUB_RUN_ID'])
                and payload['manifest_sha256'] == data['manifest_sha256'], 'Wrong current intent')
        require(not gh(f"/deployments/{data['intent_id']}/statuses?per_page=100"),
                'Release intent already has a status; do not repeat write')


def verify_deployment(d, data, environment, url):
    require(re.fullmatch(ledger.UUID, d['id']) is not None, 'Invalid deployment ID')
    require(d['environment'] == environment and d['url'] == url
            and url == f"https://{d['id'][:8]}.loveca-card-list.pages.dev"
            and d.get('uses_functions') is False, 'Wrong deployment environment/URL/functions')
    meta = d['deployment_trigger']['metadata']
    require(meta['branch'] == data['branch'] and meta['commit_hash'] == data['candidate_sha'],
            'Published branch/source mismatch')
    require(d['latest_stage']['name'] == 'deploy' and d['latest_stage']['status'] == 'success',
            'Deployment did not succeed')


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

def postflight(mode):
    data = strict_json(state_path().read_bytes())
    deploy_id = os.environ.get('DEPLOY_ID', '')
    require(re.fullmatch(ledger.UUID, deploy_id) is not None, 'Publish outcome unknown; no retry')
    url = os.environ.get('DEPLOY_URL', '').rstrip('/')
    environment = 'preview' if mode == 'candidate' else 'production'
    require(os.environ.get('DEPLOY_ENVIRONMENT') == environment, 'Action environment mismatch')
    d = None
    for _ in range(6):
        d = cf('/deployments/' + deploy_id)
        if d['latest_stage']['status'] in ('success', 'failure', 'canceled'):
            break
        time.sleep(3)  # Metadata reads only; never repeat deploy.
    verify_deployment(d, data, environment, url)
    http_verify(url, data['manifest'])
    if mode == 'production':
        http_verify('https://loveca-card-list.pages.dev', data['manifest'])
    c = cf()['canonical_deployment']
    expected = data['previous'] if mode == 'candidate' else {'id': deploy_id, 'sha': data['candidate_sha']}
    require(c['id'] == expected['id'] and c['environment'] == 'production'
            and c['deployment_trigger']['metadata']['commit_hash'] == expected['sha'], 'Canonical transition mismatch')
    clean = {k: v for k, v in data.items() if k != 'manifest'}
    clean['preview' if mode == 'candidate' else 'production'] = {
        'id': deploy_id, 'url': url, 'environment': environment,
        'aliases': d.get('aliases', []), 'branch': data['branch'], 'source_sha': data['candidate_sha']}
    if mode == 'candidate':
        root = Path(os.environ['RUNNER_TEMP']) / 'candidate-receipt'
        root.mkdir()
        (root / 'receipt.json').write_bytes(package.canonical_json(clean))
        summary('Exact candidate Preview verified — Production NOT authorized', clean)
    else:
        summary('Production postflight verified — retain previous deployment for approved rollback', clean)
        # Last release mutation. A ledger failure leaves CF success unratified and Preview STOPs.
        ledger.finish(data['intent_id'], deploy_id, data['manifest_sha256'])


def audit_failure():
    p = state_path()
    if not p.exists():
        print('No completed preflight. No further writes authorized.')
        return
    data = strict_json(p.read_bytes())
    c = cf()['canonical_deployment']
    summary('STOP — inspect outcome; no retry, rollback, deletion or switch edit', {
        'before': data['previous'], 'observed_id': c['id'],
        'observed_sha': c['deployment_trigger']['metadata']['commit_hash'],
        'intent_id': data.get('intent_id'), 'run': os.environ['GITHUB_RUN_ID']})


def _trusted_stop_locations():
    """Snapshot code identities from the workflow's immutable, colocated helpers."""
    try:
        root = Path(__file__).resolve().parent
        allowed = (
            ('release.py', globals(), 'inputs output summary number entry quality candidate_gate project live_configuration deployment_is_terminal no_competitors current_context candidate_artifact artifacts receipt review approved approval_binding approval publish_approval state_path preflight last_check verify_deployment http_verify postflight audit_failure'),
            ('guard.py', sys.modules['guard'].__dict__, 'require request_json strict_json gh read_switch cf'),
            ('artifact.py', artifact.__dict__, 'download_zip validate_metadata verify_zip inspect_tar write_static'),
            ('package.py', package.__dict__, 'sha origin csp headers canonical_json metadata zip_members records context check_content pack verify check_local'),
            ('ledger.py', ledger.__dict__, 'entries provenance expected_canonical write begin finish'),
        )
        locations = []
        for filename, namespace, names in allowed:
            expected = root / filename
            if Path(namespace['__file__']).resolve() != expected:
                continue
            for name in names.split():
                function = namespace.get(name)
                if (type(function) is type(_trusted_stop_locations)
                        and function.__globals__ is namespace
                        and Path(function.__code__.co_filename).resolve() == expected):
                    locations.append((function.__code__, namespace, filename + ':' + name))
        return tuple(locations)
    except BaseException:
        return ()


_STOP_LOCATIONS = _trusted_stop_locations()


def _report_stop_locations(error):
    """Emit at most eight trusted locations; never format exception data or paths."""
    try:
        locations = []
        tb = error.__traceback__
        for _ in range(64):
            if tb is None:
                break
            for code, namespace, label in _STOP_LOCATIONS:
                if tb.tb_frame.f_code is code and tb.tb_frame.f_globals is namespace:
                    line = tb.tb_lineno
                    if type(line) is int and 1 <= line <= 1000000:
                        locations.append(label + ':' + str(line))
                        locations = locations[-8:]
                    break
            tb = tb.tb_next
        print('Release STOP locations: ' + (' > '.join(locations) or 'UNKNOWN'), file=sys.stderr)
    except BaseException:
        try:
            print('Release STOP locations: UNKNOWN', file=sys.stderr)
        except BaseException:
            pass


if __name__ == '__main__':
    try:
        command = sys.argv[1]
        if command == 'gate': candidate_gate()
        elif command == 'review': review()
        elif command == 'approval': approval()
        elif command == 'preflight': preflight(sys.argv[2])
        elif command == 'last-check': last_check(sys.argv[2])
        elif command == 'postflight': postflight(sys.argv[2])
        elif command == 'audit-failure': audit_failure()
        else: raise RuntimeError('Unknown release mode')
    except Exception as error:
        # Never print remote bodies, URLs with credentials, endpoint values or exception repr.
        _report_stop_locations(error)
        sys.exit(1)
