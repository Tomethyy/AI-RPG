#!/usr/bin/env python3
"""Stamp the build into index.html, style.css and app.js. Run before every commit that gets deployed.

The version is 1.<commit count + 1>; the time is UTC and shown in local time by the app (More sheet).
"""
import re, subprocess, datetime, pathlib

root = pathlib.Path(__file__).parent
count = int(subprocess.check_output(["git", "rev-list", "--count", "HEAD"], cwd=root).decode())
ver = f"1.{count + 1}"
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")

def sub(name, pattern, repl):
    p = root / name
    text = p.read_text()
    new, n = re.subn(pattern, repl, text)
    assert n, f"{name}: {pattern} not found"
    p.write_text(new)

sub("index.html", r'<meta name="build" content="[^"]*">', f'<meta name="build" content="{ver}|{now}">')
sub("index.html", r'(style\.css|app\.js|manifest\.webmanifest)\?v=[^"]*', rf'\1?v={ver}')
sub("style.css", r'--build: "[^"]*";', f'--build: "{ver}";')
sub("app.js", r'const JS_BUILD = "[^"]*";', f'const JS_BUILD = "{ver}";')
print("stamped", ver, now)
