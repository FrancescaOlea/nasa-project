#!/bin/bash
# Double-click to get the latest version and open Planet Maps.
cd "$(dirname "$0")"
echo "Getting the latest version..."
git pull
echo "Installing anything new..."
npm install --no-fund --no-audit
echo "Starting Planet Maps (close this window to stop it)..."
npm run dev
