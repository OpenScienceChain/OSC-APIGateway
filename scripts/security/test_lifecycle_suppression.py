#!/usr/bin/env python3
"""Prove that a local dependency preinstall hook cannot execute."""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path


def main() -> int:
    npm = shutil.which("npm")
    if not npm:
        raise SystemExit("npm is required for the lifecycle suppression test")
    fixture = Path(__file__).parent / "fixtures" / "lifecycle-sentinel"
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        sentinel = root / "sentinel.txt"
        environment = os.environ.copy()
        environment["OSC_SENTINEL_PATH"] = str(sentinel)
        subprocess.run([npm, "install", "--ignore-scripts", "--no-audit",
            "--fund=false", "--package-lock=false", "--prefix", str(root),
            str(fixture)], check=True, env=environment)
        if sentinel.exists():
            raise SystemExit("dependency lifecycle script unexpectedly executed")
    print("Lifecycle suppression test passed; sentinel was not created.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
