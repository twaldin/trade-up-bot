"""Shared nginx config helpers for the deploy patch scripts.

sites-enabled is included with a `*` glob, so a leftover `*.bak` (or another
backup name) is loaded beside the live site. Park those files outside the
include path before `nginx -t` / reload.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

SKIP_SUFFIXES = (
    ".bak",
    ".save",
    ".orig",
    ".old",
    "~",
    ".swp",
    ".disabled",
    ".dpkg-old",
    ".dpkg-dist",
    ".rpmnew",
    ".rpmsave",
)
# Dated or tagged backups such as tradeup.bak-20260518220608 or tradeup.bak.1.
BACKUP_NAME_RE = re.compile(r"[._-](?:bak\d*|backup|orig|old|save)(?:[-._]|$)", re.I)

# Directories nginx includes at runtime. sites-available is not one of them.
INCLUDE_ROOTS = (
    Path("/etc/nginx/sites-enabled"),
    Path("/etc/nginx/conf.d"),
)
PARK_DIR = Path("/var/backups/nginx-skipped")


def is_backup_name(name: str) -> bool:
    """True for editor/package/manual backup copies that nginx must not load."""
    return name.endswith(SKIP_SUFFIXES) or bool(BACKUP_NAME_RE.search(name))


def _unique_dest(dest_dir: Path, name: str) -> Path:
    candidate = dest_dir / name
    n = 1
    while candidate.exists():
        candidate = dest_dir / f"{name}.{n}"
        n += 1
    return candidate


def park_loaded_backups(
    dest: Path = PARK_DIR,
    roots: tuple[Path, ...] = INCLUDE_ROOTS,
) -> list[tuple[Path, Path]]:
    """Move backup configs out of nginx include directories.

    Returns (original path, parked path) pairs. The originals are no longer
    on the include path, so `nginx -t` and reload do not load them.
    """
    parked: list[tuple[Path, Path]] = []
    for root in roots:
        if not root.is_dir():
            continue
        for path in sorted(root.iterdir()):
            if not path.is_file() or not is_backup_name(path.name):
                continue
            dest.mkdir(parents=True, exist_ok=True)
            target = _unique_dest(dest, f"{root.name}__{path.name}")
            shutil.move(str(path), str(target))
            parked.append((path, target))
    return parked


def restore_parked(parked: list[tuple[Path, Path]]) -> None:
    for original, parked_path in reversed(parked):
        if not parked_path.exists():
            continue
        original.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(parked_path), str(original))


def with_backups_unloaded(apply) -> int:
    """Run an nginx apply step with backup configs parked out of the include path."""
    parked = park_loaded_backups()
    code = 1
    try:
        code = apply()
    finally:
        if code != 0:
            restore_parked(parked)
            parked = []
    if not parked:
        return code
    test = subprocess.run(["nginx", "-t"], capture_output=True, text=True)
    if test.returncode != 0:
        restore_parked(parked)
        sys.stderr.write(test.stderr)
        print("nginx -t failed after skipping backup configs; restored them", file=sys.stderr)
        return 1
    reload = subprocess.run(["nginx", "-s", "reload"], capture_output=True, text=True)
    if reload.returncode != 0:
        restore_parked(parked)
        sys.stderr.write(reload.stderr)
        print("nginx reload failed after skipping backup configs; restored them", file=sys.stderr)
        return 1
    print("skipped nginx backup configs: " + ", ".join(str(src) for src, _dst in parked))
    return code
