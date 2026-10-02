#!/usr/bin/env python3
"""Fail-closed npm supply-chain checks with no third-party dependencies."""

from __future__ import annotations

import argparse
import csv
import json
import os
import platform
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Iterable

DEFAULT_FEED_URL = (
    "https://raw.githubusercontent.com/wiz-sec-public/"
    "wiz-research-iocs/main/reports/keyv-packages.csv"
)
DEFAULT_MINIMUM_FEED_ROWS = 400
PACKAGE_RE = re.compile(r"^(?:@[a-z0-9._-]+/)?[a-z0-9._-]+$", re.IGNORECASE)
VERSION_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z.+_-]*$")
GO_MODULE_RE = re.compile(r"^github\.com/[a-z0-9._-]+/[a-z0-9._-]+$", re.IGNORECASE)
GO_VERSION_RE = re.compile(
    r"^v\d+\.\d+\.\d+(?:-\d{14}-[0-9a-f]{12})?$", re.IGNORECASE
)
LIFECYCLE_NAMES = ("preinstall", "install", "postinstall")
SKIP_REPOSITORY_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "coverage",
    ".angular",
    ".cache",
    "build",
    "venv",
    ".venv",
}
MALICIOUS_FILENAMES = {"setup.mjs", "math_init.js"}
MALICIOUS_WORKFLOW_MARKERS = (
    "toJSON(secrets)",
    "format-results.txt",
    "Run Copilot",
)
PROHIBITED_EXECUTABLE_SUFFIXES = {".dll", ".dylib", ".exe", ".msi", ".node", ".scr", ".so"}
WORKFLOW_INSTALL_PATTERNS = (
    re.compile(r"\bnpx\b", re.IGNORECASE),
    re.compile(r"\bnpm\s+ci\s*\|\|", re.IGNORECASE),
    re.compile(r"\bnpm\s+install\b", re.IGNORECASE),
)
OIDC_BUILD_PATTERNS = (
    re.compile(r"actions/checkout@", re.IGNORECASE),
    re.compile(r"\bnpm\s+", re.IGNORECASE),
    re.compile(r"\bpip\s+install\b", re.IGNORECASE),
    re.compile(r"\bdocker\s+build\b", re.IGNORECASE),
)
HOOK_MARKERS = (
    "SessionStart",
    "folderOpen",
    "node .vscode/setup.mjs",
    "node .claude/setup.mjs",
    "gh-token-monitor",
    "npm-cache.com",
)


class ScanError(RuntimeError):
    """Raised when security inputs cannot be trusted."""


def parse_blocklist_text(text: str, source: str) -> dict[str, set[str]]:
    reader = csv.DictReader(text.splitlines())
    if reader.fieldnames != ["Package", "Malicious Versions"]:
        raise ScanError(f"{source}: unexpected CSV header {reader.fieldnames!r}")

    packages: dict[str, set[str]] = {}
    ignored_go_modules = 0
    for line_number, row in enumerate(reader, start=2):
        name = (row.get("Package") or "").strip()
        versions = {
            value.strip()
            for value in (row.get("Malicious Versions") or "").split(",")
            if value.strip()
        }
        if GO_MODULE_RE.fullmatch(name):
            if not versions or any(not GO_VERSION_RE.fullmatch(version) for version in versions):
                raise ScanError(f"{source}:{line_number}: invalid Go module version list")
            ignored_go_modules += 1
            continue
        if not PACKAGE_RE.fullmatch(name):
            raise ScanError(f"{source}:{line_number}: invalid package name {name!r}")
        if not versions or any(not VERSION_RE.fullmatch(version) for version in versions):
            raise ScanError(f"{source}:{line_number}: invalid version list")
        packages.setdefault(name, set()).update(versions)

    if not packages:
        raise ScanError(f"{source}: blocklist is empty")
    if ignored_go_modules:
        print(
            f"WARNING: {source}: ignored {ignored_go_modules} validated Go module "
            "row(s) in the mixed-ecosystem IOC feed",
            file=sys.stderr,
        )
    return packages


def merge_blocklists(
    destination: dict[str, set[str]], incoming: dict[str, set[str]]
) -> None:
    for name, versions in incoming.items():
        destination.setdefault(name, set()).update(versions)


