#!/usr/bin/env bash
# Append the clipboard entry point to a pristine patched scrcpy jar. Do not use an already merged jar as input.
set -euo pipefail
: "${ANDROID_HOME:?set ANDROID_HOME}"
dir=$(cd -- "$(dirname -- "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp "${1:?input base jar}" "$tmp/base.jar"
sdk="$ANDROID_HOME/platforms/android-36/android.jar"
javac --release 8 -encoding UTF-8 -classpath "$sdk" -d "$tmp" "$dir/ClipboardImage.java"
"$ANDROID_HOME/build-tools/36.0.0/d8" --lib "$sdk" --min-api 21 --output "$tmp/combined.jar" "$tmp/base.jar" "$tmp/org/uniterm/clipboard/ClipboardImage.class"
cp "$tmp/combined.jar" "${2:?output jar}"
