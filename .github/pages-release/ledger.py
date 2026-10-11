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
    return all_entries()


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


def normal_expected_canonical(records=None):
    records = entries() if records is None else records
    if not records:
        return {'id': PRODUCTION_ID, 'sha': PRODUCTION_SHA}
    latest = records[0]
    payload = provenance(latest)
    statuses = complete_list(f"/deployments/{latest['id']}/statuses")
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

# W5.9 review candidate. A single explicitly scoped recovery; never a general
# exception to normal release success requirements. No mutations in this section.
import base64
import hashlib
from pathlib import Path

RECOVERY_TASK = 'loveca-pages-reconcile-v1'
RECOVERY_WORKFLOW = '.github/workflows/pages-reconcile.yml'
RECOVERY_JOBS = {'review', 'approval', 'verify-current', 'record', 'audit-current'}
TARGET = {
    'original_intent': 6993075950,
    'original_run': 38124420795,
    'original_attempt': 1,
    'published_sha': 'ad057dc1b0afa4160f9535d1188ec392b8942de6',
    'cf_id': 'c9860bc1-1be7-4cf4-9518-008206b1cc36',
    'candidate_run': 37818642927, 'candidate_attempt': 1,
    'artifact_id': 11568840660,
    'artifact_digest': 'f0bba0bbb0e0c201dade5a3b0cd30c1b4bcfb56f3b39805d9bff54521d1a3630',
    'manifest_sha256': '47dcdc50c5ffb7104803cf7928f37b8bdf290fb94a64a6de3aecd373c6d92276',
    'receipt_artifact': 11568172225,
    'receipt_zip_digest': 'ebd0821e9adb00664ed8f266b61d6549e36b61993ef0caec62f6058ef32c77a5',
    'receipt_sha256': '9eeaeebbe79c5ab13cfb3520a15bcbfe3072f0f746e0824188e347f5c41294c9',
    'origin_sha256': '27e2288079d02715db362e109eb5a7eaa3031ed3fbf660dcc3f8ee727814d29d',
    'readiness_v1_sha256': 'd7763213d623ac72b3d85a22e9574ade825823cc2185b92d0821b6a695282f55',
    'diagnostic_run': 38133480378,
    'diagnostic_sha': '6bc22040e85ca40d2ffaa1bb72f6f49666275248',
    'http_results_sha256': '708b4e506d8e53b60cf027bb77c58b2d662941b6479f1aa5afbc8196d0c0cc18',
}
# Filled mechanically by the local candidate builder, not by dispatch inputs.
# These hashes bind the recovery workflow and its executable verifier to review.
RECOVERY_CODE = {'.github/workflows/pages-reconcile.yml': '7ee9c2eabdde2a63cec225381c4fcef1bf60724f3dd05bd56c9de3b73d97503b', '.github/pages-release/reconcile.py': '4c404d61883cd4e84298802e7847828adccc9433a850e47fe480e31c45be856f', '.github/pages-release/reconcile_http.py': 'be9ee5259a8ab68fc9d131c627f1715411f0e555f41a3290de53ed5229b0644e', '.github/pages-release/package.py': 'fa155b7810e5f8761b131eac6559ae9188f812f235a131c06a86f229841bf7be', '.github/pages-preview/artifact.py': '603af8ef3f224cd3a06f77c4b2ebf0193e5d5f50bfb0c3555631995eb1128d71', '.github/pages-preview/guard.py': 'ee8c9907ed42d4a2b541e03ec42ea53dbadac49605901dc940244e446d14f96d'}


def digest_json(value):
    return hashlib.sha256((json.dumps(value, sort_keys=True, separators=(',', ':'),
                                     ensure_ascii=True) + '\n').encode()).hexdigest()


def complete_list(path, key=None, limit=10, size=100):
    """A terminal short page (or exact stable total) is mandatory; no fallback."""
    rows, seen, total = [], set(), None
    for page in range(1, limit + 1):
        result = gh(path + ('&' if '?' in path else '?') + f'per_page={size}&page={page}')
        batch = result if key is None else result[key]
        require(isinstance(batch, list) and len(batch) <= size, 'Recovery listing malformed')
        if key is not None:
            count = result['total_count']
            require(type(count) is int and 0 <= count <= limit * size,
                    'Recovery listing exceeds bound')
            require(total is None or total == count, 'Recovery listing changed')
            total = count
        for row in batch:
            rid = row['id']
            require(type(rid) is int and rid > 0 and rid not in seen, 'Duplicate/invalid listing ID')
            seen.add(rid)
            rows.append(row)
        if total is not None:
            require(len(rows) <= total, 'Contradictory listing count')
            if len(rows) == total:
                return rows
            require(len(batch) == size, 'Incomplete recovery listing')
        elif len(batch) < size:
            return rows
    raise RuntimeError('Recovery pagination incomplete; STOP')


