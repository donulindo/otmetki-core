#!/usr/bin/env python3
"""Export only explicitly approved source paths, rejecting obvious private data.

This check does not replace review of Git identities, access rights, artifacts
or unknown personal information. Optional private terms stay outside the export.
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
from urllib.parse import urlsplit


BASE = Path(__file__).resolve().parents[1]
ALLOWED_HOSTS = {"www.apache.org", "apache.org", "docs.python.org", "example.org", "localhost", "127.0.0.1"}
FORBIDDEN_NAMES = {"SPEC.md", "AGENTS.md", ".git", ".env", "node_modules", ".data", "__pycache__"}
FORBIDDEN_SUFFIXES = {".db", ".sqlite", ".sqlite3", ".pem", ".key", ".log", ".png", ".jpg", ".jpeg", ".pdf", ".docx", ".zip"}
SECRET_PATTERNS = [
    re.compile(r"\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bcfat_[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"\bcliproxy-[A-Za-z0-9_-]{24,}\b"),
    re.compile(r"\bsk-(?:proj-|ant-(?:api\d+-)?)?[A-Za-z0-9_-]{24,}\b"),
    re.compile(r"\bAKIA[A-Z0-9]{16}\b"),
    re.compile(r"\b\d{6,12}:[A-Za-z0-9_-]{30,}\b"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"(?i)\b(?:api[_-]?key|password|(?:access[_-]?)?token|secret)\s*[:=]\s*[\"']?[A-Za-z0-9_-]{24,}"),
    re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._-]{24,}"),
]


def inspect_text(content: str, denied_terms: list[str] = ()) -> set[str]:
    findings = set()
    if any(pattern.search(content) for pattern in SECRET_PATTERNS):
        findings.add("credential-pattern")
    if re.search(r"/(?:Users|home|root|opt)/[A-Za-z0-9_.-]+", content):
        findings.add("machine-path")
    if re.search(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", content):
        findings.add("email-address")
    for match in re.finditer(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])", content):
        try:
            address = ipaddress.ip_address(match[0])
        except ValueError:
            continue
        if not address.is_loopback:
            findings.add("network-address")
    for match in re.finditer(r"https?://[^\s\"'<>\)\]]+", content):
        try:
            parsed = urlsplit(match[0])
            if parsed.username or parsed.password or parsed.hostname not in ALLOWED_HOSTS:
                findings.add("unapproved-url")
        except ValueError:
            findings.add("unapproved-url")
    lowered = content.casefold()
    if any(term.casefold() in lowered for term in denied_terms if term):
        findings.add("private-term")
    return findings


def load_allowlist(base: Path) -> list[str]:
    raw = json.loads((base / "public-files.json").read_text(encoding="utf-8"))
    files = raw.get("files")
    if not isinstance(files, list) or not files or len(files) != len(set(files)):
        raise ValueError("Invalid public file allowlist.")
    for name in files:
        if not isinstance(name, str):
            raise ValueError("Invalid public file path.")
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or str(path) != name or any(part in FORBIDDEN_NAMES or part.startswith(".env") for part in path.parts):
            raise ValueError("Unsafe public file path.")
        source = base / name
        if source.suffix.lower() in FORBIDDEN_SUFFIXES or not source.is_file() or any((base / Path(*path.parts[:index])).is_symlink() for index in range(1, len(path.parts) + 1)):
            raise ValueError("Public file is missing or prohibited.")
        if not source.resolve().is_relative_to(base.resolve()):
            raise ValueError("Public file escapes its source directory.")
    return files


def export(base: Path, output: Path, denied_terms: list[str] = ()) -> dict:
    base, output = base.resolve(), output.resolve()
    if output == base or output.is_relative_to(base) or base.is_relative_to(output):
        raise ValueError("Choose an isolated export directory.")
    if output.exists() and any(output.iterdir()):
        raise ValueError("The export directory must be empty.")
    files = load_allowlist(base)
    entries, failures, reviewed_bytes = [], [], {}
    for name in files:
        raw = (base / name).read_bytes()
        try:
            content = raw.decode("utf-8")
        except UnicodeDecodeError:
            raise ValueError("Only reviewed UTF-8 source files may be exported.") from None
        findings = inspect_text(content, denied_terms)
        if findings:
            failures.append({"file": name, "checks": sorted(findings)})
        reviewed_bytes[name] = raw
        entries.append({"path": name, "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)})
    if failures:
        # Do not return matched values, documents or absolute machine paths.
        raise ValueError("Privacy checks failed: " + json.dumps(failures, ensure_ascii=False))
    output.mkdir(parents=True, exist_ok=True)
    try:
        for name in files:
            target = output / name
            target.parent.mkdir(parents=True, exist_ok=True)
            # Write exactly the bytes scanned and hashed, even if source files
            # change while another process prepares this release.
            target.write_bytes(reviewed_bytes[name])
        manifest = {"format": 1, "package": "otmetki-core", "version": "0.1.0", "files": entries}
        (output / "release-manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    except Exception:
        shutil.rmtree(output)
        raise
    return {"package": "otmetki-core", "files": len(entries), "bytes": sum(entry["bytes"] for entry in entries), "manifestSha256": hashlib.sha256((output / "release-manifest.json").read_bytes()).hexdigest()}


def main() -> None:
    parser = argparse.ArgumentParser(description="Export a reviewed educational source allowlist")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--deny-list", type=Path, help="A separate private JSON array of terms; never copied into the export")
    args = parser.parse_args()
    try:
        terms = json.loads(args.deny_list.read_text(encoding="utf-8")) if args.deny_list else []
        if not isinstance(terms, list) or any(not isinstance(term, str) for term in terms):
            raise ValueError("Invalid private deny-list.")
        print(json.dumps(export(BASE, args.output, terms), ensure_ascii=False))
    except (ValueError, OSError, json.JSONDecodeError):
        print("Export rejected. Check the allowlist, source privacy and output directory.", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
