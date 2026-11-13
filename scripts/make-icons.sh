#!/bin/sh
# Từ build/icon.png (1024) sinh: build/icon.icns (macOS), build/icon.ico (Windows), shared/logo.png, shared/favicon.png
# Cần: ImageMagick (magick) và iconutil (có sẵn trên macOS)
set -e
cd "$(dirname "$0")/.."
SET=$(mktemp -d)/icon.iconset
mkdir -p "$SET"
for s in 16 32 128 256 512; do
  magick build/icon.png -resize ${s}x${s} "$SET/icon_${s}x${s}.png"
  magick build/icon.png -resize $((s*2))x$((s*2)) "$SET/icon_${s}x${s}@2x.png"
done
iconutil -c icns "$SET" -o build/icon.icns
magick build/icon.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico
magick build/icon.png -resize 256x256 shared/logo.png
magick build/icon.png -resize 64x64 shared/favicon.png
echo "icons ok"
