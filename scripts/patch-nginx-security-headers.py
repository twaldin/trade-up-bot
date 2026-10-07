#!/usr/bin/env python3
"""Give static HTML its own CSP, HSTS, and Referrer-Policy.

Helmet owns those headers, plus X-Content-Type-Options and X-Frame-Options,
on proxy_pass responses. nginx used to add the last four at server scope, so
every API and Node HTML response sent them twice. Static `/` never inherited
them, because its location sets Cache-Control and nginx drops parent
add_header lines when a block has its own.

This removes the five header names everywhere, then writes one copy into each
non-proxied location that serves index.html (or is exactly `/`).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONF_ROOTS = (
    Path("/etc/nginx/sites-enabled"),
    Path("/etc/nginx/sites-available"),
    Path("/etc/nginx/conf.d"),
)
SKIP_SUFFIXES = (".bak", ".save", ".orig", ".old", "~", ".dpkg-old", ".dpkg-dist", ".rpmnew", ".rpmsave")
# Dated or tagged backups such as tradeup.bak-20260518220608 or tradeup.bak.1.
BACKUP_NAME_RE = re.compile(r"\.(?:bak|backup|orig|old|save)(?:[-._]|$)", re.I)


def is_backup_name(name: str) -> bool:
    """True for editor/package/manual backup copies that nginx never loads."""
    return name.endswith(SKIP_SUFFIXES) or bool(BACKUP_NAME_RE.search(name))
HEADER_NAMES = (
    "Content-Security-Policy",
    "Referrer-Policy",
    "Strict-Transport-Security",
    "X-Content-Type-Options",
    "X-Frame-Options",
)
LOCATION_RE = re.compile(
    r"location\s+(?P<mod>=|~\*|~|\^~)?\s*(?P<uri>[^{]+?)\{",
    re.M,
)
# One line per directive. Values are quoted and may contain semicolons (HSTS, CSP).
ADD_HEADER_RE = re.compile(
    r"^[ \t]*add_header\s+(?:" + "|".join(HEADER_NAMES) + r")\b[^\n]*\n?",
    re.I | re.M,
)
MARKER_RE = re.compile(
    r"^[ \t]*# (?:end )?tub-static-security-headers[ \t]*\n?",
    re.M,
)


class NoStaticHtmlLocation(Exception):
    pass


def load_headers() -> dict[str, str]:
    raw = os.environ.get("NGINX_SECURITY_HEADERS_JSON")
    if not raw:
        proc = subprocess.run(
            ["npx", "tsx", "scripts/print-static-security-headers.ts"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            sys.stderr.write(proc.stderr)
            raise SystemExit(proc.returncode or 1)
        raw = proc.stdout
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise SystemExit("security header JSON must be an object")
    headers: dict[str, str] = {}
    for name in HEADER_NAMES:
        value = data.get(name)
        if not isinstance(value, str) or not value.strip():
            raise SystemExit(f"missing {name}")
        if "\n" in value or "\r" in value:
            raise SystemExit(f"{name} must be one line")
        headers[name] = value
    return headers


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
    raise NoStaticHtmlLocation("unclosed location block")


def _serves_static_html(mod: str, uri: str, body: str) -> bool:
    if re.search(r"\bproxy_pass\b", body):
        return False
    cleaned = uri.strip().strip("\"'")
    if "try_files" in body and "index.html" in body:
        return True
    return (mod == "=" and cleaned == "/") or (mod in ("", "^~") and cleaned == "/")


def _indent(body: str) -> str:
    for line in body.splitlines():
        if line.strip():
            match = re.match(r"[ \t]*", line)
            return match.group(0) if match else "        "
    return "        "


def _header_block(headers: dict[str, str], indent: str) -> str:
    lines = [f"{indent}# tub-static-security-headers"]
    for name in HEADER_NAMES:
        value = headers[name].replace("\\", "\\\\").replace('"', '\\"')
        lines.append(f'{indent}add_header {name} "{value}" always;')
    lines.append(f"{indent}# end tub-static-security-headers")
    return "\n".join(lines) + "\n"


def patch_text(text: str, headers: dict[str, str]) -> str:
    stripped = MARKER_RE.sub("", ADD_HEADER_RE.sub("", text))
    inserts: list[tuple[int, str]] = []
    for match in LOCATION_RE.finditer(stripped):
        end = _block_end(stripped, match.end() - 1)
        body = stripped[match.end() : end - 1]
        mod = match.group("mod") or ""
        if not _serves_static_html(mod, match.group("uri"), body):
            continue
        close = end - 1
        line_start = stripped.rfind("\n", 0, close) + 1
        inserts.append((line_start, _header_block(headers, _indent(body))))
    if not inserts:
        raise NoStaticHtmlLocation("no static HTML location found")
    out = stripped
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


def apply_live(headers: dict[str, str]) -> int:
    changed: list[Path] = []
    backups: list[tuple[Path, Path]] = []
    already = False
    found = False
    for path in iter_conf_files():
        text = path.read_text(encoding="utf-8", errors="replace")
        if "location" not in text:
            continue
        try:
            patched = patch_text(text, headers)
        except NoStaticHtmlLocation:
            continue
        found = True
        if patched == text:
            already = True
            continue
        backup = Path("/tmp") / f"{path.name}.bak-security-headers"
        shutil.copy2(path, backup)
        backups.append((path, backup))
        path.write_text(patched, encoding="utf-8")
        changed.append(path)

    if not changed:
        if already:
            print("nginx static HTML security headers already set")
            return 0
        if not found:
            print("no static HTML location found", file=sys.stderr)
            return 2
        print("nginx static HTML security headers already set")
        return 0

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

    print("set static HTML security headers in " + ", ".join(str(path) for path in changed))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    headers = load_headers()
    if args.apply:
        return apply_live(headers)
    text = sys.stdin.read()
    try:
        sys.stdout.write(patch_text(text, headers))
    except NoStaticHtmlLocation as err:
        print(str(err), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
