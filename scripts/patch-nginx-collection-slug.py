#!/usr/bin/env python3
"""301 old trade-up detail collection slugs onto the canonical slug.

Detail HTML used to slug a collection with a raw lowercase replace, so
"The Dreams & Nightmares Collection" linked to
/trade-ups/collection/the-dreams-nightmares-collection. Routes resolve
collectionToSlug, which is dreams-nightmares. This rewrite sends the old
the-*-collection form to that canonical path. Live slugs do not match.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

CONF_ROOTS = (
    Path("/etc/nginx/sites-enabled"),
    Path("/etc/nginx/sites-available"),
    Path("/etc/nginx/conf.d"),
)
SKIP_SUFFIXES = (".bak", ".save", ".orig", ".old", "~", ".swp", ".disabled", ".dpkg-old", ".dpkg-dist", ".rpmnew", ".rpmsave")
# Dated or tagged backups such as tradeup.bak-20260518220608 or tradeup.bak.1.
BACKUP_NAME_RE = re.compile(r"[._-](?:bak\d*|backup|orig|old|save)(?:[-._]|$)", re.I)


def is_backup_name(name: str) -> bool:
    """True for editor/package/manual backup copies that nginx never loads."""
    return name.endswith(SKIP_SUFFIXES) or bool(BACKUP_NAME_RE.search(name))

MARKER = "tub-collection-slug-redirect"
LEGACY_RE = re.compile(
    r"^/(trade-ups/collection|collections)/the-([a-z0-9][a-z0-9-]*)-collection/?$"
)
REWRITE = (
    "rewrite ^/(trade-ups/collection|collections)/the-([a-z0-9][a-z0-9-]*)-collection/?$"
    " /$1/$2 permanent;"
)
LOCATION_RE = re.compile(
    r"location\s+(?P<mod>=|~\*|~|\^~)?\s*(?P<uri>[^{]+?)\{",
    re.M,
)


class NoTradeUpsLocation(Exception):
    pass


def redirect_target(uri: str) -> str | None:
    path, sep, query = uri.partition("?")
    match = LEGACY_RE.match(path)
    if not match:
        return None
    target = f"/{match.group(1)}/{match.group(2)}"
    if sep:
        target += "?" + query
    return target


def _block_end(text: str, open_brace: int) -> int:
    depth = 0
    for index in range(open_brace, len(text)):
        char = text[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index + 1
    raise NoTradeUpsLocation("unclosed server block")


def _server_spans(text: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    for match in re.finditer(r"(^|\n)[ \t]*server\s*\{", text):
        brace = text.find("{", match.start())
        spans.append((match.start(), _block_end(text, brace)))
    if not spans:
        return [(0, len(text))]
    return spans


def _trade_ups_at(text: str) -> int | None:
    for match in LOCATION_RE.finditer(text):
        if "trade-ups" in match.group("uri"):
            return match.start()
    return None


def _rewrite_block(indent: str) -> str:
    return (
        f"{indent}# {MARKER}\n"
        f"{indent}{REWRITE}\n"
        f"{indent}# end {MARKER}\n"
    )


def patch_text(text: str) -> str:
    spans = _server_spans(text)
    inserts: list[tuple[int, str]] = []
    found = False
    for start, end in spans:
        block = text[start:end]
        at = _trade_ups_at(block)
        if at is None:
            continue
        found = True
        if MARKER in block:
            continue
        absolute = start + at
        line_start = text.rfind("\n", 0, absolute) + 1
        indent_match = re.match(r"[ \t]*", text[line_start:absolute])
        indent = indent_match.group(0) if indent_match else ""
        inserts.append((line_start, _rewrite_block(indent)))
    if not found:
        raise NoTradeUpsLocation("no trade-ups location")
    out = text
    for index, block in reversed(inserts):
        out = out[:index] + block + out[index:]
    return out


def iter_conf_files() -> list[Path]:
    seen: set[Path] = set()
    files: list[Path] = []
    for root in CONF_ROOTS:
        if not root.is_dir():
            continue
        for path in sorted(root.iterdir()):
            if not path.is_file() or is_backup_name(path.name):
                continue
            real = path.resolve()
            if real in seen:
                continue
            seen.add(real)
            files.append(real)
    return files


def apply_live() -> int:
    changed: list[Path] = []
    backups: list[tuple[Path, Path]] = []
    already = False
    found = False
    for path in iter_conf_files():
        text = path.read_text(encoding="utf-8", errors="replace")
        if "trade-ups" not in text and MARKER not in text:
            continue
        try:
            patched = patch_text(text)
        except NoTradeUpsLocation:
            continue
        found = True
        if patched == text:
            already = True
            continue
        backup = Path("/tmp") / f"{path.name}.bak-collection-slug"
        shutil.copy2(path, backup)
        backups.append((path, backup))
        path.write_text(patched, encoding="utf-8")
        changed.append(path)

    if not changed:
        if already or found:
            print("nginx already redirects legacy collection slugs")
            return 0
        print("no trade-ups location", file=sys.stderr)
        return 2

    test = subprocess.run(["nginx", "-t"], capture_output=True, text=True)
    if test.returncode != 0:
        for path, backup in backups:
            shutil.copy2(backup, path)
        sys.stderr.write(test.stderr)
        print("nginx -t failed; restored the previous config", file=sys.stderr)
        return 1

    reload = subprocess.run(["nginx", "-s", "reload"], capture_output=True, text=True)
    if reload.returncode != 0:
        for path, backup in backups:
            shutil.copy2(backup, path)
        subprocess.run(["nginx", "-s", "reload"], capture_output=True, text=True)
        sys.stderr.write(reload.stderr)
        print("nginx reload failed; restored the previous config", file=sys.stderr)
        return 1

    print("redirected legacy collection slugs in " + ", ".join(str(path) for path in changed))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--map", metavar="URI")
    args = parser.parse_args()
    if args.map is not None:
        target = redirect_target(args.map)
        print(target if target is not None else "none")
        return 0
    if args.apply:
        return apply_live()
    text = sys.stdin.read()
    try:
        sys.stdout.write(patch_text(text))
    except NoTradeUpsLocation as err:
        print(str(err), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
