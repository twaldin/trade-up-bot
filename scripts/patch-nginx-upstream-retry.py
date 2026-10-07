#!/usr/bin/env python3
"""Give nginx a warm backup for the API during a fork-to-cluster handoff.

A single upstream cannot retry a refused connection. POST /api/calculator is
non-idempotent, so nginx will not follow proxy_next_upstream unless
non_idempotent is set. The backup on 3002 is unused while 3001 accepts
connections (max_fails=0). proxy_read_timeout is left alone: calculator
requests are allowed to run long.
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
SKIP_SUFFIXES = (".bak", ".save", ".dpkg-old", ".dpkg-dist", ".rpmnew", ".rpmsave")

UPSTREAM = """upstream tradeup_api {
    server 127.0.0.1:3001 max_fails=0;
    server 127.0.0.1:3002 backup;
}
"""

RETRY_LINES = (
    "proxy_next_upstream error timeout http_502 http_503 non_idempotent;",
    "proxy_next_upstream_tries 2;",
    "proxy_next_upstream_timeout 3s;",
    "proxy_connect_timeout 1s;",
)

LOCATION_RE = re.compile(
    r"location\s+(?P<mod>=|~\*|~|\^~)?\s*(?P<uri>[^{]+?)\{",
    re.M,
)
PROXY_PASS_RE = re.compile(r"proxy_pass\s+http://127\.0\.0\.1:3001\s*;")
SERVER_RE = re.compile(r"^[ \t]*server\s*\{", re.M)


class NoApiProxy(Exception):
    pass


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
    raise NoApiProxy("unclosed location block")


def _insert_upstream(text: str) -> str:
    if "upstream tradeup_api" in text:
        return text
    match = SERVER_RE.search(text)
    if match is None:
        return UPSTREAM + "\n" + text
    return text[: match.start()] + UPSTREAM + "\n" + text[match.start() :]


def _insert_retries(text: str) -> str:
    parts: list[str] = []
    cursor = 0
    for match in LOCATION_RE.finditer(text):
        open_brace = match.end() - 1
        end = _block_end(text, open_brace)
        block = text[match.start() : end]
        parts.append(text[cursor : match.start()])
        if "proxy_pass http://tradeup_api;" in block and "proxy_next_upstream " not in block:
            pass_match = re.search(r"^([ \t]*)proxy_pass http://tradeup_api;", block, re.M)
            indent = pass_match.group(1) if pass_match else "        "
            lines = "\n".join(indent + line for line in RETRY_LINES)
            close = block.rfind("}")
            block = block[:close] + lines + "\n" + block[close:]
        parts.append(block)
        cursor = end
    parts.append(text[cursor:])
    return "".join(parts)


def patch_text(text: str) -> str:
    if "proxy_pass http://127.0.0.1:3001" not in text and "upstream tradeup_api" not in text:
        raise NoApiProxy("no proxy_pass http://127.0.0.1:3001 and no upstream tradeup_api")
    rewritten = PROXY_PASS_RE.sub("proxy_pass http://tradeup_api;", text)
    rewritten = _insert_upstream(rewritten)
    return _insert_retries(rewritten)


def iter_conf_files() -> list[Path]:
    seen: set[Path] = set()
    files: list[Path] = []
    for root in CONF_ROOTS:
        if not root.is_dir():
            continue
        for path in sorted(root.iterdir()):
            if not path.is_file() or path.name.endswith(SKIP_SUFFIXES):
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
    for path in iter_conf_files():
        text = path.read_text(encoding="utf-8", errors="replace")
        if "127.0.0.1:3001" not in text and "tradeup_api" not in text:
            continue
        try:
            patched = patch_text(text)
        except NoApiProxy:
            continue
        if patched == text:
            already = True
            continue
        backup = Path("/tmp") / f"{path.name}.bak-upstream-retry"
        shutil.copy2(path, backup)
        backups.append((path, backup))
        path.write_text(patched, encoding="utf-8")
        changed.append(path)

    if not changed:
        if already:
            print("nginx already retries the tradeup_api upstream")
            return 0
        print("no proxy_pass http://127.0.0.1:3001 to patch", file=sys.stderr)
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

    print("patched tradeup_api upstream via " + ", ".join(str(path) for path in changed))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.apply:
        return apply_live()
    text = sys.stdin.read()
    try:
        sys.stdout.write(patch_text(text))
    except NoApiProxy as err:
        print(str(err), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
