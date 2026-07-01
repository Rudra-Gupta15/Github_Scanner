"""
ollama_client.py - talks to a locally running Ollama server.

Two jobs for the LLM pass, mirroring the "hybrid" design:
  1. triage_findings(): take raw static-analysis findings (often terse,
     rule-ID-flavored) and turn each into a plain-English explanation +
     a suggested fix + a confirmed severity.
  2. deep_scan_file(): read a file's full source and ask the model to spot
     logic bugs a linter can't catch - off-by-one errors, race conditions,
     wrong operator, swallowed exceptions, broken null-checks, etc. This is
     the "what static analysis misses" layer and the main differentiator.

Both functions degrade gracefully: if Ollama is unreachable or a model
isn't pulled, we return an empty/explanatory result rather than crashing
the whole pipeline - a tester should still get the static-analysis half
of the report even if the LLM is down.
"""

import json
import re
from dataclasses import dataclass

import requests

OLLAMA_HOST = "http://localhost:11434"
DEFAULT_SCAN_MODEL = "gpt-oss:120b"
DEFAULT_CHAT_MODEL = "qwen2.5-coder:7b"
REQUEST_TIMEOUT = 120


@dataclass
class OllamaStatus:
    reachable: bool
    model_available: bool
    detail: str


def check_ollama(model: str = DEFAULT_SCAN_MODEL) -> OllamaStatus:
    try:
        resp = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=5)
        resp.raise_for_status()
        models = [m["name"] for m in resp.json().get("models", [])]
        available = any(model == m or model.split(":")[0] == m.split(":")[0] for m in models)
        if not available:
            return OllamaStatus(True, False, f"Model '{model}' not found. Pulled models: {models}")
        return OllamaStatus(True, True, "ok")
    except requests.RequestException as e:
        return OllamaStatus(False, False, f"Can't reach Ollama at {OLLAMA_HOST}: {e}")


def _extract_json(text: str):
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"(\{.*\}|\[.*\])", text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                return None
    return None


def _generate(prompt: str, model: str, system: str = None) -> str:
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.1},
    }
    if system:
        payload["system"] = system
    resp = requests.post(f"{OLLAMA_HOST}/api/generate", json=payload, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.json().get("response", "")


TRIAGE_SYSTEM_PROMPT = (
    "You are a senior code reviewer triaging static-analysis output for a bug "
    "report a tester will read. For each finding, write a short plain-English "
    "explanation of why it matters and a concrete one-line fix suggestion. "
    "Respond ONLY with a JSON array, no prose, no markdown fences. Each element: "
    '{"id": <int>, "explanation": "...", "suggested_fix": "...", "severity": "high|medium|low"}'
)


def triage_findings(findings, model: str = DEFAULT_SCAN_MODEL, batch_size: int = 12):
    if not findings:
        return findings

    annotated = list(findings)
    for start in range(0, len(findings), batch_size):
        batch = findings[start:start + batch_size]
        items = [
            {
                "id": i,
                "tool": f["tool"],
                "file": f["file"],
                "line": f["line"],
                "rule": f["rule"],
                "message": f["message"],
                "severity": f["severity"],
            }
            for i, f in enumerate(batch)
        ]
        prompt = "Findings:\n" + json.dumps(items, indent=2)
        try:
            raw = _generate(prompt, model, system=TRIAGE_SYSTEM_PROMPT)
            parsed = _extract_json(raw)
            if isinstance(parsed, list):
                by_id = {p.get("id"): p for p in parsed if isinstance(p, dict)}
                for i, f in enumerate(batch):
                    p = by_id.get(i)
                    global_idx = start + i
                    if p:
                        annotated[global_idx]["explanation"] = p.get("explanation", f["message"])
                        annotated[global_idx]["suggested_fix"] = p.get("suggested_fix", "")
                        if p.get("severity") in ("high", "medium", "low"):
                            annotated[global_idx]["severity"] = p["severity"]
                    else:
                        annotated[global_idx].setdefault("explanation", f["message"])
                        annotated[global_idx].setdefault("suggested_fix", "")
            else:
                for i in range(len(batch)):
                    annotated[start + i].setdefault("explanation", batch[i]["message"])
                    annotated[start + i].setdefault("suggested_fix", "")
        except requests.RequestException:
            for i in range(len(batch)):
                annotated[start + i].setdefault("explanation", batch[i]["message"])
                annotated[start + i].setdefault("suggested_fix", "(LLM unavailable - static finding only)")

    return annotated


DEEP_SCAN_SYSTEM_PROMPT = (
    "You are an expert code reviewer. Read the source file below and find real "
    "logic bugs that a linter would NOT catch: off-by-one errors, wrong "
    "operators, race conditions, unhandled edge cases, incorrect API usage, "
    "resource leaks, broken error handling, security issues. Do NOT report "
    "style nits, naming, or formatting. If the file genuinely has no such "
    "issues, return an empty array. Respond ONLY with a JSON array, no prose, "
    'no markdown fences. Each element: {"line": <int>, "severity": '
    '"high|medium|low", "title": "short title", "explanation": "...", '
    '"suggested_fix": "..."}'
)


def deep_scan_file(file_path: str, source: str, model: str = DEFAULT_SCAN_MODEL):
    max_chars = 12000
    truncated = source[:max_chars]
    prompt = f"File: {file_path}\n\n```\n{truncated}\n```"
    try:
        raw = _generate(prompt, model, system=DEEP_SCAN_SYSTEM_PROMPT)
        parsed = _extract_json(raw)
        if isinstance(parsed, list):
            results = []
            for item in parsed:
                if not isinstance(item, dict):
                    continue
                sev = item.get("severity", "medium")
                if sev not in ("high", "medium", "low"):
                    sev = "medium"
                results.append({
                    "tool": "ollama-deepscan",
                    "file": file_path,
                    "line": item.get("line", 0),
                    "rule": "llm-logic-review",
                    "message": item.get("title", "Potential logic issue"),
                    "explanation": item.get("explanation", ""),
                    "suggested_fix": item.get("suggested_fix", ""),
                    "severity": sev,
                    "category": "bug",
                })
            return results
        return []
    except requests.RequestException:
        return []


CHAT_SYSTEM_PROMPT = (
    "You are a senior code reviewer helping a tester understand bugs found "
    "in a repository. You have access to the scan results and the repo file "
    "tree. Answer questions concisely and helpfully. If the tester asks about "
    "a specific bug, explain it in plain English and suggest a fix. If they "
    "ask a general question, draw on the context provided."
)


def stream_chat(question: str, context: str, model: str = DEFAULT_CHAT_MODEL):
    """Generator that yields text chunks from Ollama's streaming API.

    `context` should include the bug report summary and file tree so the
    LLM has repo-wide awareness without needing the currently open file.
    """
    prompt = f"Context:\n{context}\n\nUser question: {question}"
    payload = {
        "model": model,
        "prompt": prompt,
        "system": CHAT_SYSTEM_PROMPT,
        "stream": True,
        "options": {"temperature": 0.3},
    }
    try:
        resp = requests.post(
            f"{OLLAMA_HOST}/api/generate",
            json=payload,
            stream=True,
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        for line in resp.iter_lines():
            if not line:
                continue
            try:
                chunk = json.loads(line)
                token = chunk.get("response", "")
                if token:
                    yield token
                if chunk.get("done"):
                    break
            except json.JSONDecodeError:
                continue
    except requests.RequestException as e:
        yield f"\n\n⚠️ Could not reach Ollama: {e}"

