"""One fixed failed candidate, observed with GETs only; never a publish permit.

No source checkout/import, subprocess, dependency install, artifact upload or
release entrypoint. All remote text is either validated or replaced by a fixed
sentinel before logging. Checks observe CURRENT state, not historical proof.
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
import urllib.error
import urllib.parse
import urllib.request
import zipfile

REPO = 'nice-roy/loveca-card-list'
REPO_ID = 1354007978
OWNER = 'nice-roy'
PROJECT = 'loveca-card-list'
SOURCE = '997659ab4c955f71f12a46a1db2001974505fff1'
FAILED_RUN = 37238592298
QUALITY_RUN = 37234880480
ARTIFACT = 11316418559
DIGEST = '192efbd1125831147a7b0425463b84c2d309e167ce0260bb2333c6260c68b8e6'
MANIFEST = 'b64caf1cc1de81c168251f9e674cebc4fd8eb47ea74a14b27e87026388f50da0'
BASELINE = {'id': '3a6cfdc8-b52e-4c28-96b7-a6f08f566076',
            'sha': 'f0f9f6552312426ba08ae0c8b0d14ea949f4220f'}
WORKFLOW = '.github/workflows/pages-candidate-readonly-diagnostic.yml'
ACTIVE = ('queued', 'in_progress', 'waiting', 'pending', 'requested')
WORKFLOWS = {'Quality checks', 'Pages Preview', 'Pages Candidate', 'Pages Production'}
TERMINAL = ('success', 'failure', 'canceled')  # Exact existing condition, NOT widened.
STATUSES = (*TERMINAL, 'idle', 'active', 'skipped')
STAGES = ('queued', 'initialize', 'clone_repo', 'build', 'deploy')
REASONS = ('commit_message', 'preview_deployments_disabled', 'production_deployments_disabled',
           'path_config', 'branch_config', 'pages_to_workers_conversion', 'superseded_queued_build')
UUID = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
MAX_BYTES = 100 * 1024 * 1024
BANNED = {'_worker.js', 'functions', 'wrangler.toml', 'wrangler.json', 'wrangler.jsonc',
          'node_modules', '_redirects', '_routes.json', 'package.json', 'package-lock.json'}
EXTENSIONS = {'.html', '.css', '.js', '.mjs', '.json', '.svg', '.png', '.jpg', '.jpeg',
              '.gif', '.webp', '.avif', '.ico', '.txt', '.woff', '.woff2', '.ttf', '.otf'}


class Stop(Exception):
    pass


def need(condition, code):
    if not condition:
        raise Stop(code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(data):
    return (json.dumps(data, sort_keys=True, separators=(',', ':'), ensure_ascii=True) + '\n').encode()


def strict(data):
    def pairs(items):
        result = {}
        for k, v in items:
            need(k not in result, 'DUPLICATE_JSON_KEY')
            result[k] = v
        return result
    def constant(_):
        raise Stop('NONSTANDARD_JSON')
    return json.loads(data.decode('utf-8'), object_pairs_hook=pairs, parse_constant=constant)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def get(url, token, label, limit=8 * 1024 * 1024, redirect=False, binary=False):
    """The only network transport. Signed artifact GET never receives credentials."""
    p = urllib.parse.urlsplit(url)
    need(p.scheme == 'https' and not p.username and not p.password and p.port in (None, 443),
         label + '_BAD_URL')
    headers = {'Accept': 'application/json', 'User-Agent': 'loveca-readonly-diagnostic',
               'Cache-Control': 'no-cache'}
    if token is not None:
        need(p.hostname in ('api.github.com', 'api.cloudflare.com'), label + '_BAD_HOST')
        need(isinstance(token, str) and re.fullmatch(r'[A-Za-z0-9._~+/-]+=*', token),
             label + '_CREDENTIAL_INVALID')
        headers['Authorization'] = 'Bearer ' + token
        if p.hostname == 'api.github.com':
            headers['X-GitHub-Api-Version'] = '2026-03-10'
    else:
        need(bool(p.hostname) and p.hostname.endswith(('.blob.core.windows.net', '.actions.githubusercontent.com')),
             label + '_STORAGE_HOST_REJECTED')
    req = urllib.request.Request(url, method='GET', headers=headers)
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=30) as response:
            need(response.status == 200, label + '_STATUS')
            if not binary:
                need(response.headers.get_content_type() in ('application/json', 'application/vnd.github+json'),
                     label + '_CONTENT_TYPE')
            data = response.read(limit + 1)
            need(len(data) <= limit, label + '_SIZE_LIMIT')
            return data
    except urllib.error.HTTPError as e:
        if redirect and e.code == 302:
            return e.headers.get('Location', '')
        raise Stop(label + '_HTTP_' + str(int(e.code))) from None
    except (TimeoutError,):
        raise Stop(label + '_TIMEOUT') from None
    except urllib.error.URLError as e:
        raise Stop(label + ('_TIMEOUT' if isinstance(e.reason, TimeoutError) else '_CONNECTION')) from None
    except OSError:
        raise Stop(label + '_CONNECTION') from None


def gh(path, label='GITHUB_READ', token=None):
    return strict(get('https://api.github.com/repos/' + REPO + path,
                      os.environ.get('GH_TOKEN', '') if token is None else token, label))


def cf(path='', label='CF_PROJECT'):
    account = os.environ.get('CLOUDFLARE_ACCOUNT_ID', '')
    need(re.fullmatch(r'[0-9a-f]{32}', account), label + '_ACCOUNT_INVALID')
    data = strict(get('https://api.cloudflare.com/client/v4/accounts/' + account +
                      '/pages/projects/' + PROJECT + path,
                      os.environ.get('CLOUDFLARE_API_TOKEN', ''), label))
    need(data.get('success') is True, label + '_API_FAILURE')
    return data['result']


def enum(value, allowed):
    return value if type(value) is str and value in allowed else 'UNKNOWN'


def pattern(value, regex):
    return value if type(value) is str and re.fullmatch(regex, value) else 'UNKNOWN'


def deployment(d):
    stage = d.get('latest_stage') or {}
    return {'id': pattern(d.get('id'), UUID),
            'created_on': pattern(d.get('created_on'), r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z'),
            'environment': enum(d.get('environment'), ('preview', 'production')),
            'stage': enum(stage.get('name'), STAGES),
            'status': enum(stage.get('status'), STATUSES),
            'is_skipped': d.get('is_skipped') if type(d.get('is_skipped')) is bool else 'UNKNOWN',
            'skip_reason': 'NONE' if d.get('skip_reason') is None else enum(d.get('skip_reason'), REASONS)}


class Diagnostic:
    def __init__(self):
        self.rows = []
        self.manifest = self.files = self.origin = self.project = None
        self.first_reject = None
        self.scan_complete = False
        self.github_clear = False

    def emit(self, check, result, reason, details=None):
        # Only fixed check/reason strings and schema-filtered details may reach here.
        need(re.fullmatch(r'[A-Z0-9_]+', check + reason), 'UNSAFE_REPORT_CODE')
        need(result in ('PASS', 'FAIL', 'OBSERVED_REJECT', 'UNKNOWN'), 'UNSAFE_RESULT')
        row = {'check': check, 'result': result, 'reason': reason}
        if details is not None:
            row['details'] = details
        self.rows.append(row)
        print(json.dumps(row, sort_keys=True))

    def check(self, name, function):
        try:
            detail = function()
            self.emit(name, 'PASS', 'OK', detail)
        except Stop as e:
            code = e.args[0] if e.args else ''
            code = code if type(code) is str and re.fullmatch(r'[A-Z0-9_]{1,100}', code) else 'REDACTED_ERROR'
            self.emit(name, 'FAIL', code)
        except Exception:
            self.emit(name, 'UNKNOWN', 'SCHEMA_OR_LOCAL_ERROR')

    def entry(self):
        e = os.environ
        i = strict(Path(e['GITHUB_EVENT_PATH']).read_bytes())['inputs']
        need(e['GITHUB_REPOSITORY'] == REPO and e['GITHUB_REF'] == 'refs/heads/main'
             and e['GITHUB_EVENT_NAME'] == 'workflow_dispatch' and e['GITHUB_RUN_ATTEMPT'] == '1'
             and e['GITHUB_ACTOR'] == OWNER and e['GITHUB_TRIGGERING_ACTOR'] == OWNER
             and e['GITHUB_WORKFLOW_REF'] == f'{REPO}/{WORKFLOW}@refs/heads/main'
             and re.fullmatch(r'[0-9a-f]{40}', e['GITHUB_SHA'])
             and e['TRUSTED_SHA'] == e['GITHUB_SHA'], 'DIAGNOSTIC_ENTRY')
        need(i == {'confirm': 'GET-ONLY', 'failed_candidate_run': str(FAILED_RUN)}, 'DIAGNOSTIC_INPUT')
        repo = gh('')
        need(repo['id'] == REPO_ID and repo['default_branch'] == 'main', 'REPOSITORY_IDENTITY')
        need(gh('/branches/main')['commit']['sha'] == e['TRUSTED_SHA'], 'DIAGNOSTIC_MAIN_MOVED')

    def failed_run(self):
        r = gh(f'/actions/runs/{FAILED_RUN}')
        need(r['id'] == FAILED_RUN and r['path'] == '.github/workflows/pages-candidate.yml'
             and r['event'] == 'workflow_dispatch' and r['head_branch'] == 'main'
             and r['head_sha'] == SOURCE and r['run_attempt'] == 1
             and r['status'] == 'completed' and r['conclusion'] == 'failure'
             and r['actor']['login'] == OWNER and r['triggering_actor']['login'] == OWNER,
             'FAILED_RUN_IDENTITY')
        for key in ('repository', 'head_repository'):
            need(r[key]['id'] == REPO_ID and r[key]['full_name'] == REPO and r[key]['fork'] is False,
                 'FAILED_RUN_REPOSITORY')
        j = gh(f'/actions/runs/{FAILED_RUN}/attempts/1/jobs?per_page=100')
        need(j['total_count'] == len(j['jobs']) == 4, 'FAILED_RUN_JOBS')
        need({x['name']: x['conclusion'] for x in j['jobs']} ==
             {'gate': 'success', 'build': 'success', 'package': 'success', 'preview': 'failure'}, 'FAILED_RUN_RESULTS')
        preview = next(x for x in j['jobs'] if x['name'] == 'preview')
        steps = {x['name']: x['conclusion'] for x in preview['steps']}
        need(steps['Read all gates; Production also records one-use intent'] == 'failure'
             and steps['One Wrangler publish; never rerun'] == 'skipped'
             and steps['Verify served bytes, CSP, metadata and canonical'] == 'skipped', 'FAILED_RUN_STEPS')
        q = gh(f'/actions/runs/{QUALITY_RUN}')
        need(q['workflow_id'] == 356704038 and q['path'] == '.github/workflows/quality.yml'
             and q['name'] == 'Quality checks' and q['event'] == 'push' and q['head_branch'] == 'main'
             and q['head_sha'] == SOURCE and q['run_attempt'] == 1
             and q['status'] == 'completed' and q['conclusion'] == 'success'
             and q['actor']['login'] == OWNER and q['triggering_actor']['login'] == OWNER, 'QUALITY_IDENTITY')
        qj = gh(f'/actions/runs/{QUALITY_RUN}/attempts/1/jobs?per_page=100')
        matches = [x for x in qj['jobs'] if x['name'] == 'quality']
        need(qj['total_count'] == len(qj['jobs']) and len(matches) == 1
             and matches[0]['status'] == 'completed' and matches[0]['conclusion'] == 'success', 'QUALITY_JOB')
        return {'run': FAILED_RUN, 'attempt': 1, 'source': SOURCE, 'quality_run': QUALITY_RUN}

    def artifact(self):
        m = gh(f'/actions/artifacts/{ARTIFACT}', 'ARTIFACT_METADATA')
        need(m['id'] == ARTIFACT and m['name'] == f'pages-release-{FAILED_RUN}-1'
             and m['expired'] is False and 0 < m['size_in_bytes'] <= MAX_BYTES
             and m['workflow_run']['id'] == FAILED_RUN and m['workflow_run']['head_sha'] == SOURCE
             and m['digest'] == 'sha256:' + DIGEST, 'ARTIFACT_METADATA_MISMATCH')
        signed = get(f'https://api.github.com/repos/{REPO}/actions/artifacts/{ARTIFACT}/zip',
                     os.environ.get('GH_TOKEN', ''), 'ARTIFACT_REDIRECT', redirect=True)
        need(type(signed) is str, 'ARTIFACT_REDIRECT_EXPECTED')
        data = get(signed, None, 'ARTIFACT_DOWNLOAD', limit=MAX_BYTES, binary=True)
        need(sha(data) == DIGEST, 'ARTIFACT_DIGEST')
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            entries = z.infolist()
            need(len(entries) == 2 and {x.filename for x in entries} == {'final.tar', 'manifest.json'}, 'ZIP_MEMBERS')
            need(sum(x.file_size for x in entries) <= MAX_BYTES, 'ZIP_SIZE')
            need(all(stat.S_IFMT(x.external_attr >> 16) in (0, stat.S_IFREG) and not x.flag_bits & 1
                     for x in entries), 'ZIP_TYPES')
            manifest_bytes = z.read('manifest.json')
            need(len(manifest_bytes) <= 2 * 1024 * 1024 and sha(manifest_bytes) == MANIFEST, 'MANIFEST_DIGEST')
            manifest = strict(manifest_bytes)
            need(manifest_bytes == canonical(manifest), 'MANIFEST_CANONICAL')
            files, names = [], set()
            with tarfile.open(fileobj=io.BytesIO(z.read('final.tar')), mode='r:') as t:
                total = 0
                for f in t:
                    name = f.name
                    need(len(names) < 10000 and name.lower() not in names and f.isfile()
                         and not f.pax_headers and not f.sparse and not f.mode & 0o111, 'TAR_TYPES')
                    names.add(name.lower())
                    need(all(re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]*', p)
                             and p.lower() not in BANNED for p in name.split('/')), 'TAR_PATH')
                    need(name == '_headers' or Path(name).suffix.lower() in EXTENSIONS, 'TAR_EXTENSION')
                    need(0 <= f.size <= 25 * 1024 * 1024, 'TAR_FILE_SIZE')
                    total += f.size
                    need(total <= MAX_BYTES, 'TAR_TOTAL_SIZE')
                    files.append((name, t.extractfile(f).read()))
            need('index.html' in names and '_headers' in names, 'ARTIFACT_REQUIRED_FILES')
            need(not any(str(p).lower() in names for n, _ in files for p in Path(n).parents), 'TAR_PATH_COLLISION')
        need(manifest['files'] == self.records(files), 'MANIFEST_FILES')
        expected = {'schema': 1, 'candidate_sha': SOURCE, 'candidate_run': FAILED_RUN,
                    'candidate_attempt': 1, 'quality_run': QUALITY_RUN, 'quality_attempt': 1,
                    'node': '22.22.2', 'npm': '10.9.7', 'wrangler': '4.92.0', 'playwright': '1.63.0',
                    'origin_sha256': manifest['origin_sha256'], 'files': self.records(files)}
        need(re.fullmatch(r'[0-9a-f]{64}', manifest['origin_sha256']) and manifest == expected, 'MANIFEST_CONTEXT')
        self.manifest, self.files = manifest, files
        return {'id': ARTIFACT, 'digest': DIGEST, 'manifest_sha256': MANIFEST, 'expired': False}

    @staticmethod
    def records(files):
        return [{'path': n, 'size': len(b), 'sha256': sha(b)} for n, b in sorted(files)]

    def variables(self):
        token = os.environ.get('PAGES_VARIABLES_READ_TOKEN', '')
        switch = gh('/actions/variables/PAGES_PREVIEW_ENABLED', 'GITHUB_VARIABLE', token)
        need(switch['name'] == 'PAGES_PREVIEW_ENABLED' and switch['value'] == 'true', 'PREVIEW_SWITCH_NOT_TRUE')
        v = gh('/actions/variables/VITE_SYNC_API_URL', 'GITHUB_VARIABLE', token)
        need(v['name'] == 'VITE_SYNC_API_URL' and type(v['value']) is str, 'VARIABLE_SCHEMA')
        value = v['value']
        need(re.fullmatch(r'https://loveca-card-list-sync\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.workers\.dev', value),
             'VARIABLE_ORIGIN_FORMAT')
        need(self.manifest is not None, 'ARTIFACT_UNAVAILABLE')
        need(sha(value.encode()) == self.manifest['origin_sha256'], 'VARIABLE_ORIGIN_MISMATCH')
        csp = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
               "img-src 'self' data:; font-src 'self'; connect-src " + value +
               "; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; "
               "form-action 'none'; frame-ancestors 'none'")
        headers = ('/*\n  Content-Security-Policy: ' + csp + '\n  X-Content-Type-Options: nosniff\n').encode()
        need(dict(self.files)['_headers'] == headers and any(value.encode() in b for n, b in self.files
             if n.endswith(('.js', '.mjs'))), 'ARTIFACT_ORIGIN_MISMATCH')
        self.origin = value
        return {'PAGES_PREVIEW_ENABLED_CHECK': 'PASS', 'VITE_SYNC_API_URL_MATCH': 'PASS'}

    def competitors(self):
        own = int(os.environ['GITHUB_RUN_ID'])
        conflicts = set()
        for status in ACTIVE:
            for page in range(1, 11):
                r = gh(f'/actions/runs?status={status}&per_page=100&page={page}', 'GITHUB_COMPETITORS')
                need(r['total_count'] <= 1000, 'GITHUB_COMPETITORS_BOUND')
                for run in r['workflow_runs']:
                    if run['id'] != own and run['name'] in WORKFLOWS:
                        need(type(run['id']) is int and run['id'] > 0, 'GITHUB_RUN_ID')
                        conflicts.add(run['id'])
                if page * 100 >= r['total_count']:
                    break
        if conflicts:
            self.emit('GITHUB_COMPETITOR_IDS', 'OBSERVED_REJECT', 'COMPETING_RUN', sorted(conflicts))
        need(not conflicts, 'GITHUB_COMPETITOR_FOUND')
        self.github_clear = True

    def cf_project(self):
        self.project = cf()
        p, c = self.project, self.project['source']['config']
        detail = {'project_matches': p['name'] == PROJECT, 'production_branch_main': p['production_branch'] == 'main',
                  'source': enum(p['source']['type'], ('github', 'gitlab')), 'owner_repo_matches': c['owner'] == OWNER and c['repo_name'] == PROJECT,
                  'production_deployments_enabled': c.get('production_deployments_enabled') if type(c.get('production_deployments_enabled')) is bool else 'UNKNOWN',
                  'preview_deployment_setting': enum(c.get('preview_deployment_setting'), ('none', 'all', 'custom'))}
        self.emit('CF_PROJECT_OBSERVATION', 'PASS', 'OBSERVED', detail)
        need(p['name'] == PROJECT and p['production_branch'] == 'main' and p['source']['type'] == 'github'
             and c['owner'] == OWNER and c['repo_name'] == PROJECT and c['production_branch'] == 'main'
             and c['production_deployments_enabled'] is False and c['preview_deployment_setting'] == 'none', 'CF_PROJECT_MISMATCH')

    def expected_canonical(self):
        # Read-only equivalent of the existing ledger reader; no write helper imported.
        records = []
        for page in range(1, 11):
            batch = gh(f'/deployments?environment=pages-production&task=loveca-pages-release-v1&per_page=100&page={page}', 'GITHUB_LEDGER')
            need(isinstance(batch, list), 'LEDGER_SCHEMA')
            records.extend(batch)
            if len(batch) < 100:
                break
        else:
            raise Stop('LEDGER_BOUND')
        if not records:
            return BASELINE
        d = max(records, key=lambda x: x['id'])
        need(d['creator']['login'] == 'github-actions[bot]' and d['environment'] == 'pages-production'
             and d['task'] == 'loveca-pages-release-v1' and d['production_environment'] is True, 'LEDGER_PROVENANCE')
        p = strict(d['payload'].encode()) if isinstance(d['payload'], str) else d['payload']
        need(p['schema'] == 1 and type(p['release_run']) is int and p['release_run'] > 0, 'LEDGER_PAYLOAD')
        r = gh(f"/actions/runs/{p['release_run']}", 'GITHUB_LEDGER')
        need(r['path'] == '.github/workflows/pages-production.yml' and r['event'] == 'workflow_dispatch'
             and r['head_branch'] == 'main' and r['run_attempt'] == 1
             and r['status'] == 'completed' and r['conclusion'] == 'success'
             and r['actor']['login'] == OWNER and r['triggering_actor']['login'] == OWNER
             and r['repository']['full_name'] == REPO and r['head_repository']['full_name'] == REPO
             and r['head_sha'] == d['sha'] == p['candidate_sha'], 'LEDGER_RUN')
        statuses = gh(f"/deployments/{int(d['id'])}/statuses?per_page=100", 'GITHUB_LEDGER')
        need(bool(statuses), 'LEDGER_UNRESOLVED')
        s = statuses[0]
        match = re.fullmatch(r'cf:(' + UUID + r');manifest:([0-9a-f]{64})', s['description'])
        need(s['state'] == 'success' and s['creator']['login'] == 'github-actions[bot]'
             and match and match[2] == p['manifest_sha256']
             and s['log_url'] == f"https://github.com/{REPO}/actions/runs/{p['release_run']}"
             and s['environment_url'] == f'https://{match[1][:8]}.loveca-card-list.pages.dev', 'LEDGER_RECEIPT')
        return {'id': match[1], 'sha': p['candidate_sha']}

    def canonical_check(self):
        need(self.project is not None, 'CF_PROJECT_UNAVAILABLE')
        c = self.project['canonical_deployment']
        info = deployment(c)
        info['source_sha'] = pattern(c['deployment_trigger']['metadata']['commit_hash'], r'[0-9a-f]{40}')
        self.emit('CANONICAL_OBSERVATION', 'PASS', 'OBSERVED', info)
        expected = self.expected_canonical()
        need(c['id'] == expected['id'] and info['source_sha'] == expected['sha']
             and c['environment'] == 'production' and c['latest_stage']['name'] == 'deploy'
             and c['latest_stage']['status'] == 'success', 'CANONICAL_MISMATCH')

    def production_origin(self):
        need(self.project is not None and self.origin is not None, 'ORIGIN_DEPENDENCY_UNAVAILABLE')
        v = self.project['deployment_configs']['production']['env_vars']['VITE_SYNC_API_URL']
        need(v['type'] == 'plain_text' and v['value'] == self.origin, 'PRODUCTION_ORIGIN_MISMATCH')

    def deployments(self):
        count = 0
        for page in range(1, 41):
            batch = cf(f'/deployments?per_page=25&page={page}', 'CF_DEPLOYMENTS')
            need(isinstance(batch, list) and len(batch) <= 25, 'CF_DEPLOYMENTS_SCHEMA')
            for d in batch:
                info = deployment(d)
                count += 1
                self.emit('CF_DEPLOYMENT_OBSERVATION', 'PASS', 'OBSERVED', info)
                if self.first_reject is None and (d.get('latest_stage') or {}).get('status') not in TERMINAL:
                    self.first_reject = {k: info[k] for k in ('id', 'created_on', 'status', 'is_skipped', 'skip_reason')}
                    self.emit('CURRENT_LOGIC_FIRST_REJECT', 'OBSERVED_REJECT', 'CF_NONTERMINAL', self.first_reject)
            if len(batch) < 25:
                self.scan_complete = True
                if self.first_reject is None:
                    self.emit('CURRENT_LOGIC_FIRST_REJECT', 'PASS', 'NONE')
                return {'count': count, 'pages': page}
        raise Stop('CF_DEPLOYMENTS_BOUND')

    def local_check(self):
        need(self.manifest is not None and self.files is not None, 'ARTIFACT_UNAVAILABLE')
        # No extraction or execution: rehash in-memory bytes that would be uploaded.
        need(self.records(self.files) == self.manifest['files'], 'LOCAL_BYTES_MISMATCH')

    def run(self):
        self.check('CHECK_ENTRY', self.entry)
        if self.rows[-1]['result'] != 'PASS':
            return 1
        for name, function in (
            ('CHECK_FAILED_RUN', self.failed_run), ('CHECK_ARTIFACT', self.artifact),
            ('CHECK_VARIABLES', self.variables), ('CHECK_GITHUB_COMPETITORS', self.competitors),
            ('CHECK_CF_PROJECT', self.cf_project), ('CHECK_CF_DEPLOYMENTS', self.deployments),
            ('CHECK_CANONICAL', self.canonical_check), ('CHECK_PRODUCTION_ORIGIN', self.production_origin),
            ('CHECK_LOCAL_BYTES', self.local_check)):
            self.check(name, function)
        if not self.github_clear:
            self.emit('SIMULATE_CURRENT_NO_COMPETITORS', 'UNKNOWN', 'GITHUB_CHECK_NOT_PASS')
        elif self.first_reject is not None:
            self.emit('SIMULATE_CURRENT_NO_COMPETITORS', 'OBSERVED_REJECT', 'CF_NONTERMINAL')
        elif self.scan_complete:
            self.emit('SIMULATE_CURRENT_NO_COMPETITORS', 'PASS', 'NO_REJECT')
        else:
            self.emit('SIMULATE_CURRENT_NO_COMPETITORS', 'UNKNOWN', 'CF_SCAN_INCOMPLETE')
        return int(any(r['result'] != 'PASS' for r in self.rows))


def main():
    diagnostic = Diagnostic()
    try:
        result = diagnostic.run()
    except Exception:
        diagnostic.emit('CHECK_DIAGNOSTIC', 'UNKNOWN', 'LOCAL_ERROR')
        result = 1
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as out:
        out.write('## GET-only observations — not historical proof or publish authorization\n```json\n')
        out.write(json.dumps(diagnostic.rows, indent=2, sort_keys=True))
        out.write('\n```\nNo changes, uploads, retries or recovery actions were performed.\n')
    return result


if __name__ == '__main__':
    sys.exit(main())