def fetch_feed(url: str, timeout: int) -> str:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "OSC-IS-supply-chain-scanner/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if getattr(response, "status", 200) != 200:
                raise ScanError(f"remote IOC feed returned HTTP {response.status}")
            return response.read().decode("utf-8-sig")
    except (OSError, UnicodeError, urllib.error.URLError) as exc:
        raise ScanError(f"unable to retrieve remote IOC feed: {exc}") from exc


def load_blocklists(args: argparse.Namespace, repo: Path) -> dict[str, set[str]]:
    vendored_path = (repo / args.blocklist).resolve()
    try:
        vendored_text = vendored_path.read_text(encoding="utf-8-sig")
    except OSError as exc:
        raise ScanError(f"cannot read vendored blocklist {vendored_path}: {exc}") from exc

    combined = parse_blocklist_text(vendored_text, str(vendored_path))
    if args.offline_reviewed:
        print(
            "WARNING: remote IOC refresh skipped by explicit --offline-reviewed override",
            file=sys.stderr,
        )
        return combined

    remote = parse_blocklist_text(
        fetch_feed(args.feed_url, args.feed_timeout),
        args.feed_url,
    )
    if len(remote) < args.minimum_feed_rows:
        raise ScanError(
            f"remote IOC feed has {len(remote)} packages; "
            f"expected at least {args.minimum_feed_rows}"
        )
    merge_blocklists(combined, remote)
    return combined


