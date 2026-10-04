"""Trusted GitHub deployment ledger. CF access remains GET-only here.

Only release.py's Production preflight/postflight call begin()/finish().
Read consumers accept the latest ledger entry, never an older convenient success.
"""
import json
import os
import re
import time
import urllib.error
import urllib.request

from guard import REPO, OWNER, PRODUCTION_ID, PRODUCTION_SHA, gh, require, strict_json

ENVIRONMENT = 'pages-production'
TASK = 'loveca-pages-release-v1'
WORKFLOW = '.github/workflows/pages-production.yml'
UUID = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'


def entries():
    # Bound pagination: do not silently omit an unresolved/duplicate release.
    result = []
    for page in range(1, 11):
        batch = gh(f'/deployments?environment={ENVIRONMENT}&task={TASK}&per_page=100&page={page}')
        require(isinstance(batch, list), 'Invalid deployment listing')
        result.extend(batch)
        if len(batch) < 100:
            return sorted(result, key=lambda d: d['id'], reverse=True)
    raise RuntimeError('Ledger pagination bound; review required')


def provenance(entry, completed=True):
    require(entry['creator']['login'] == 'github-actions[bot]', 'Untrusted ledger creator')
    require(entry['environment'] == ENVIRONMENT and entry['task'] == TASK,
            'Wrong ledger environment/task')
    require(entry['production_environment'] is True, 'Not a Production record')
    payload = entry['payload']
    if isinstance(payload, str):
        payload = strict_json(payload.encode())
    require(payload['schema'] == 1 and type(payload['release_run']) is int,
            'Invalid ledger payload')
    run = gh(f"/actions/runs/{payload['release_run']}")
    require(run['path'] == WORKFLOW and run['event'] == 'workflow_dispatch'
            and run['head_branch'] == 'main' and run['run_attempt'] == 1,
            'Wrong release workflow/attempt')
    require(run['repository']['full_name'] == REPO
            and run['head_repository']['full_name'] == REPO,
            'Foreign release run')
    require(run['actor']['login'] == OWNER and run['triggering_actor']['login'] == OWNER,
            'Wrong release actor')
    require(run['head_sha'] == entry['sha'] == payload['candidate_sha'],
            'Ledger source mismatch')
    if completed:
        # A successful status can precede run completion by a few seconds.
        for _ in range(6):
            if run['status'] == 'completed':
                break
            time.sleep(2)
            run = gh(f"/actions/runs/{payload['release_run']}")
        require(run['status'] == 'completed' and run['conclusion'] == 'success'
                and run['run_attempt'] == 1, 'Release run not successfully completed')
    return payload


def expected_canonical():
    records = entries()
    if not records:
        return {'id': PRODUCTION_ID, 'sha': PRODUCTION_SHA}
    latest = records[0]
    payload = provenance(latest)
    statuses = gh(f"/deployments/{latest['id']}/statuses?per_page=100")
    require(bool(statuses), 'Unresolved release intent')
    status = statuses[0]
    require(status['state'] == 'success'
            and status['creator']['login'] == 'github-actions[bot]',
            'Latest release is not a trusted success; STOP, no fallback')
    match = re.fullmatch(r'cf:(' + UUID + r');manifest:([0-9a-f]{64})', status['description'])
    require(match is not None and match[2] == payload['manifest_sha256'], 'Invalid release receipt')
    require(status['log_url'] == f"https://github.com/{REPO}/actions/runs/{payload['release_run']}",
            'Receipt provenance mismatch')
    require(status['environment_url'] == f'https://{match[1][:8]}.loveca-card-list.pages.dev',
            'Receipt URL mismatch')
    return {'id': match[1], 'sha': payload['candidate_sha']}


def write(path, body):
    # No retries for a mutation. An uncertain response requires investigation.
    require(os.environ.get('GITHUB_JOB') == 'publish', 'Ledger writes only in publish job')
    require(os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
            and os.environ.get('GITHUB_RUN_ATTEMPT') == '1', 'No ledger reruns')
    token = os.environ.get('GH_TOKEN', '')
    require(re.fullmatch(r'[A-Za-z0-9._~+/-]+=*', token) is not None, 'Missing GitHub token')
    request = urllib.request.Request('https://api.github.com/repos/' + REPO + path,
        data=json.dumps(body).encode(), method='POST', headers={
            'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
            'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10'})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
            require(response.status == 201, 'Unexpected ledger write status')
            data = response.read(1024 * 1024 + 1)
            require(len(data) <= 1024 * 1024, 'Ledger response too large')
            return strict_json(data)
    except Exception:
        raise RuntimeError('Ledger write failed/unknown; do not retry or publish again') from None


def begin(payload):
    require(not any(d['sha'] == payload['candidate_sha'] for d in entries()),
            'This SHA already has a Production intent; do not republish')
    result = write('/deployments', {
        'ref': payload['candidate_sha'], 'auto_merge': False,
        # Actions workflow/job identity is explicitly checked by release.py;
        # this API's legacy status contexts are not a replacement quality gate.
        'required_contexts': [], 'environment': ENVIRONMENT, 'task': TASK,
        'production_environment': True, 'transient_environment': False,
        'description': 'Approved exact Pages artifact; one publish attempt', 'payload': payload})
    require(result['sha'] == payload['candidate_sha'], 'Ledger changed source')
    return result['id']


def finish(intent_id, deployment_id, manifest):
    require(re.fullmatch(UUID, deployment_id) is not None, 'Invalid CF deployment ID')
    return write(f'/deployments/{intent_id}/statuses', {
        'state': 'success', 'auto_inactive': False, 'environment': ENVIRONMENT,
        'environment_url': f'https://{deployment_id[:8]}.loveca-card-list.pages.dev',
        'log_url': f"https://github.com/{REPO}/actions/runs/{os.environ['GITHUB_RUN_ID']}",
        'description': f'cf:{deployment_id};manifest:{manifest}'})
