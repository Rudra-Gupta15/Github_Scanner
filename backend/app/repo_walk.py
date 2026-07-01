"""
repo_walk.py — walks a cloned repo and classifies files for analysis.

We skip dependency/build dirs and binary/lock files since they're noise:
no tester wants "bugs found in node_modules" in their report, and feeding
megabytes of vendored code to a local LLM would blow the context budget
for no benefit.
"""

from pathlib import Path

SKIP_DIRS = {
    ".git", "node_modules", "venv", ".venv", "env", "__pycache__",
    "dist", "build", "out", ".next", ".nuxt", "target", "vendor",
    "coverage", ".pytest_cache", ".mypy_cache", "egg-info",
}

SKIP_FILE_SUFFIXES = {
    ".lock", ".min.js", ".map", ".png", ".jpg", ".jpeg", ".gif", ".svg",
    ".ico", ".woff", ".woff2", ".ttf", ".eot", ".pdf", ".zip", ".tar",
    ".gz", ".mp4", ".mp3", ".wasm", ".pyc", ".so", ".dll", ".exe",
}

SKIP_FILENAMES = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock",
}

LANGUAGE_BY_EXT = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".mjs": "javascript",
    ".cjs": "javascript",
}

MAX_FILE_BYTES = 300_000  # skip absurdly large generated files


def should_skip_dir(dirname: str) -> bool:
    return dirname in SKIP_DIRS or dirname.startswith(".")


def classify_files(repo_root: Path) -> dict[str, list[Path]]:
    """Returns {"python": [...paths], "javascript": [...], "typescript": [...]}"""
    buckets: dict[str, list[Path]] = {"python": [], "javascript": [], "typescript": []}

    for path in repo_root.rglob("*"):
        if not path.is_file():
            continue
        if any(should_skip_dir(part) for part in path.relative_to(repo_root).parts[:-1]):
            continue
        if path.name in SKIP_FILENAMES:
            continue
        if any(path.name.endswith(suf) for suf in SKIP_FILE_SUFFIXES):
            continue
        try:
            if path.stat().st_size > MAX_FILE_BYTES:
                continue
        except OSError:
            continue

        lang = LANGUAGE_BY_EXT.get(path.suffix.lower())
        if lang:
            buckets[lang].append(path)

    return buckets


def repo_stats(repo_root: Path, buckets: dict[str, list[Path]]) -> dict:
    total_files = sum(len(v) for v in buckets.values())
    total_lines = 0
    file_meta = {}
    for lang, files in buckets.items():
        for f in files:
            lines = 0
            try:
                lines = sum(1 for _ in f.open("r", encoding="utf-8", errors="ignore"))
            except OSError:
                pass
            total_lines += lines
            # standardize path string for frontend lookup
            rel_path = str(f.relative_to(repo_root)).replace("\\", "/")
            file_meta[rel_path] = {"language": lang, "lines": lines}

    return {
        "total_files_analyzed": total_files,
        "total_lines": total_lines,
        "python_files": len(buckets.get("python", [])),
        "javascript_files": len(buckets.get("javascript", [])),
        "typescript_files": len(buckets.get("typescript", [])),
        "file_meta": file_meta,
    }


def build_file_tree(repo_root: Path) -> list[dict]:
    """Build a nested JSON tree of the repo for the IDE file explorer.

    Returns a list of nodes, each: {"name": str, "type": "file"|"dir", "children": [...]}
    Skips the same dirs we skip during analysis (.git, node_modules, etc.).
    """
    def _walk(directory: Path) -> list[dict]:
        nodes = []
        try:
            entries = sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except OSError:
            return nodes

        for entry in entries:
            if entry.is_dir():
                if should_skip_dir(entry.name):
                    continue
                children = _walk(entry)
                nodes.append({"name": entry.name, "type": "dir", "path": str(entry.relative_to(repo_root)), "children": children})
            elif entry.is_file():
                if entry.name in SKIP_FILENAMES:
                    continue
                if any(entry.name.endswith(suf) for suf in SKIP_FILE_SUFFIXES):
                    continue
                nodes.append({"name": entry.name, "type": "file", "path": str(entry.relative_to(repo_root))})

        return nodes

    return _walk(repo_root)


def read_file_safe(repo_root: Path, rel_path: str, max_bytes: int = 500_000) -> str | None:
    """Read a file from the repo with path-traversal protection.

    Returns the file content as a string, or None if the file doesn't exist,
    is too large, or the path tries to escape the repo root.
    """
    # Normalize and resolve to prevent path traversal (../../etc/passwd)
    target = (repo_root / rel_path).resolve()
    repo_resolved = repo_root.resolve()

    if not str(target).startswith(str(repo_resolved)):
        return None  # path traversal attempt

    if not target.is_file():
        return None

    try:
        if target.stat().st_size > max_bytes:
            return None
        return target.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None