def load_lifecycle_policy(path: Path) -> dict[str, dict[str, Any]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ScanError(f"cannot parse lifecycle policy {path}: {exc}") from exc

    packages = data.get("packages")
    if not isinstance(packages, dict):
        raise ScanError(f"{path}: expected a packages object")

    for name, rule in packages.items():
        if not PACKAGE_RE.fullmatch(name) or not isinstance(rule, dict):
            raise ScanError(f"{path}: invalid lifecycle rule for {name!r}")
        versions = rule.get("versions")
        execute = rule.get("execute")
        scripts = rule.get("scripts", {})
        if (
            not isinstance(versions, list)
            or not versions
            or any(not isinstance(v, str) or not VERSION_RE.fullmatch(v) for v in versions)
            or not isinstance(execute, bool)
            or not isinstance(scripts, dict)
        ):
            raise ScanError(f"{path}: malformed lifecycle rule for {name}")
        for lifecycle, command in scripts.items():
            if lifecycle not in LIFECYCLE_NAMES or not isinstance(command, str):
                raise ScanError(f"{path}: invalid script policy for {name}")
    return packages


def package_name_from_lock_path(package_path: str) -> str:
    normalized = package_path.replace("\\", "/")
    return normalized.rsplit("node_modules/", 1)[-1]


def walk_v1_dependencies(
    dependencies: dict[str, Any], prefix: str = "node_modules"
) -> Iterable[tuple[str, str, dict[str, Any]]]:
    for name, metadata in dependencies.items():
        if not isinstance(metadata, dict):
            continue
        package_path = f"{prefix}/{name}"
        version = str(metadata.get("version", ""))
        yield package_path, version, metadata
        nested = metadata.get("dependencies")
        if isinstance(nested, dict):
            yield from walk_v1_dependencies(
                nested, f"{package_path}/node_modules"
            )


def iter_lock_packages(lock: dict[str, Any]) -> Iterable[tuple[str, str, dict[str, Any]]]:
    packages = lock.get("packages")
    if isinstance(packages, dict):
        for package_path, metadata in packages.items():
            if not package_path or "node_modules" not in package_path:
                continue
            if not isinstance(metadata, dict):
                raise ScanError(f"invalid package metadata at {package_path}")
            yield package_path, str(metadata.get("version", "")), metadata
        return

    dependencies = lock.get("dependencies")
    if isinstance(dependencies, dict):
        yield from walk_v1_dependencies(dependencies)
        return
    raise ScanError("package-lock.json contains neither packages nor dependencies")


def platform_matches(metadata: dict[str, Any]) -> bool:
    supported = metadata.get("os")
    if not isinstance(supported, list) or not supported:
        return True
    current = {
        "Windows": "win32",
        "Linux": "linux",
        "Darwin": "darwin",
    }.get(platform.system(), platform.system().lower())
    positives = {value for value in supported if isinstance(value, str) and not value.startswith("!")}
    negatives = {value[1:] for value in supported if isinstance(value, str) and value.startswith("!")}
    if current in negatives:
        return False
    return not positives or current in positives


def load_lock(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ScanError(f"cannot parse lockfile {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ScanError(f"{path}: lockfile root must be an object")
    return data


def scan_lock(
    lock_path: Path,
    blocklist: dict[str, set[str]],
    lifecycle_policy: dict[str, dict[str, Any]],
) -> tuple[list[str], dict[str, tuple[str, dict[str, Any]]]]:
    findings: list[str] = []
    indexed: dict[str, tuple[str, dict[str, Any]]] = {}
    lock = load_lock(lock_path)

    for package_path, version, metadata in iter_lock_packages(lock):
        path_name = package_name_from_lock_path(package_path)
        name = str(metadata.get("name") or path_name)
        indexed[package_path.replace("\\", "/")] = (version, metadata)
        if not PACKAGE_RE.fullmatch(name) or not VERSION_RE.fullmatch(version):
            findings.append(f"{lock_path}: malformed package identity {name}@{version}")
            continue
        if version in blocklist.get(name, set()):
            findings.append(f"{lock_path}: BLOCKED malicious dependency {name}@{version}")

        if metadata.get("hasInstallScript") is True and platform_matches(metadata):
            rule = lifecycle_policy.get(name)
            if rule is None or version not in rule["versions"]:
                findings.append(
                    f"{lock_path}: unreviewed lifecycle package {name}@{version}"
                )
    return findings, indexed


def installed_manifest_path(repo: Path, package_path: str) -> Path:
    return repo / Path(package_path.replace("/", os.sep)) / "package.json"


def scan_installed_manifests(
    repo: Path,
    indexed: dict[str, tuple[str, dict[str, Any]]],
    blocklist: dict[str, set[str]],
    lifecycle_policy: dict[str, dict[str, Any]],
) -> list[str]:
    findings: list[str] = []
    for package_path, (locked_version, metadata) in indexed.items():
        manifest_path = installed_manifest_path(repo, package_path)
        if not manifest_path.exists():
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            findings.append(f"{manifest_path}: cannot parse installed manifest: {exc}")
            continue

        name = manifest.get("name")
        version = str(manifest.get("version", ""))
        expected_name = str(
            metadata.get("name") or package_name_from_lock_path(package_path)
        )
        if name != expected_name or version != locked_version:
            findings.append(
                f"{manifest_path}: installed identity does not match lockfile"
            )
            continue
        if version in blocklist.get(name, set()):
            findings.append(f"{manifest_path}: BLOCKED installed dependency {name}@{version}")

        scripts = manifest.get("scripts") or {}
        lifecycle = {
            key: value
            for key, value in scripts.items()
            if key in LIFECYCLE_NAMES and isinstance(value, str) and value.strip()
        }
        if not lifecycle:
            continue

        rule = lifecycle_policy.get(name)
        if rule is None or version not in rule["versions"]:
            findings.append(f"{manifest_path}: unreviewed lifecycle scripts for {name}@{version}")
            continue
        expected = rule.get("scripts", {})
        for script_name, command in lifecycle.items():
            if script_name == "preinstall":
                findings.append(
                    f"{manifest_path}: preinstall hooks are prohibited ({name}@{version})"
                )
            elif expected.get(script_name) != command:
                findings.append(
                    f"{manifest_path}: lifecycle command changed for "
                    f"{name}@{version}:{script_name}"
                )
    return findings


def scan_repository_hooks(repo: Path) -> list[str]:
    findings: list[str] = []
    for root, directories, filenames in os.walk(repo):
        directories[:] = [
            name for name in directories if name not in SKIP_REPOSITORY_DIRS
        ]
        current = Path(root)
        relative_root = current.relative_to(repo)

        for filename in filenames:
            path = current / filename
            relative = (relative_root / filename).as_posix()
            if filename in MALICIOUS_FILENAMES:
                findings.append(f"{relative}: prohibited malware filename")
                continue
            if path.suffix.lower() in PROHIBITED_EXECUTABLE_SUFFIXES:
                findings.append(f"{relative}: prohibited executable payload")
                continue
            if filename == "Math_Symbol.js":
                findings.append(f"{relative}: suspicious payload filename")
                continue

            inspect_hooks = relative in {
                ".claude/settings.json",
                ".vscode/tasks.json",
            }
            inspect_workflow = relative.startswith(".github/workflows/") and path.suffix in {
                ".yml",
                ".yaml",
            }
            if not inspect_hooks and not inspect_workflow:
                continue
            try:
                content = path.read_text(encoding="utf-8", errors="replace")
            except OSError as exc:
                findings.append(f"{relative}: cannot inspect security-sensitive file: {exc}")
                continue
            markers = HOOK_MARKERS if inspect_hooks else MALICIOUS_WORKFLOW_MARKERS
            for marker in markers:
                if marker.lower() in content.lower():
                    findings.append(f"{relative}: prohibited marker {marker!r}")
            if inspect_workflow:
                findings.extend(scan_workflow_policy(relative, content))
    return findings


def scan_workflow_policy(relative: str, content: str) -> list[str]:
    findings: list[str] = []
    for line_number, line in enumerate(content.splitlines(), start=1):
        match = re.match(r"^\s*-\s+uses:\s*([^#\s]+)", line)
        if match:
            action = match.group(1)
            if not action.startswith("./"):
                reference = action.rsplit("@", 1)[-1] if "@" in action else ""
                if not re.fullmatch(r"[0-9a-fA-F]{40}", reference):
                    findings.append(f"{relative}:{line_number}: external action is not pinned to a full SHA")
        for pattern in WORKFLOW_INSTALL_PATTERNS:
            if pattern.search(line):
                findings.append(f"{relative}:{line_number}: prohibited dependency command in workflow")
    jobs = []
    current_name = ""
    current_lines = []
    in_jobs = False
    for line_number, line in enumerate(content.splitlines(), start=1):
        if line == "jobs:":
            in_jobs = True
            continue
        if not in_jobs:
            continue
        job = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
        if job:
            if current_name:
                jobs.append((current_name, current_lines))
            current_name = job.group(1)
            current_lines = [(line_number, line)]
        elif current_name:
            current_lines.append((line_number, line))
    if current_name:
        jobs.append((current_name, current_lines))
    for job_name, job_lines in jobs:
        block = "\n".join(line for _, line in job_lines)
        if "id-token: write" not in block:
            continue
        for line_number, line in job_lines:
            if any(pattern.search(line) for pattern in OIDC_BUILD_PATTERNS):
                findings.append(f"{relative}:{line_number}: OIDC job {job_name!r} contains a build/install step")
    return findings


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=".", help="repository root")
    parser.add_argument("--lock", default="package-lock.json", help="lockfile path")
    parser.add_argument(
        "--blocklist",
        default="security/npm-malware-blocklist.csv",
        help="vendored IOC CSV path relative to the repository",
    )
    parser.add_argument(
        "--policy",
        default="security/npm-lifecycle-allowlist.json",
        help="lifecycle policy path relative to the repository",
    )
    parser.add_argument("--feed-url", default=DEFAULT_FEED_URL)
    parser.add_argument("--feed-timeout", type=int, default=20)
    parser.add_argument(
        "--minimum-feed-rows",
        type=int,
        default=DEFAULT_MINIMUM_FEED_ROWS,
    )
    parser.add_argument(
        "--offline-reviewed",
        action="store_true",
        help="use only the reviewed vendored blocklist",
    )
    parser.add_argument(
        "--skip-installed",
        action="store_true",
        help="do not inspect an existing node_modules tree",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    repo = Path(args.repo).resolve()
    lock_path = (repo / args.lock).resolve()
    try:
        blocklist = load_blocklists(args, repo)
        lifecycle_policy = load_lifecycle_policy((repo / args.policy).resolve())
        findings, indexed = scan_lock(lock_path, blocklist, lifecycle_policy)
        findings.extend(scan_repository_hooks(repo))
        if not args.skip_installed:
            findings.extend(
                scan_installed_manifests(
                    repo, indexed, blocklist, lifecycle_policy
                )
            )
    except ScanError as exc:
        print(f"SUPPLY-CHAIN CHECK ERROR: {exc}", file=sys.stderr)
        return 1

    if findings:
        print("SUPPLY-CHAIN CHECK FAILED", file=sys.stderr)
        for finding in sorted(set(findings)):
            print(f" - {finding}", file=sys.stderr)
        return 2

    print(
        f"Supply-chain check passed: {len(indexed)} locked packages, "
        f"{len(blocklist)} blocked package names."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
