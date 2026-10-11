#!/usr/bin/env bash
cd "$(dirname "$0")"
echo "Open http://127.0.0.1:4173 in your browser."
python3 -m http.server 4173 --bind 127.0.0.1
