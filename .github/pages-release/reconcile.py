"""W5.9 review candidate: exact-target reconciliation, not a deployment tool.

Only record() may POST, exactly one new deployment and one success status.
Cloudflare is GET-only and present exclusively in verify-current/audit-current.
All entrypoint exceptions are replaced with a fixed STOP message.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import artifact
import package
import ledger
import reconcile_http
from guard import REPO, REPO_ID, OWNER, PROJECT, QUALITY_PATH, QUALITY_BLOB, QUALITY_ID
from guard import gh, cf, require, strict_json, read_switch

T = ledger.TARGET
JOBS = ledger.RECOVERY_JOBS
MAX_AGE = 120  # review choice: terminal verify snapshot to record <=120 seconds
ACTIVE = ('queued', 'in_progress', 'waiting', 'pending', 'requested')
NAMES = {'Quality checks', 'Pages Preview', 'Pages Candidate', 'Pages Production', 'Pages Reconcile'}


def inputs():
    value = strict_json(Path(os.environ['GITHUB_EVENT_PATH']).read_bytes())['inputs']
    require(set(value) == {'control_sha', 'recovery_evidence_sha256', 'confirm'}
            and value['confirm'] == 'RECONCILE-ONLY', 'Wrong recovery approval inputs')
    return value


def identity():
    i = inputs()
    require(os.environ['GITHUB_REPOSITORY'] == REPO
            and os.environ['GITHUB_REF'] == 'refs/heads/main'
            and os.environ['GITHUB_EVENT_NAME'] == 'workflow_dispatch'
            and os.environ['GITHUB_RUN_ATTEMPT'] == '1'
            and os.environ['GITHUB_ACTOR'] == OWNER
            and os.environ['GITHUB_TRIGGERING_ACTOR'] == OWNER
            and os.environ['GITHUB_WORKFLOW_REF'] == f'{REPO}/{ledger.RECOVERY_WORKFLOW}@refs/heads/main',
            'Wrong recovery execution context')
    sha = os.environ['GITHUB_SHA']
    run = int(os.environ['GITHUB_RUN_ID'])
    require(sha == i['control_sha'] == os.environ['TRUSTED_SHA']
            and sha != T['published_sha'], 'Control/published SHA must be separate')
    branch = gh('/branches/main')
    require(branch['commit']['sha'] == sha and branch['protected'] is True, 'main moved/unprotected')
    require(gh(f'/contents/{QUALITY_PATH}?ref={sha}')['sha'] == QUALITY_BLOB,
            'Quality definition changed')
    ledger.recovery_run(run, sha, approval_sha=i['recovery_evidence_sha256'])
    binding = ledger.recovery_binding(run, sha, i['recovery_evidence_sha256'])
    return run, sha, binding


def jobs_for(run):
    return ledger.complete_list(f'/actions/runs/{run}/attempts/1/jobs', 'jobs')


def completed_jobs(run, names):
    rows = jobs_for(run)
    require(len({j['name'] for j in rows}) == len(rows)
            and all(j['name'] in JOBS and j['run_id'] == run and j['run_attempt'] == 1 for j in rows),
            'Unexpected recovery jobs')
    for name in names:
        found = [j for j in rows if j['name'] == name]
        require(len(found) == 1 and found[0]['status'] == 'completed'
                and found[0]['conclusion'] == 'success', 'Prerequisite recovery job incomplete')


def authorized(run, binding, names):
    ledger.owner_approval(run)
    require(os.environ['APPROVAL_BINDING'] == binding, 'Approval output mismatch')
    completed_jobs(run, names)


def run_identity(run_id, path, sha, conclusion):
    r = gh(f'/actions/runs/{run_id}')
    require(r['id'] == run_id and r['run_attempt'] == 1 and r['path'] == path
            and r['head_branch'] == 'main' and r['head_sha'] == sha
            and r['event'] == 'workflow_dispatch' and r['status'] == 'completed'
            and r['conclusion'] == conclusion
            and r['actor']['login'] == OWNER and r['triggering_actor']['login'] == OWNER,
            'Evidence run identity/result mismatch')
    for key in ('repository', 'head_repository'):
        require(r[key]['id'] == REPO_ID and r[key]['full_name'] == REPO
                and r[key]['fork'] is False, 'Evidence repository mismatch')
    return r


def quality(run_id, sha):
    r = gh(f'/actions/runs/{run_id}')
    require(r['id'] == run_id and r['run_attempt'] == 1 and r['head_sha'] == sha
            and r['event'] == 'push' and r['head_branch'] == 'main'
            and r['path'] == QUALITY_PATH and r['workflow_id'] == QUALITY_ID
            and r['status'] == 'completed' and r['conclusion'] == 'success'
            and r['actor']['login'] == OWNER and r['triggering_actor']['login'] == OWNER,
            'Quality not a successful main push')
    for key in ('repository', 'head_repository'):
        require(r[key]['id'] == REPO_ID and r[key]['full_name'] == REPO
                and r[key]['fork'] is False, 'Foreign Quality repository')
    jobs = jobs_for(run_id)
    matched = [j for j in jobs if j['name'] == 'quality']
    require(len(matched) == 1 and matched[0]['conclusion'] == 'success'
            and matched[0]['status'] == 'completed', 'Quality job not successful')


def current_quality(sha):
    runs = ledger.complete_list(f'/actions/workflows/{QUALITY_ID}/runs?head_sha={sha}&event=push',
                                'workflow_runs')
    require(len(runs) == 1, 'Missing/ambiguous new-main Quality')
    quality(runs[0]['id'], sha)


def unresolved():
    rows = ledger.entries()
    require(rows and rows[0]['id'] == T['original_intent']
            and not any(r['task'] == ledger.RECOVERY_TASK for r in rows),
            'Another/latest intent or recovery exists; no retry')
    ledger.original_intent(rows)
    run_identity(T['original_run'], ledger.WORKFLOW, T['published_sha'], 'failure')
    jobs = jobs_for(T['original_run'])
    require(len(jobs) == 3 and {j['name'] for j in jobs} == {'review', 'approval', 'publish'},
            'Original job set changed')
    by_name = {j['name']: j for j in jobs}
    require(all(by_name[n]['conclusion'] == 'success' for n in ('review', 'approval'))
            and by_name['publish']['conclusion'] == 'failure', 'Original result changed')
    steps = by_name['publish']['steps']
    expected = {
        'Read all gates; Production also records one-use intent': 'success',
        'One Wrangler publish; never rerun': 'success',
        'Verify served bytes, CSP, metadata and canonical': 'failure',
        'Read outcome after failure; no recovery writes': 'success',
    }
    for name, state in expected.items():
        found = [s for s in steps if s['name'] == name]
        require(len(found) == 1 and found[0]['conclusion'] == state, 'Original publish evidence differs')
    return ledger.digest_json(rows)


def download_zip(artifact_id):
    """One API GET + one signed storage GET; never forward GitHub credentials."""
    require(artifact_id in (T['artifact_id'], T['receipt_artifact']), 'Unexpected artifact')
    token = os.environ['GH_TOKEN']
    require(re.fullmatch(r'[A-Za-z0-9._~+/-]+=*', token) is not None, 'Invalid read credential')
    req = urllib.request.Request(f'https://api.github.com/repos/{REPO}/actions/artifacts/{artifact_id}/zip',
            method='GET', headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json'})
    opener = urllib.request.build_opener(artifact.NoRedirect)
    try:
        with opener.open(req, timeout=30):
            raise RuntimeError('Expected artifact redirect')
    except urllib.error.HTTPError as error:
        require(error.code == 302, 'Artifact download rejected')
        signed = error.headers['Location']
    parsed = urllib.parse.urlsplit(signed)
    require(parsed.scheme == 'https' and parsed.username is None and parsed.password is None
            and parsed.port is None and not parsed.fragment and parsed.hostname is not None
            and (parsed.hostname.endswith('.blob.core.windows.net')
                 or parsed.hostname.endswith('.actions.githubusercontent.com')),
            'Unexpected artifact storage; STOP without following')
    req = urllib.request.Request(signed, method='GET')
    with opener.open(req, timeout=60) as response:
        require(response.status == 200, 'Artifact storage status')
        data = response.read(artifact.MAX_ARCHIVE + 1)
    require(len(data) <= artifact.MAX_ARCHIVE, 'Artifact exceeds bound')
    return data


def diagnostic_evidence():
    r = gh(f"/actions/runs/{T['diagnostic_run']}")
    require(r['id'] == T['diagnostic_run'] and r['run_number'] == 1 and r['run_attempt'] == 1
            and r['path'] == '.github/workflows/w57-production-http-readonly-38124420795.yml'
            and r['event'] == 'push' and r['head_branch'] == 'diagnostic/w57-http-38124420795'
            and r['head_sha'] == T['diagnostic_sha'] and r['status'] == 'completed'
            and r['conclusion'] == 'success' and r['actor']['login'] == OWNER
            and r['triggering_actor']['login'] == OWNER, 'Historical diagnostic identity differs')
    for key in ('repository', 'head_repository'):
        require(r[key]['id'] == REPO_ID and r[key]['full_name'] == REPO
                and r[key]['fork'] is False, 'Foreign historical diagnostic')
    jobs = jobs_for(T['diagnostic_run'])
    require(len(jobs) == 1 and jobs[0]['name'] == 'http-readonly'
            and jobs[0]['status'] == 'completed' and jobs[0]['conclusion'] == 'success',
            'Historical diagnostic job differs')


def verified_artifacts():
    run_identity(T['candidate_run'], '.github/workflows/pages-candidate.yml', T['published_sha'], 'success')
    jobs = jobs_for(T['candidate_run'])
    require(len(jobs) == 4 and {j['name'] for j in jobs} == {'gate', 'build', 'package', 'preview'}
            and all(j['status'] == 'completed' and j['conclusion'] == 'success' for j in jobs),
            'Candidate not fully successful')
    origin = package.origin()
    require(package.sha(origin.encode()) == T['origin_sha256'], 'Approved origin hash differs')
    m = package.metadata(T['receipt_artifact'], T['candidate_run'],
                         f"pages-candidate-receipt-{T['candidate_run']}-1")
    z = package.zip_members(download_zip(T['receipt_artifact']), ('receipt.json',),
                            m['digest'], T['receipt_zip_digest'])
    raw = z['receipt.json']
    require(package.sha(raw) == T['receipt_sha256'], 'Receipt exact bytes changed')
    receipt = strict_json(raw)
    for k in ('candidate_run', 'candidate_attempt', 'artifact_id', 'artifact_digest', 'manifest_sha256', 'origin_sha256'):
        require(receipt[k] == T[k], 'Receipt binding mismatch')
    require(receipt['candidate_sha'] == T['published_sha'], 'Receipt source differs')
    quality(receipt['quality_run'], T['published_sha'])
    os.environ.update({'CANDIDATE_SHA': T['published_sha'], 'CANDIDATE_RUN': str(T['candidate_run']),
                       'QUALITY_RUN': str(receipt['quality_run']), 'QUALITY_ATTEMPT': '1'})
    # Reuse exact original static ZIP/TAR/file/context validation. No extraction
    # destination, no execution. Override only the transport with stricter GETs.
    artifact.download_zip = download_zip
    manifest, _ = package.verify(T['artifact_id'], T['candidate_run'], T['artifact_digest'], T['manifest_sha256'])
    return manifest


def live_configuration():
    require(read_switch() == 'true', 'Preview switch differs; do not change it')
    v = gh('/actions/variables/VITE_SYNC_API_URL', os.environ['PAGES_VARIABLES_READ_TOKEN'])
    require(v['name'] == 'VITE_SYNC_API_URL' and v['value'] == package.origin(), 'Live build endpoint differs')


def deployment(d):
    require(d['id'] == T['cf_id'] and d['environment'] == 'production'
            and d['url'] == f"https://{T['cf_id'][:8]}.loveca-card-list.pages.dev"
            and d.get('uses_functions') is False
            and d['deployment_trigger']['metadata']['branch'] == 'main'
            and d['deployment_trigger']['metadata']['commit_hash'] == T['published_sha']
            and d['latest_stage']['name'] == 'deploy' and d['latest_stage']['status'] == 'success',
            'Current Production metadata differs')


def project_snapshot():
    p = cf()
    require(p['name'] == PROJECT and p['production_branch'] == 'main'
            and p['source']['type'] == 'github', 'Project identity differs')
    c = p['source']['config']
    require(c['owner'] == OWNER and c['repo_name'] == PROJECT and c['production_branch'] == 'main'
            and c['production_deployments_enabled'] is False and c['preview_deployment_setting'] == 'none',
            'Git auto-deployment is not stopped')
    endpoint = p['deployment_configs']['production']['env_vars']['VITE_SYNC_API_URL']
    require(endpoint['type'] == 'plain_text' and endpoint['value'] == package.origin()
            and package.sha(endpoint['value'].encode()) == T['origin_sha256'], 'Production endpoint differs')
    deployment(p['canonical_deployment'])
    deployment(cf('/deployments/' + T['cf_id']))
    # Safe snapshot: no raw API body/endpoint/account/credential goes into outputs.
    return {'cf_id': T['cf_id'], 'published_sha': T['published_sha'],
            'git_production_auto': False, 'git_preview_auto': 'none',
            'origin_sha256': T['origin_sha256'], 'functions': False}


def competitors(with_cf=False):
    own = int(os.environ['GITHUB_RUN_ID'])
    for state in ACTIVE:
        runs = ledger.complete_list(f'/actions/runs?status={state}', 'workflow_runs')
        require(not any(r['id'] != own and r['name'] in NAMES for r in runs), 'Competing Actions run')
    if with_cf:
        seen = set()
        for page in range(1, 41):
            rows = cf(f'/deployments?per_page=25&page={page}')
            require(isinstance(rows, list) and len(rows) <= 25, 'Malformed CF listing')
            for d in rows:
                require(d['id'] not in seen, 'Duplicate CF listing')
                seen.add(d['id'])
                stage = d['latest_stage']
                terminal = (stage['status'] in ('success', 'failure', 'canceled')
                            and d['is_skipped'] is False and d.get('skip_reason') is None)
                skipped = (stage['status'] == 'skipped' and d['is_skipped'] is True
                           and d.get('skip_reason') == 'superseded_queued_build')
                require(terminal or skipped, 'Competing Cloudflare deployment')
            if len(rows) < 25:
                return
        raise RuntimeError('Cloudflare listing incomplete')


def output(key, value):
    text = json.dumps(value, sort_keys=True, separators=(',', ':')) if isinstance(value, dict) else str(value)
    require('\n' not in text and '\r' not in text and len(text) <= 12000, 'Unsafe output')
    with open(os.environ['GITHUB_OUTPUT'], 'a') as f:
        f.write(key + '=' + text + '\n')


def summary(mode, value):
    # Only caller-created safe fixed-key values. No exception/API/body values.
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as f:
        f.write('\n## Reconciliation ' + mode + '\n```json\n' + json.dumps(value, sort_keys=True, indent=2) + '\n```\n')


def review():
    run, sha, binding = identity()
    unresolved()
    current_quality(sha)
    verified_artifacts()
    diagnostic_evidence()
    competitors()
    summary('review — not an approval', {'target': T, 'control_sha': sha, 'run': run,
            'approval_sha256': inputs()['recovery_evidence_sha256'], 'binding': binding,
            'scope': 'One new reconciliation record/status; no publish; original failure retained'})


def approval():
    run, sha, binding = identity()
    ledger.owner_approval(run, require_job=False)
    completed_jobs(run, {'review'})
    unresolved()
    output('binding', binding)
    summary('approval', {'run': run, 'control_sha': sha, 'binding': binding})


def verify_current():
    run, sha, binding = identity()
    authorized(run, binding, {'review', 'approval'})
    unresolved()
    current_quality(sha)
    live_configuration()
    manifest = verified_artifacts()
    competitors(with_cf=True)
    before = project_snapshot()
    # These are new execution-time checks after approval, not W5.8 re-labelled.
    # Exactly the existing full-file/strict-header logic; at most 10 public GETs.
    reconcile_http.http_verify('https://loveca-card-list.pages.dev', manifest)
    reconcile_http.http_verify(f"https://{T['cf_id'][:8]}.loveca-card-list.pages.dev", manifest)
    competitors(with_cf=True)
    require(before == project_snapshot(), 'Cloudflare changed during verification')
    unresolved()
    payload = {'schema': ledger.RECOVERY_TASK, 'target': T, 'recovery_run': run,
               'recovery_attempt': 1, 'control_sha': sha,
               'approval_sha256': inputs()['recovery_evidence_sha256'],
               'approval_binding': binding, 'verified_at': int(time.time()),
               'snapshot_sha256': ledger.digest_json(before)}
    output('capsule', payload)
    output('capsule_sha256', ledger.digest_json(payload))
    summary('current verification', payload)


def capsule(run, sha, binding):
    p = strict_json(os.environ['VERIFIED_CAPSULE'].encode())
    require(set(p) == {'schema', 'target', 'recovery_run', 'recovery_attempt', 'control_sha',
                      'approval_sha256', 'approval_binding', 'verified_at', 'snapshot_sha256'}
            and p['schema'] == ledger.RECOVERY_TASK and ledger.digest_json(p['target']) == ledger.digest_json(T)
            and p['recovery_run'] == run and type(p['recovery_attempt']) is int
            and p['recovery_attempt'] == 1 and p['control_sha'] == sha
            and p['approval_sha256'] == inputs()['recovery_evidence_sha256']
            and p['approval_binding'] == binding and ledger.digest_json(p) == os.environ['CAPSULE_SHA256'],
            'Same-run verification capsule mismatch')
    require(type(p['verified_at']) is int and 0 <= time.time() - p['verified_at'] <= MAX_AGE,
            'Verification evidence expired; no retry')
    expected = {'cf_id': T['cf_id'], 'published_sha': T['published_sha'],
                'git_production_auto': False, 'git_preview_auto': 'none',
                'origin_sha256': T['origin_sha256'], 'functions': False}
    require(p['snapshot_sha256'] == ledger.digest_json(expected), 'Wrong verified state')
    return p


class Recorder:
    """Only two exact POST targets. Count BEFORE request; unknown means consumed."""
    def __init__(self):
        self.created = False
        self.status_sent = False
        self.record_id = None

    def _post(self, path, body):
        require(os.environ['GITHUB_JOB'] == 'record'
                and not os.environ.get('CLOUDFLARE_API_TOKEN')
                and not os.environ.get('CLOUDFLARE_ACCOUNT_ID')
                and not os.environ.get('PAGES_VARIABLES_READ_TOKEN'), 'Writer credential/job separation failed')
        require((path == '/deployments' and self.created and self.record_id is None
                 and not self.status_sent)
                or (self.record_id is not None and self.status_sent
                    and path == f'/deployments/{self.record_id}/statuses'),
                'Mutation path outside two-write protocol')
        token = os.environ['GH_TOKEN']
        require(re.fullmatch(r'[A-Za-z0-9._~+/-]+=*', token) is not None, 'Invalid record credential')
        req = urllib.request.Request('https://api.github.com/repos/' + REPO + path,
            data=package.canonical_json(body), method='POST', headers={
                'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
                'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10'})
        try:
            with urllib.request.build_opener(artifact.NoRedirect).open(req, timeout=30) as r:
                require(r.status == 201, 'Write status unknown')
                data = r.read(1024 * 1024 + 1)
                require(len(data) <= 1024 * 1024, 'Write response too large')
                return strict_json(data)
        except Exception:
            raise RuntimeError('Recovery write failed/unknown; never resend') from None

    def create(self, payload):
        require(not self.created, 'Create already attempted')
        self.created = True
        result = self._post('/deployments', {
            'ref': T['published_sha'], 'auto_merge': False, 'required_contexts': [],
            'environment': ledger.ENVIRONMENT, 'task': ledger.RECOVERY_TASK,
            'production_environment': True, 'transient_environment': False,
            'description': 'Approved reconciliation; no Production publish', 'payload': payload})
        require(type(result['id']) is int and result['id'] > T['original_intent']
                and result['sha'] == T['published_sha'] and result['task'] == ledger.RECOVERY_TASK
                and result['payload'] == payload, 'Created record mismatch/unknown; STOP')
        self.record_id = result['id']
        return self.record_id

    def success(self, payload):
        require(self.created and self.record_id is not None and not self.status_sent, 'Status not permitted')
        self.status_sent = True
        result = self._post(f'/deployments/{self.record_id}/statuses', {
            'state': 'success', 'auto_inactive': False, 'environment': ledger.ENVIRONMENT,
            'environment_url': f"https://{T['cf_id'][:8]}.loveca-card-list.pages.dev",
            'log_url': f"https://github.com/{REPO}/actions/runs/{payload['recovery_run']}",
            'description': 'reconcile:' + ledger.digest_json(payload)})
        require(type(result.get('id')) is int and result['id'] > 0
                and result.get('state') == 'success'
                and result.get('creator', {}).get('login') == 'github-actions[bot]'
                and result.get('description') == 'reconcile:' + ledger.digest_json(payload),
                'Status response unknown; STOP without resending')
        return result


def record():
    run, sha, binding = identity()
    authorized(run, binding, {'review', 'approval', 'verify-current'})
    p = capsule(run, sha, binding)
    competitors()
    unresolved()
    # Recheck freshness after API reads, immediately before the one write.
    capsule(run, sha, binding)
    require(gh('/branches/main')['commit']['sha'] == sha, 'main moved before record')
    writer = Recorder()
    rid = writer.create(p)
    rows = ledger.entries()
    require(rows[0]['id'] == rid and rows[0]['payload'] == p, 'Ledger changed after creation')
    ledger.original_intent(rows)
    require(not ledger.complete_list(f'/deployments/{rid}/statuses'), 'Unexpected status before write')
    # No Cloudflare credential exists here: <=120s verified snapshot, plus a
    # separate CF audit after this job. Cross-service atomicity is impossible.
    capsule(run, sha, binding)
    require(gh('/branches/main')['commit']['sha'] == sha, 'main moved before status')
    writer.success(p)
    ledger.validate_recovery(gh(f'/deployments/{rid}'), ledger.entries(), completed=False)
    output('record_id', rid)
    summary('record — acceptance awaits successful whole run', {'record_id': rid,
                                                             'payload_sha256': ledger.digest_json(p)})


def audit_current():
    run, sha, binding = identity()
    authorized(run, binding, {'review', 'approval', 'verify-current', 'record'})
    # A fresh state audit, not the record job's freshness window. No more writes.
    rid = int(os.environ['RECOVERY_RECORD_ID'])
    rows = ledger.entries()
    require(rows and rows[0]['id'] == rid, 'Ledger moved after record')
    expected = ledger.validate_recovery(rows[0], rows, completed=False)
    p = rows[0]['payload']
    require(p['recovery_run'] == run and p['control_sha'] == sha
            and p['approval_binding'] == binding, 'Wrong current-run recovery')
    live_configuration()
    competitors(with_cf=True)
    snapshot = project_snapshot()
    require(ledger.digest_json(snapshot) == p['snapshot_sha256']
            and expected == {'id': snapshot['cf_id'], 'sha': snapshot['published_sha']},
            'Post-record external change; record remains unaccepted')
    require(ledger.entries() == rows, 'Ledger changed during final audit')
    summary('final audit — consumer also requires run completed/success', {
        'record_id': rid, 'cf_id': T['cf_id'], 'published_sha': T['published_sha'],
        'original_run_result': 'failure', 'old_intent_modified': False})


def main():
    mode = sys.argv[1]
    require(mode in JOBS and os.environ['GITHUB_JOB'] == mode, 'Invalid job/mode')
    {'review': review, 'approval': approval, 'verify-current': verify_current,
     'record': record, 'audit-current': audit_current}[mode]()


def safe_main():
    try:
        main()
        print('Reconciliation stage PASS; original release result unchanged')
        return 0
    except BaseException:
        print('Reconciliation STOP; preserve evidence; no automatic retry', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(safe_main())
