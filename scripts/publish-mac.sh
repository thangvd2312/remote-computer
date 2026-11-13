#!/bin/sh
# Build bản macOS (arm64 + x64, ký bằng chứng chỉ "Thang Vu Van") và đính kèm vào GitHub Release v<version>.
# Cần: gh (đã đăng nhập), chứng chỉ ký trong Keychain.
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p 'require("./package.json").version')
TAG="v$VERSION"

rm -rf dist
npx electron-builder --mac --publish never

if ! gh release view "$TAG" >/dev/null 2>&1; then
  echo "Release $TAG chưa có -> tạo mới"
  gh release create "$TAG" --title "Remote Computer $TAG" --generate-notes
fi
gh release upload "$TAG" dist/Remote-Computer-"$VERSION"-mac-*.dmg --clobber
echo "✔ Đã đính kèm bản macOS vào $TAG: $(gh release view "$TAG" --json url --jq .url)"