def all_entries():
    rows = complete_list(f'/deployments?environment={ENVIRONMENT}')
    release_shas, recovered = set(), set()
    for row in rows:
        require(row['environment'] == ENVIRONMENT
                and row['task'] in (TASK, RECOVERY_TASK), 'Unknown ledger type; STOP')
        p = row['payload']
        if isinstance(p, str):
            p = strict_json(p.encode())
        require(isinstance(p, dict), 'Invalid ledger payload')
        if row['task'] == TASK:
            require(row['sha'] not in release_shas, 'Duplicate release source')
            release_shas.add(row['sha'])
        else:
            require(p.get('schema') == RECOVERY_TASK, 'Unknown recovery schema')
            parent = p.get('target', {}).get('original_intent')
            require(type(parent) is int and parent not in recovered, 'Duplicate recovery; STOP')
            recovered.add(parent)
    return sorted(rows, key=lambda row: row['id'], reverse=True)


def recovery_run(run_id, control_sha, completed=False, approval_sha=None):
    require(type(run_id) is int and run_id > 0
            and re.fullmatch(r'[0-9a-f]{40}', control_sha) is not None, 'Invalid recovery identity')
    r = gh(f'/actions/runs/{run_id}')
    require(re.fullmatch(r'[0-9a-f]{64}', approval_sha or '') is not None
            and r['display_title'] == f"Reconcile {TARGET['original_intent']} {approval_sha} {control_sha}",
            'Recovery dispatch approval/title mismatch')
    require(r['id'] == run_id and type(r['run_attempt']) is int and r['run_attempt'] == 1
            and r['path'] == RECOVERY_WORKFLOW and r['event'] == 'workflow_dispatch'
            and r['head_branch'] == 'main' and r['head_sha'] == control_sha,
            'Wrong recovery run/workflow/control SHA')
    for k in ('repository', 'head_repository'):
        require(r[k]['full_name'] == REPO and r[k]['id'] == 1354007978
                and r[k]['fork'] is False, 'Foreign recovery repository')
    require(r['actor']['login'] == OWNER and r['triggering_actor']['login'] == OWNER,
            'Wrong recovery actor')
    if completed:
        require(r['status'] == 'completed' and r['conclusion'] == 'success',
                'Recovery run not successfully completed; STOP')
    else:
        require(r['status'] == 'in_progress' and r['conclusion'] is None,
                'Recovery run is not active')
    # Bind the shared security code too, without a self-referential embedded hash.
    # Subsequent app-only main changes are fine; a ledger implementation change
    # requires an explicit historical-trust migration, never silent acceptance.
    b = gh(f'/contents/.github/pages-release/ledger.py?ref={control_sha}')
    require(b['type'] == 'file' and b['encoding'] == 'base64'
            and base64.b64decode(b['content']) == Path(__file__).read_bytes(),
            'Recovery ledger implementation is not this reviewed reader')
    require(bool(RECOVERY_CODE), 'Recovery code pins absent')
    for path, expected in RECOVERY_CODE.items():
        b = gh(f'/contents/{path}?ref={control_sha}')
        require(b['type'] == 'file' and b['encoding'] == 'base64', 'Recovery control unavailable')
        raw = base64.b64decode(b['content'], validate=False)
        require(hashlib.sha256(raw).hexdigest() == expected, 'Unreviewed recovery code')
    return r


def owner_approval(run_id, require_job=True):
    reviews = gh(f'/actions/runs/{run_id}/approvals')
    require(isinstance(reviews, list), 'Approval history unavailable')
    matches = [r for r in reviews if any(e['name'] == ENVIRONMENT for e in r['environments'])]
    require(len(matches) == 1 and matches[0]['state'] == 'approved'
            and matches[0]['user']['login'] == OWNER, 'Same-run owner approval missing')
    if require_job:
        jobs = complete_list(f'/actions/runs/{run_id}/attempts/1/jobs', 'jobs')
        matches = [j for j in jobs if j['name'] == 'approval']
        require(len(matches) == 1 and matches[0]['run_id'] == run_id
                and matches[0]['run_attempt'] == 1 and matches[0]['status'] == 'completed'
                and matches[0]['conclusion'] == 'success', 'Approval job incomplete')


