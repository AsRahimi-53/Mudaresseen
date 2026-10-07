@echo off
cd /d "%~dp0"
echo Starting Madrasa Professional Development offline application...
echo Open http://127.0.0.1:4173 in your browser.
py -m http.server 4173 --bind 127.0.0.1
if errorlevel 1 python -m http.server 4173 --bind 127.0.0.1
