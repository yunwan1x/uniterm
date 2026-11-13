#!/usr/bin/env bash
# Build the pinned scrcpy server with uniTerm's runtime bitrate extension.
set -euo pipefail
: "${ANDROID_HOME:?Set ANDROID_HOME to an Android SDK with platform/build-tools 36}"
asset_dir=$(cd -- "$(dirname -- "$0")" && pwd)
work_dir=$(mktemp -d)
trap 'rm -rf -- "$work_dir"' EXIT
git clone --quiet --depth 1 --branch v3.3.4 https://github.com/Genymobile/scrcpy.git "$work_dir/source"
test "$(git -C "$work_dir/source" rev-parse HEAD)" = "fb6381f5b9bb96f3fa823d899f4c32de2ec84ab3"
git -C "$work_dir/source" apply "$asset_dir/dynamic-bitrate.patch"
BUILD_DIR="$work_dir/build" bash "$work_dir/source/server/build_without_gradle.sh"
cp "$work_dir/build/scrcpy-server" "$asset_dir/scrcpy-server-v3.3.4.jar"
sha256sum "$asset_dir/scrcpy-server-v3.3.4.jar"
