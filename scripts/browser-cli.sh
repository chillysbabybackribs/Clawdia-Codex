#!/usr/bin/env bash
# browser-cli.sh — Lightweight wrapper for Clawdia's browser bridge.
# Gives Codex fast, clean browser commands instead of raw curl.
#
# Usage:
#   browser [--tab TAB_ID] navigate <url>
#   browser [--tab TAB_ID] page-text
#   browser [--tab TAB_ID] click <selector>
#   browser [--tab TAB_ID] type <selector> <text>
#   browser [--tab TAB_ID] query <selector>
#   browser [--tab TAB_ID] screenshot [/path/to/file.png]
#   browser tabs
#   browser back
#   browser forward
#   browser refresh

set -euo pipefail
BRIDGE="${BROWSER_BRIDGE_URL:-http://127.0.0.1:3111}"

# Parse optional --tab flag
TAB_PARAM=""
if [[ "${1:-}" == "--tab" ]]; then
  TAB_PARAM="&tabId=$2"
  shift 2
fi

cmd="${1:-help}"
shift || true

case "$cmd" in
  navigate)
    url="$1"
    curl -sf "$BRIDGE/navigate?url=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$url', safe=''))")$TAB_PARAM" 2>/dev/null \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('ok') else f'ERROR: {d.get(\"error\",\"unknown\")}')"
    ;;
  page-text|text)
    curl -sf "$BRIDGE/page-text?_=1$TAB_PARAM" 2>/dev/null \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('text','(no text)')[:4000] if d.get('ok') else f'ERROR: {d.get(\"error\",\"unknown\")}')"
    ;;
  click)
    selector="$1"
    curl -sf -X POST "$BRIDGE/click?selector=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$selector', safe=''))")$TAB_PARAM" 2>/dev/null \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('ok') else f'ERROR: {d.get(\"error\",\"unknown\")}')"
    ;;
  type)
    selector="$1"; shift
    text="$*"
    curl -sf -X POST "$BRIDGE/type?selector=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$selector', safe=''))")&text=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$text', safe=''))")$TAB_PARAM" 2>/dev/null \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('ok') else f'ERROR: {d.get(\"error\",\"unknown\")}')"
    ;;
  query)
    selector="$1"
    curl -sf "$BRIDGE/query?selector=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$selector', safe=''))")$TAB_PARAM" 2>/dev/null \
      | python3 -c "
import sys,json
d=json.load(sys.stdin)
if not d.get('ok'): print(f'ERROR: {d.get(\"error\",\"unknown\")}'); sys.exit(0)
for el in d.get('data',{}).get('elements',[])[:20]:
    tag=el.get('tag','?')
    txt=el.get('text','').strip()[:80]
    attrs=' '.join(f'{k}=\"{v}\"' for k,v in list(el.get('attributes',{}).items())[:3])
    print(f'<{tag} {attrs}> {txt}')
"
    ;;
  screenshot)
    path="${1:-/tmp/browser-screenshot.png}"
    curl -sf "$BRIDGE/screenshot?path=$path$TAB_PARAM" 2>/dev/null \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('path','ERROR') if d.get('ok') else f'ERROR: {d.get(\"error\",\"unknown\")}')"
    ;;
  tabs)
    curl -sf "$BRIDGE/tabs" 2>/dev/null \
      | python3 -c "
import sys,json
d=json.load(sys.stdin)
if not d.get('ok'): print(f'ERROR: {d.get(\"error\",\"unknown\")}'); sys.exit(0)
for t in d.get('data',{}).get('tabs',[]):
    active='*' if t.get('active') else ' '
    print(f'{active} [{t.get(\"id\",\"?\")}] {t.get(\"title\",\"\")} — {t.get(\"url\",\"\")}')
"
    ;;
  back)
    curl -sf "$BRIDGE/back" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('ok') else f'ERROR: {d.get(\"error\",\"unknown\")}')"
    ;;
  forward)
    curl -sf "$BRIDGE/forward" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('ok') else f'ERROR: {d.get(\"error\",\"unknown\")}')"
    ;;
  refresh)
    curl -sf "$BRIDGE/refresh" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('ok') else f'ERROR: {d.get(\"error\",\"unknown\")}')"
    ;;
  help|*)
    echo "Usage: browser [--tab TAB_ID] <command> [args]"
    echo "  navigate <url>      — Go to URL"
    echo "  page-text           — Get visible page text"
    echo "  click <selector>    — Click element"
    echo "  type <sel> <text>   — Type into input"
    echo "  query <selector>    — List matching elements"
    echo "  screenshot [path]   — Capture page"
    echo "  tabs                — List tabs"
    echo "  back/forward/refresh"
    echo ""
    echo "Options:"
    echo "  --tab TAB_ID        — Target a specific tab (default: active tab)"
    ;;
esac
