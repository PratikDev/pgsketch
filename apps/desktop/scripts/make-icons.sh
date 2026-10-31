#!/usr/bin/env bash
# Makes the icon sizes the desktop themes look for (hicolor stops at 512) from build/icon.png,
# which stays the source and the window's icon. Needs ffmpeg. Run it again after changing the icon.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/icons
for size in 16 32 48 64 128 256 512; do
  ffmpeg -v error -y -i build/icon.png -vf "scale=$size:$size:flags=lanczos" "build/icons/${size}x${size}.png"
done
