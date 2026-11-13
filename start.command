#!/bin/bash
# Double-click to get the latest version and open Planet Maps.
cd "$(dirname "$0")"
echo "Getting the latest version..."
git pull --ff-only --quiet
echo "Checking dependencies..."
node tools/install-if-needed.mjs
echo "Starting Planet Maps (close this window to stop it)..."
npm run dev
