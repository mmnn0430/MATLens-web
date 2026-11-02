#!/usr/bin/env bash
# Render Native Build Script
set -e

echo "=== 1. Building Frontend ==="
cd frontend
npm install
npm run build
cd ..

echo "=== 2. Installing Backend Dependencies ==="
pip install --upgrade pip
pip install -r backend/requirements.txt

echo "=== Build Complete ==="
