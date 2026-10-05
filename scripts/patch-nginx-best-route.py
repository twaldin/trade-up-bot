#!/usr/bin/env python3
"""Proxy /best-cs2-trade-ups through the same nginx rule as /calculator.

Live tradeupbot.app sends /calculator and /trade-ups to Node (Express CSP,
charset=utf-8). /best-cs2-trade-ups is not in that set, so the SPA fallback
serves dist/index.html — the homepage — for every user agent.

This extends the existing calculator proxy. It does not add a second router.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROUTE = "best-cs2-trade-ups"
CONF_ROOTS = (
    Path("/etc/nginx/sites-enabled"),
    Path("/etc/nginx/sites-available"),
    Path("/etc/nginx/conf.d"),
)
SKIP_SUFFIXES = (".bak", ".save", ".dpkg-old", ".dpkg-dist", ".rpmnew", ".rpmsave")

LOCATION_RE = re.compile(
    r"location\s+(?P<mod>=|~\*|~|\^~)?\s*(?P<uri>[^{]+?)\{",
    re.M,
)
ALTERNATION_RE = re.compile(r"([(|])(\s*)calculator(\s*)(?=[|)])")
SOLO_RE = re.compile(r"\^/calculator(?=\(|/|\$)")


class NoProxyLocation(Exception):
    pass


def route_is_proxied(text: str) -> bool:
    for match in LOCATION_RE.finditer(text):
        if ROUTE in match.group("uri"):
            return True
    return False


def _patch_uri(uri: str) -> str | None:
    if ROUTE in uri or "calculator" not in uri:
        return None
    updated, count = ALTERNATION_RE.subn(rf"\1\2calculator|{ROUTE}\3", uri, count=1)
    if count:
        return updated
    updated, count = SOLO_RE.subn(rf"^/(?:calculator|{ROUTE})", uri, count=1)
    if count:
        return updated
    return None


def _patch_regex_locations(text: str) -> str | None:
    match = None
    for candidate in LOCATION_RE.finditer(text):
        mod = candidate.group("mod") or ""
        if not mod.startswith("~"):
            continue
        if _patch_uri(candidate.group("uri")) is not None:
            match = candidate
            break
    if match is None:
        return None
    uri = match.group("uri")
    return text[: match.start("uri")] + _patch_uri(uri) + text[match.end("uri") :]


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
    raise NoProxyLocation("unclosed location block")


def _clone_exact_locations(text: str) -> str | None:
    inserts: list[tuple[int, str]] = []
    for match in LOCATION_RE.finditer(text):
        mod = match.group("mod") or ""
        uri = match.group("uri").strip().strip("\"'")
        if not ((mod == "=" and uri == "/calculator") or (mod in ("", "^~") and uri == "/calculator/")):
            continue
        end = _block_end(text, match.end() - 1)
        block = text[match.start() : end]
        cloned = block.replace("/calculator", "/best-cs2-trade-ups", 1)
        inserts.append((end, "\n" + cloned))
    if not inserts:
        return None
    out = text
    for end, cloned in reversed(inserts):
        out = out[:end] + cloned + out[end:]
    return out


def patch_text(text: str) -> str:
    if route_is_proxied(text):
        return text
    regex_patched = _patch_regex_locations(text)
    if regex_patched is not None:
        return regex_patched
    exact_patched = _clone_exact_locations(text)
    if exact_patched is not None:
        return exact_patched
    raise NoProxyLocation("no calculator proxy location found")


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
        if "calculator" not in text and ROUTE not in text:
            continue
        try:
            patched = patch_text(text)
        except NoProxyLocation:
            continue
        if patched == text:
            already = True
            continue
        backup = Path("/tmp") / f"{path.name}.bak-best-route"
        shutil.copy2(path, backup)
        backups.append((path, backup))
        path.write_text(patched, encoding="utf-8")
        changed.append(path)

    if not changed:
        if already:
            print("nginx already proxies /best-cs2-trade-ups")
            return 0
        print("no calculator proxy location to extend", file=sys.stderr)
        for path in iter_conf_files():
            text = path.read_text(encoding="utf-8", errors="replace")
            for match in LOCATION_RE.finditer(text):
                if "calculator" in match.group(0) or "trade-ups" in match.group(0):
                    print(f"{path}: {match.group(0).strip()}", file=sys.stderr)
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

    print("proxied /best-cs2-trade-ups via " + ", ".join(str(path) for path in changed))
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
    except NoProxyLocation as err:
        print(str(err), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
