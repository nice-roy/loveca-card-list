"""Trusted control plane. Load only from the workflow's immutable main SHA.

All network operations here are GETs. Wrangler is the only deployment writer.
Missing fields, credentials, ambiguous PRs and API errors fail closed.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = "nice-roy/loveca-card-list"
REPO_ID = 1354007978
OWNER = "nice-roy"
PROJECT = "loveca-card-list"
QUALITY_ID = 356704038
QUALITY_PATH = ".github/workflows/quality.yml"
QUALITY_BLOB = "11757d0fb93999705adb70ebbebac7f6a287039a"
PRODUCTION_ID = "3a6cfdc8-b52e-4c28-96b7-a6f08f566076"
PRODUCTION_SHA = "f0f9f6552312426ba08ae0c8b0d14ea949f4220f"
MAX_JSON_BYTES = 8 * 1024 * 1024


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def request_json(url, token):
    require(isinstance(token, str) and bool(token.strip()), "Required read credential is missing")
    # Reject malformed headers before urllib can include their value in an error.
    require(re.fullmatch(r"[A-Za-z0-9._~+/-]+=*", token) is not None,
            "Read credential has invalid format; STOP")
    req = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/json",
        "User-Agent": "loveca-pages-preview-guard",
        "Cache-Control": "no-cache",
    })
    if url.startswith("https://api.github.com/"):
        req.add_header("X-GitHub-Api-Version", "2026-03-10")
    try:
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        with urllib.request.build_opener(NoRedirect).open(req, timeout=30) as response:
            require(response.status == 200, "Read API did not return HTTP 200")
            require(response.headers.get_content_type() in
                    ("application/json", "application/vnd.github+json"),
                    "Read API did not return JSON content")
            payload = response.read(MAX_JSON_BYTES + 1)
            require(len(payload) <= MAX_JSON_BYTES, "Read API response exceeds limit")
            return strict_json(payload)
    except urllib.error.HTTPError as error:
        # Do not print response bodies, tokens or signed URLs.
        raise RuntimeError(f"Read API rejected request: HTTP {error.code}") from None
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
        raise RuntimeError("Read API connection failed; STOP") from None


def strict_json(payload):
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "Ambiguous JSON: duplicate member")
            result[key] = value
        return result

    def reject_constant(value):
        raise RuntimeError("Non-standard JSON constant rejected")

    try:
        return json.loads(payload.decode("utf-8"), object_pairs_hook=unique_object,
                          parse_constant=reject_constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError):
        raise RuntimeError("Read API JSON decoding failed; STOP") from None


def gh(path, token=None):
    return request_json("https://api.github.com/repos/" + REPO + path,
                        token if token is not None else os.environ.get("GH_TOKEN"))


def exact_true(value):
    require(type(value) is str and value == "true",
            "PAGES_PREVIEW_ENABLED must be exactly the string true")


def read_switch():
    # GITHUB_TOKEN cannot request Variables:read through workflow permissions.
    # No fallback to vars context or to a failed/unauthenticated API call.
    token = os.environ.get("PAGES_VARIABLES_READ_TOKEN", "")
    require(bool(token.strip()), "PAGES_VARIABLES_READ_TOKEN is not provisioned; STOP")
    value = gh("/actions/variables/PAGES_PREVIEW_ENABLED", token)
    require(type(value) is dict, "Variable response is not a single object")
    require(type(value.get("name")) is str and value["name"] == "PAGES_PREVIEW_ENABLED",
            "Variable missing or unexpected")
    require(type(value.get("value")) is str, "Variable value is not a string")
    return value["value"]


def live_switch():
    exact_true(read_switch())


def probe_disabled():
    """A future credential test: GET only, false required, no deploy permit output."""
    require(read_switch() == "false", "Read-only probe requires exactly false; STOP")
    print("Variables read probe PASS: switch is exactly false; no deploy authorized")


def check_run(run, event_run):
    require(run["id"] == event_run["id"], "Run ID mismatch")
    require(run["run_attempt"] == event_run["run_attempt"], "Quality was rerun")
    require(run["workflow_id"] == QUALITY_ID and run["path"] == QUALITY_PATH,
            "Unexpected Quality workflow identity")
    require(run["name"] == "Quality checks", "Unexpected Quality workflow name")
    require(run["event"] == "pull_request", "Only pull_request is eligible")
    require(run["status"] == "completed" and run["conclusion"] == "success",
            "Quality workflow did not succeed")
    for actor in (run["actor"], run["triggering_actor"]):
        require(actor["login"] == OWNER, "Quality actor is not nice-roy")
    for repository in (run["repository"], run["head_repository"]):
        require(repository["id"] == REPO_ID and repository["full_name"] == REPO
                and repository["fork"] is False, "Foreign/fork repository")
    require(re.fullmatch(r"[0-9a-f]{40}", run["head_sha"]) is not None,
            "Invalid tested SHA")
    require(run["head_sha"] == event_run["head_sha"], "Event SHA mismatch")
    require(len(run["pull_requests"]) == 1, "Expected exactly one associated PR")


def check_pr(pr, run):
    require(pr["state"] == "open" and pr["draft"] is False, "PR closed or draft")
    require(pr["user"]["login"] == OWNER, "PR author is not nice-roy")
    for side in ("base", "head"):
        repo = pr[side]["repo"]
        require(repo["id"] == REPO_ID and repo["full_name"] == REPO
                and repo["fork"] is False, "Foreign/fork PR")
    require(pr["base"]["ref"] == "main", "PR base is not main")
    branch = pr["head"]["ref"]
    require(branch.lower() != "main", "main cannot be a Preview source")
    require(isinstance(branch, str) and len(branch) <= 200, "Invalid source branch")
    require(pr["head"]["sha"] == run["head_sha"], "Stale PR head SHA")
    associated = run["pull_requests"][0]
    require(pr["number"] == associated["number"], "PR association mismatch")
    require(associated["head"]["sha"] == run["head_sha"], "Tested head association mismatch")
    require(branch == run["head_branch"], "Source branch mismatch")


def check_jobs(jobs):
    quality = [j for j in jobs if j["name"] == "quality"]
    require(len(quality) == 1 and quality[0]["status"] == "completed"
            and quality[0]["conclusion"] == "success", "quality job did not succeed")


def check_files(files, expected_count):
    require(len(files) == expected_count, "Incomplete PR file listing")
    require(not any(QUALITY_PATH in (f["filename"], f.get("previous_filename"))
                    for f in files), "PR changes quality.yml")


def gate():
    require(os.environ["GITHUB_EVENT_NAME"] == "workflow_run", "Wrong event")
    require(os.environ["GITHUB_REPOSITORY"] == REPO, "Wrong repository")
    require(os.environ["GITHUB_REF"] == "refs/heads/main", "Workflow ref is not main")
    require(os.environ["GITHUB_ACTOR"] == OWNER
            and os.environ["GITHUB_TRIGGERING_ACTOR"] == OWNER, "Preview actor is not owner")
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    require(event["action"] == "completed", "Wrong workflow_run activity")
    require(event["repository"]["default_branch"] == "main", "Default branch changed")
    e = event["workflow_run"]
    require(isinstance(e["id"], int), "Invalid run ID")
    run = gh(f"/actions/runs/{e['id']}")
    check_run(run, e)
    attempt = run["run_attempt"]
    jobs = []
    for page in range(1, 11):
        result = gh(f"/actions/runs/{run['id']}/attempts/{attempt}/jobs?per_page=100&page={page}")
        jobs.extend(result["jobs"])
        if len(jobs) == result["total_count"]:
            break
    require(len(jobs) == result["total_count"], "Incomplete job listing")
    check_jobs(jobs)
    number = run["pull_requests"][0]["number"]
    require(isinstance(number, int) and number > 0, "Invalid PR number")
    pr = gh(f"/pulls/{number}")
    check_pr(pr, run)
    require(pr["changed_files"] <= 3000, "PR too large to inspect completely")
    files = []
    for page in range(1, (pr["changed_files"] + 99) // 100 + 1):
        files.extend(gh(f"/pulls/{number}/files?per_page=100&page={page}"))
    check_files(files, pr["changed_files"])
    # Match the reviewed Quality blob at both the head and trusted workflow revision.
    for ref in (run["head_sha"], os.environ["TRUSTED_SHA"]):
        blob = gh(f"/contents/{QUALITY_PATH}?ref={ref}")
        require(blob["sha"] == QUALITY_BLOB, "Quality baseline changed; review required")
    again = gh(f"/pulls/{number}")
    check_pr(again, run)
    require(again["base"]["sha"] == pr["base"]["sha"], "Base moved during inspection")
    return {"pr": number, "sha": run["head_sha"], "source_branch": pr["head"]["ref"],
            "branch": f"pr-{number}", "base_sha": pr["base"]["sha"],
            "quality_run": run["id"], "quality_attempt": attempt}


def cf(path=""):
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
    require(re.fullmatch(r"[0-9a-f]{32}", account) is not None, "Invalid account ID")
    data = request_json(f"https://api.cloudflare.com/client/v4/accounts/{account}/pages/projects/{PROJECT}{path}",
                        os.environ.get("CLOUDFLARE_API_TOKEN"))
    require(data.get("success") is True, "Cloudflare API reported failure")
    return data["result"]


def check_project(project, branch):
    require(project["name"] == PROJECT, "Unexpected Pages project")
    require(project["production_branch"] == "main", "Production branch changed")
    require(re.fullmatch(r"pr-[1-9][0-9]*", branch) is not None, "Unsafe Preview branch")
    require(branch != project["production_branch"], "Production branch forbidden")
    require(project["source"]["type"] == "github", "Unexpected Pages source")
    cfg = project["source"]["config"]
    require(cfg["owner"] == OWNER and cfg["repo_name"] == PROJECT, "Pages repository mismatch")
    require(cfg["production_branch"] == "main", "Source production branch changed")
    require(cfg["production_deployments_enabled"] is False, "Git production auto-deploy ON")
    require(cfg["preview_deployment_setting"] == "none", "Git preview auto-deploy ON")
    canonical = project["canonical_deployment"]
    require(canonical["environment"] == "production", "Canonical is not production")
    from ledger import expected_canonical
    expected = expected_canonical()
    require(canonical["latest_stage"]["status"] == "success", "Canonical not successful")
    require(canonical["id"] == expected["id"], "Production canonical baseline changed")
    require(canonical["deployment_trigger"]["metadata"]["commit_hash"] == expected["sha"],
            "Production source baseline changed")
    return canonical["id"]


def compare_canonical(before, after):
    require(before == after, "ALERT: Production canonical changed; NO automatic rollback")


def check_deployment(deployment, state, outputs):
    require(deployment["id"] == outputs["id"], "Deployment ID mismatch")
    require(deployment["environment"] == outputs["environment"] == "preview",
            "Deployment is not preview")
    meta = deployment["deployment_trigger"]["metadata"]
    require(meta["branch"] == state["branch"], "Deployment branch mismatch")
    require(meta["commit_hash"] == state["sha"], "Deployment source SHA mismatch")
    require(deployment["url"] == outputs["url"], "Deployment URL mismatch")
    require(re.fullmatch(r"https://[a-z0-9-]+\.loveca-card-list\.pages\.dev", deployment["url"])
            is not None, "Unexpected deployment URL")
    require(deployment.get("uses_functions") is False, "Unexpected Pages Functions")
    if outputs["alias"]:
        require(outputs["alias"] in deployment.get("aliases", []), "Alias mismatch")
    require(deployment["latest_stage"]["name"] == "deploy"
            and deployment["latest_stage"]["status"] == "success", "Deployment not successful")


def preflight():
    # Stop before using Cloudflare credentials if the live switch is already off.
    live_switch()
    state = gate()  # Repeat author, actor, event, job, files and CURRENT head checks.
    require(state["sha"] == os.environ["EXPECTED_SHA"]
            and str(state["pr"]) == os.environ["EXPECTED_PR"]
            and state["base_sha"] == os.environ["EXPECTED_BASE_SHA"], "PR changed since build gate")
    project = cf()
    state["canonical"] = check_project(project, state["branch"])
    # Last remote read before the action invokes Wrangler.
    live_switch()
    Path(os.environ["RUNNER_TEMP"], "pages-before.json").write_text(json.dumps(state))


def postflight():
    before_path = Path(os.environ["RUNNER_TEMP"], "pages-before.json")
    if not before_path.exists():
        print("No successful preflight; no deployment was authorized")
        return
    state = json.loads(before_path.read_text())
    # This read is first even if the action failed or returned no deployment ID.
    project = cf()
    compare_canonical(state["canonical"], project["canonical_deployment"]["id"])
    check_project(project, state["branch"])
    outputs = {key: os.environ.get("DEPLOY_" + key.upper(), "")
               for key in ("id", "environment", "url", "alias")}
    require(re.fullmatch(r"[0-9a-f-]{36}", outputs["id"]) is not None,
            "No valid deployment ID; outcome UNKNOWN, inspect Cloudflare manually")
    deployment = None
    for attempt in range(6):
        deployment = cf("/deployments/" + outputs["id"])
        stage = deployment.get("latest_stage", {})
        if stage.get("status") == "failure" or (stage.get("name") == "deploy"
                                                 and stage.get("status") == "success"):
            break
        time.sleep(5)
    compare_canonical(state["canonical"], cf()["canonical_deployment"]["id"])
    check_deployment(deployment, state, outputs)
    summary = {**state, **outputs, "environment": "preview"}
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as out:
        out.write("\nVerified Pages Preview\n```json\n" + json.dumps(summary, indent=2) + "\n```\n")


def main():
    mode = sys.argv[1]
    if mode == "gate":
        exact_true(os.environ.get("PREVIEW_ENABLED"))
        state = gate()
        with open(os.environ["GITHUB_OUTPUT"], "a") as out:
            for key in ("sha", "pr", "branch", "base_sha"):
                out.write(f"{key}={state[key]}\n")
    elif mode == "switch":
        live_switch()
        with open(os.environ["GITHUB_OUTPUT"], "a") as out:
            out.write("enabled=true\n")
    elif mode == "probe-disabled":
        probe_disabled()
    elif mode == "preflight":
        preflight()
    elif mode == "postflight":
        postflight()
    else:
        raise RuntimeError("Unknown guard mode")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # No raw HTTP body, environment dump or arbitrary PR strings.
        print("Preview guard STOP:", str(error), file=sys.stderr)
        sys.exit(1)
