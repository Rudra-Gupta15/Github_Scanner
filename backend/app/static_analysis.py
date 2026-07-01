"""
static_analysis.py — runs deterministic linters as the first pass of the
hybrid pipeline. This gives us fast, reliable candidate findings before the
LLM pass adds explanation, severity triage, and logic-level bug-hunting that
linters can't do.

Python -> pylint (general issues) + bandit (security-specific)
JS/TS  -> eslint (using a bundled minimal config so repos without their own
          eslint setup still get scanned)
"""

import json
import subprocess
from pathlib import Path

PYLINT_TIMEOUT = 60
BANDIT_TIMEOUT = 60
ESLINT_TIMEOUT = 90

# Maps pylint message types to our normalized severity scale
PYLINT_TYPE_SEVERITY = {
    "error": "high",
    "warning": "medium",
    "convention": "low",
    "refactor": "low",
    "fatal": "high",
}

BANDIT_SEVERITY_MAP = {"HIGH": "high", "MEDIUM": "medium", "LOW": "low"}


def run_pylint(files: list[Path], repo_root: Path) -> list[dict]:
    if not files:
        return []
    findings = []
    try:
        result = subprocess.run(
            ["pylint", "--output-format=json", "--disable=C0114,C0115,C0116"]
            + [str(f) for f in files],
            capture_output=True,
            text=True,
            timeout=PYLINT_TIMEOUT,
            cwd=str(repo_root),
        )
        raw = result.stdout.strip()
        if raw:
            issues = json.loads(raw)
            for issue in issues:
                findings.append({
                    "tool": "pylint",
                    "file": str(Path(issue["path"]).resolve().relative_to(repo_root))
                        if Path(issue["path"]).is_absolute()
                        else issue["path"],
                    "line": issue.get("line", 0),
                    "rule": issue.get("symbol", issue.get("message-id", "")),
                    "message": issue.get("message", ""),
                    "severity": PYLINT_TYPE_SEVERITY.get(issue.get("type", "warning"), "medium"),
                    "category": "code_smell" if issue.get("type") in ("convention", "refactor") else "bug",
                })
    except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError, KeyError):
        pass
    return findings


def run_bandit(files: list[Path], repo_root: Path) -> list[dict]:
    if not files:
        return []
    findings = []
    try:
        result = subprocess.run(
            ["bandit", "-f", "json", "-q"] + [str(f) for f in files],
            capture_output=True,
            text=True,
            timeout=BANDIT_TIMEOUT,
            cwd=str(repo_root),
        )
        raw = result.stdout.strip()
        if raw:
            data = json.loads(raw)
            for issue in data.get("results", []):
                fpath = Path(issue["filename"])
                rel = str(fpath.resolve().relative_to(repo_root)) if fpath.is_absolute() else issue["filename"]
                findings.append({
                    "tool": "bandit",
                    "file": rel,
                    "line": issue.get("line_number", 0),
                    "rule": issue.get("test_id", ""),
                    "message": issue.get("issue_text", ""),
                    "severity": BANDIT_SEVERITY_MAP.get(issue.get("issue_severity", "MEDIUM"), "medium"),
                    "category": "vulnerability",
                })
    except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError, KeyError):
        pass
    return findings


# A minimal eslint flat config so repos without their own setup still scan.
# Intentionally conservative: catches real bugs (undefined vars, unreachable
# code, etc.) without flooding the report with pure style nits.
ESLINT_CONFIG = """
import js from "@eslint/js";
export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { window: "readonly", document: "readonly", console: "readonly",
                 require: "readonly", module: "readonly", process: "readonly",
                 __dirname: "readonly", exports: "readonly", global: "readonly",
                 React: "readonly" }
    },
    rules: {
      "no-unused-vars": "warn",
      "no-undef": "warn",
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-cond-assign": "error",
      "no-constant-condition": "warn",
      "no-fallthrough": "warn",
      "no-self-compare": "error",
      "use-isnan": "error",
      "no-unsafe-negation": "error",
    }
  }
];
"""

ESLINT_SEVERITY_MAP = {2: "high", 1: "medium"}


def run_eslint(files: list[Path], repo_root: Path, eslint_bin_dir: Path) -> list[dict]:
    if not files:
        return []
    findings = []
    config_path = (eslint_bin_dir / "eslint.config.mjs").resolve()
    config_path.write_text(ESLINT_CONFIG)
    eslint_bin = str((eslint_bin_dir / "node_modules" / ".bin" / "eslint").resolve())

    try:
        # IMPORTANT: cwd must be repo_root (not eslint_bin_dir). ESLint 9's
        # flat config treats cwd as the "base path" and silently ignores any
        # file outside it ("File ignored because outside of base path"),
        # even though the config itself resolves fine from an absolute path
        # elsewhere.
        result = subprocess.run(
            [
                eslint_bin,
                "-c", str(config_path),
                "--format", "json",
                "--no-error-on-unmatched-pattern",
            ] + [str(f) for f in files],
            capture_output=True,
            text=True,
            timeout=ESLINT_TIMEOUT,
            cwd=str(repo_root),
        )
        raw = result.stdout.strip()
        if raw:
            data = json.loads(raw)
            for file_result in data:
                fpath = Path(file_result["filePath"])
                rel = str(fpath.resolve().relative_to(repo_root)) if fpath.is_absolute() else file_result["filePath"]
                for msg in file_result.get("messages", []):
                    findings.append({
                        "tool": "eslint",
                        "file": rel,
                        "line": msg.get("line", 0),
                        "rule": msg.get("ruleId") or "syntax-error",
                        "message": msg.get("message", ""),
                        "severity": ESLINT_SEVERITY_MAP.get(msg.get("severity", 1), "medium"),
                        "category": "bug" if msg.get("severity") == 2 else "code_smell",
                    })
    except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError, KeyError):
        pass
    return findings
