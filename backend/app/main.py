"""
main.py - FastAPI entrypoint.

Endpoints:
  POST /api/analyze            -> starts a job, returns {job_id}
  GET  /api/jobs/{job_id}      -> poll job status/result
  GET  /api/health             -> Ollama reachability check
  GET  /api/jobs/{job_id}/tree -> file tree of the cloned repo (IDE view)
  GET  /api/jobs/{job_id}/file -> single file content (IDE view)
  POST /api/jobs/{job_id}/chat -> SSE streaming chat with Ollama (IDE view)
"""

import json

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .ollama_client import DEFAULT_SCAN_MODEL, DEFAULT_CHAT_MODEL, check_ollama, stream_chat
from .pipeline import get_job, get_job_repo_root, start_job
from . import repo_walk

app = FastAPI(title="RepoScan API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # demo/hackathon scope - tighten for real deployment
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    repo_url: str
    model: str | None = None


class ChatRequest(BaseModel):
    question: str
    context: str = ""
    model: str | None = None


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    model = req.model or DEFAULT_SCAN_MODEL
    job_id = start_job(req.repo_url, model=model)
    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.get("/api/health")
def health(model: str = DEFAULT_SCAN_MODEL):
    status = check_ollama(model)
    return {
        "ollama_reachable": status.reachable,
        "model_available": status.model_available,
        "detail": status.detail,
        "configured_model": model,
    }


# ---------- IDE View endpoints ----------


@app.get("/api/jobs/{job_id}/tree")
def file_tree(job_id: str):
    """Return the file tree of the cloned repo for the IDE file explorer."""
    repo_root = get_job_repo_root(job_id)
    if repo_root is None:
        raise HTTPException(status_code=404, detail="Job not found or repo no longer on disk")
    return repo_walk.build_file_tree(repo_root)


@app.get("/api/jobs/{job_id}/file")
def file_content(job_id: str, path: str = Query(..., description="Relative path within the repo")):
    """Return the text content of a single file from the cloned repo."""
    repo_root = get_job_repo_root(job_id)
    if repo_root is None:
        raise HTTPException(status_code=404, detail="Job not found or repo no longer on disk")
    content = repo_walk.read_file_safe(repo_root, path)
    if content is None:
        raise HTTPException(status_code=404, detail="File not found or not readable")
    return {"path": path, "content": content}


@app.post("/api/jobs/{job_id}/chat")
def chat(job_id: str, req: ChatRequest):
    """SSE streaming chat endpoint — streams tokens from Ollama."""
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    model = req.model or DEFAULT_CHAT_MODEL

    # Build context from the scan results
    context_parts = [req.context] if req.context else []
    if job.get("result"):
        summary = job["result"].get("summary", {})
        context_parts.append(
            f"Scan summary: {summary.get('high', 0)} high, "
            f"{summary.get('medium', 0)} medium, {summary.get('low', 0)} low severity issues."
        )
        # Include a brief list of files with issues
        findings = job["result"].get("findings", [])
        files_with_issues = {}
        for f in findings[:50]:  # cap to avoid huge context
            fname = f.get("file", "")
            if fname not in files_with_issues:
                files_with_issues[fname] = []
            files_with_issues[fname].append(f"L{f.get('line', '?')}: [{f.get('severity', '?')}] {f.get('message', '')}")

        for fname, issues in files_with_issues.items():
            context_parts.append(f"\n{fname}:")
            for iss in issues[:5]:  # cap per file
                context_parts.append(f"  - {iss}")

    full_context = "\n".join(context_parts)

    def event_stream():
        for token in stream_chat(req.question, full_context, model=model):
            # SSE format: data: <json>\n\n
            yield f"data: {json.dumps({'token': token})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")

@app.post("/api/jobs/{job_id}/review")
def review(job_id: str, req: ChatRequest):
    """SSE streaming endpoint for a full project architecture review."""
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    model = req.model or DEFAULT_CHAT_MODEL
    repo_root = get_job_repo_root(job_id)
    if repo_root is None:
        raise HTTPException(status_code=404, detail="Job not found or repo no longer on disk")

    tree = repo_walk.build_file_tree(repo_root)

    def _flatten_tree(nodes, prefix=""):
        lines = []
        for n in nodes:
            lines.append(f"{prefix}- {n['name']}")
            if n.get("type") == "dir" and n.get("children"):
                lines.extend(_flatten_tree(n["children"], prefix + "  "))
        return lines

    tree_text = "\n".join(_flatten_tree(tree))
    
    question = (
        "You are an expert software architect. Below is the file tree of a project repository.\n"
        "Please provide a comprehensive explanation of the project's architecture, folder by folder and file by file, "
        "so that a new developer joining the team can easily understand how the project is structured and what each part does.\n\n"
        f"File Tree:\n{tree_text}"
    )

    def event_stream():
        for token in stream_chat(question, context="", model=model):
            yield f"data: {json.dumps({'token': token})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
