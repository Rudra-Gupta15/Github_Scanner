"""
pipeline.py - orchestrates the full repo -> system -> clone -> analyse -> result
flow, and tracks per-job stage state in memory so the frontend can poll/stream
live progress (the "Mission Control" pipeline rail in the UI).

Job lifecycle (stage names match what the UI renders):
  queued -> cloning -> scanning -> analyzing -> triaging -> done
  (or -> failed, with an error message, at any stage)

State lives in a plain in-memory dict. Good enough for a hackathon demo;
swap for Redis/DB if this needs to survive restarts or scale beyond one
process.
"""

import shutil
import threading
import time
import uuid
from pathlib import Path

from . import cloner, ollama_client, repo_walk, static_analysis

JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()

ESLINT_RUNTIME_DIR = Path(__file__).resolve().parent.parent / "eslint_runtime"

STAGES = ["queued", "cloning", "scanning", "analyzing", "triaging", "done"]


def _update(job_id: str, **kwargs):
    with JOBS_LOCK:
        JOBS[job_id].update(kwargs)


def _set_stage(job_id: str, stage: str, detail: str = ""):
    _update(job_id, stage=stage, stage_detail=detail, updated_at=time.time())


def get_job(job_id: str) -> dict | None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        return dict(job) if job else None


def _cleanup_old_jobs():
    """Evict finished/failed jobs and their cloned folders to prevent unbounded disk growth."""
    with JOBS_LOCK:
        old_ids = [
            jid for jid, j in JOBS.items()
            if j["stage"] in ("done", "failed")
        ]
        for jid in old_ids:
            repo_root = JOBS[jid].get("repo_root")
            if repo_root:
                shutil.rmtree(repo_root, ignore_errors=True)
            del JOBS[jid]


def get_job_repo_root(job_id: str) -> Path | None:
    """Return the repo_root Path for a finished job, or None."""
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job or not job.get("repo_root"):
            return None
        root = Path(job["repo_root"])
        return root if root.is_dir() else None


def start_job(repo_url: str, model: str = ollama_client.DEFAULT_SCAN_MODEL, deep_scan_limit: int = 15) -> str:
    _cleanup_old_jobs()
    job_id = cloner.new_job_id()
    with JOBS_LOCK:
        JOBS[job_id] = {
            "id": job_id,
            "repo_url": repo_url,
            "stage": "queued",
            "stage_detail": "Waiting to start...",
            "error": None,
            "result": None,
            "repo_root": None,
            "created_at": time.time(),
            "updated_at": time.time(),
        }
    thread = threading.Thread(target=_run_pipeline, args=(job_id, repo_url, model, deep_scan_limit), daemon=True)
    thread.start()
    return job_id


def _run_pipeline(job_id: str, repo_url: str, model: str, deep_scan_limit: int):
    try:
        # --- Stage: cloning ---
        _set_stage(job_id, "cloning", f"Cloning {repo_url} ...")
        repo_root = cloner.clone_repo(repo_url, job_id)
        _update(job_id, repo_root=str(repo_root))

        # --- Stage: scanning (walk + classify files) ---
        _set_stage(job_id, "scanning", "Walking repo tree and classifying files...")
        buckets = repo_walk.classify_files(repo_root)
        stats = repo_walk.repo_stats(repo_root, buckets)

        if stats["total_files_analyzed"] == 0:
            _update(
                job_id,
                stage="done",
                stage_detail="No supported source files found.",
                result={
                    "stats": stats,
                    "findings": [],
                    "summary": {"high": 0, "medium": 0, "low": 0, "total": 0},
                    "ollama_status": "skipped",
                },
            )
            return

        # --- Stage: analyzing (static analysis pass) ---
        _set_stage(job_id, "analyzing", "Running static analyzers (pylint, bandit, eslint)...")
        findings: list[dict] = []
        findings += static_analysis.run_pylint(buckets["python"], repo_root)
        findings += static_analysis.run_bandit(buckets["python"], repo_root)
        js_ts_files = buckets["javascript"] + buckets["typescript"]
        findings += static_analysis.run_eslint(js_ts_files, repo_root, ESLINT_RUNTIME_DIR)

        ollama_status = ollama_client.check_ollama(model)

        # --- Stage: triaging (LLM explains/ranks static findings) ---
        if ollama_status.reachable and ollama_status.model_available:
            _set_stage(job_id, "triaging", f"Asking {model} to explain {len(findings)} findings...")
            findings = ollama_client.triage_findings(findings, model=model)

            # Deep-scan a capped number of "interesting" files for logic bugs
            # linters can't see. We prioritize files that already have at
            # least one static finding (more likely to be messy) plus a
            # handful of clean-looking files for balance, capped so a huge
            # repo doesn't take forever on local hardware.
            flagged_files = {f["file"] for f in findings}
            all_files = buckets["python"] + buckets["javascript"] + buckets["typescript"]
            priority = [f for f in all_files if str(f.relative_to(repo_root)) in flagged_files]
            rest = [f for f in all_files if f not in priority]
            to_scan = (priority + rest)[:deep_scan_limit]

            _set_stage(job_id, "triaging", f"Deep-scanning {len(to_scan)} files for logic bugs...")
            for f in to_scan:
                try:
                    source = f.read_text(encoding="utf-8", errors="ignore")
                except OSError:
                    continue
                rel = str(f.relative_to(repo_root))
                findings += ollama_client.deep_scan_file(rel, source, model=model)
        else:
            _set_stage(job_id, "triaging", "Ollama unavailable - skipping LLM analysis, static findings only.")
            for f in findings:
                f.setdefault("explanation", f["message"])
                f.setdefault("suggested_fix", "(LLM unavailable)")

        # --- Done ---
        summary = {"high": 0, "medium": 0, "low": 0}
        for f in findings:
            summary[f.get("severity", "medium")] = summary.get(f.get("severity", "medium"), 0) + 1
        summary["total"] = len(findings)

        findings.sort(key=lambda f: {"high": 0, "medium": 1, "low": 2}.get(f.get("severity"), 1))

        _update(
            job_id,
            stage="done",
            stage_detail=f"Found {len(findings)} issues across {stats['total_files_analyzed']} files.",
            result={
                "stats": stats,
                "findings": findings,
                "summary": summary,
                "ollama_status": ollama_status.detail,
                "model_used": model if ollama_status.model_available else None,
            },
        )

    except cloner.CloneError as e:
        _update(job_id, stage="failed", stage_detail=str(e), error=str(e))
        cloner.cleanup_job(job_id)
    except Exception as e:  # noqa: BLE001 - surface any unexpected failure to the UI rather than hang it
        _update(job_id, stage="failed", stage_detail=f"Unexpected error: {e}", error=str(e))
        cloner.cleanup_job(job_id)