def original_intent(rows):
    matches = [r for r in rows if r['id'] == TARGET['original_intent']]
    require(len(matches) == 1, 'Original intent missing/duplicate')
    row = matches[0]
    p = provenance(row, completed=False)  # ONLY this exact known failed release.
    expected = {'schema': 1, 'release_run': TARGET['original_run'],
        'candidate_sha': TARGET['published_sha'], 'candidate_run': TARGET['candidate_run'],
        'artifact_id': TARGET['artifact_id'], 'artifact_digest': TARGET['artifact_digest'],
        'manifest_sha256': TARGET['manifest_sha256'],
        'previous': {'id': PRODUCTION_ID, 'sha': PRODUCTION_SHA},
        'readiness_evidence_sha256': TARGET['readiness_v1_sha256']}
    require(digest_json(p) == digest_json(expected), 'Original intent binding differs')
    r = gh(f"/actions/runs/{TARGET['original_run']}")
    require(r['id'] == TARGET['original_run'] and type(r['run_attempt']) is int
            and r['run_attempt'] == 1 and r['status'] == 'completed' and r['conclusion'] == 'failure'
            and r['repository']['id'] == 1354007978 and r['repository']['fork'] is False
            and r['head_repository']['id'] == 1354007978 and r['head_repository']['fork'] is False,
            'Original failure identity changed')
    owner_approval(TARGET['original_run'])
    # This candidate handles an untouched, status-less intent only. Its actual
    # raw status state is an execution prerequisite, NOT inferred from the UI.
    statuses = complete_list(f"/deployments/{TARGET['original_intent']}/statuses")
    require(statuses == [], 'Original raw statuses require separate review')
    return row


def recovery_binding(run_id, control_sha, approval_sha):
    require(re.fullmatch(r'[0-9a-f]{64}', approval_sha) is not None
            and approval_sha != TARGET['readiness_v1_sha256'], 'Separate recovery approval required')
    return digest_json({'target': TARGET, 'recovery_run': run_id, 'attempt': 1,
                        'control_sha': control_sha, 'approval_sha256': approval_sha})


def validate_recovery(record, rows, completed=True):
    require(record['creator']['login'] == 'github-actions[bot]'
            and record['environment'] == ENVIRONMENT and record['task'] == RECOVERY_TASK
            and record['production_environment'] is True
            and record['transient_environment'] is False
            and record['sha'] == TARGET['published_sha'], 'Invalid recovery record')
    p = record['payload']
    if isinstance(p, str):
        p = strict_json(p.encode())
    require(set(p) == {'schema', 'target', 'recovery_run', 'recovery_attempt', 'control_sha',
                       'approval_sha256', 'approval_binding', 'verified_at', 'snapshot_sha256'}
            and p['schema'] == RECOVERY_TASK and digest_json(p['target']) == digest_json(TARGET)
            and type(p['recovery_attempt']) is int and p['recovery_attempt'] == 1, 'Recovery target/schema mismatch')
    expected_snapshot = {'cf_id': TARGET['cf_id'], 'published_sha': TARGET['published_sha'],
                         'git_production_auto': False, 'git_preview_auto': 'none',
                         'origin_sha256': TARGET['origin_sha256'], 'functions': False}
    require(type(p['verified_at']) is int and 0 < p['verified_at'] <= time.time()
            and p['snapshot_sha256'] == digest_json(expected_snapshot),
            'Missing current-state attestation')
    require(p['approval_binding'] == recovery_binding(p['recovery_run'], p['control_sha'],
                                                     p['approval_sha256']), 'Recovery approval mismatch')
    releases = [r for r in rows if r['task'] == TASK]
    require(bool(releases) and releases[0]['id'] == TARGET['original_intent']
            and rows[0]['id'] == record['id'] and record['id'] > TARGET['original_intent'],
            'Newer/unrelated unresolved intent; no fallback')
    original_intent(rows)
    recovery_run(p['recovery_run'], p['control_sha'], completed=completed,
                 approval_sha=p['approval_sha256'])
    owner_approval(p['recovery_run'])
    if completed:
        jobs = complete_list(f"/actions/runs/{p['recovery_run']}/attempts/1/jobs", 'jobs')
        require(len(jobs) == 5 and {j['name'] for j in jobs} == RECOVERY_JOBS
                and all(j['run_id'] == p['recovery_run'] and j['run_attempt'] == 1
                        and j['status'] == 'completed' and j['conclusion'] == 'success' for j in jobs),
                'Recovery verification/record/audit did not all succeed')
    statuses = complete_list(f"/deployments/{record['id']}/statuses")
    require(len(statuses) == 1, 'Missing/ambiguous recovery status')
    s = statuses[0]
    require(s['state'] == 'success' and s['creator']['login'] == 'github-actions[bot]'
            and s['description'] == 'reconcile:' + digest_json(p)
            and s['log_url'] == f"https://github.com/{REPO}/actions/runs/{p['recovery_run']}"
            and s['environment_url'] == f"https://{TARGET['cf_id'][:8]}.loveca-card-list.pages.dev",
            'Recovery status/provenance mismatch')
    return {'id': TARGET['cf_id'], 'sha': TARGET['published_sha']}


def expected_canonical():
    try:
        rows = entries()
        if not rows or rows[0]['task'] == TASK:
            # Existing normal provenance and completed/success gate remain intact.
            return normal_expected_canonical(rows)
        return validate_recovery(rows[0], rows)
    except Exception:
        # Preview's legacy boundary prints str(error); never pass raw values or
        # filesystem/transport exception text through this new reader path.
        raise RuntimeError('Ledger resolution STOP; sensitive details suppressed') from None
