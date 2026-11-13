#!/usr/bin/env bash
# Screenshot of the running app with the snap Chromium on this machine. Usage: scripts/shot.sh <name> [path] [width] [height]
cd "$(dirname "$0")/.."
mkdir -p run/shots
timeout 60 /snap/bin/chromium --headless=new --no-sandbox --hide-scrollbars --window-size="${3:-1440},${4:-1500}" --virtual-time-budget=6000 --screenshot="$PWD/run/shots/$1.png" "http://127.0.0.1:$(cat run/port)${2:-/}" 2>&1 | grep 'bytes written'
