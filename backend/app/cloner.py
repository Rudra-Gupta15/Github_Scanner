"""
cloner.py — handles fetching a tester-supplied repo URL onto local disk.

Design notes:
- Shallow clone (--depth 1) by default: we only need the current state of the
  code to look for bugs, not full history. Keeps clone time low for a demo.
- Each job gets its own UUID-named folder under WORKDIR so concurrent
  testers don't collide and cleanup is trivial.
- We validate the URL loosely before shelling out to git, to avoid passing
  arbitrary strings to a subprocess.
"""

import re
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

WORKDIR = (Path(tempfile.gettempdir()) / "reposcan_jobs").resolve()
WORKDIR.mkdir(parents=True, exist_ok=True)

# Accept https GitHub/GitLab/Bitbucket URLs, with or without trailing .git
REPO_URL_RE = re.compile(
    r"^https://(github\.com|gitlab\.com|bitbucket\.org)/[\w.-]+/[\w.-]+(\.git)?/?$"
)


class CloneError(Exception):
    pass


def validate_repo_url(url: str) -> str:
    url = url.strip()
    if not REPO_URL_RE.match(url):
        raise CloneError(
            "That doesn't look like a public GitHub, GitLab, or Bitbucket repo URL. "
            "Expected something like https://github.com/owner/repo"
        )
    return url


def new_job_id() -> str:
    return uuid.uuid4().hex[:12]


def job_path(job_id: str) -> Path:
    return WORKDIR / job_id


def clone_repo(url: str, job_id: str) -> Path:
    """Shallow-clone `url` into a fresh folder for this job. Returns the path."""
    url = validate_repo_url(url)
    dest = job_path(job_id)
    if dest.exists():
        shutil.rmtree(dest)

    try:
        result = subprocess.run(
            ["git", "clone", "--depth", "1", "--single-branch", url, str(dest)],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except subprocess.TimeoutExpired:
        shutil.rmtree(dest, ignore_errors=True)
        raise CloneError("Clone timed out after 120s. Repo may be too large or unreachable.")

    if result.returncode != 0:
        shutil.rmtree(dest, ignore_errors=True)
        stderr = result.stderr.strip()
        if "not found" in stderr.lower() or "repository not found" in stderr.lower():
            raise CloneError("Repo not found. Check the URL and that it's public.")
        raise CloneError(f"git clone failed: {stderr[:300]}")

    return dest.resolve()


def cleanup_job(job_id: str) -> None:
    dest = job_path(job_id)
    shutil.rmtree(dest, ignore_errors=True)
