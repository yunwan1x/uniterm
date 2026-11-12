#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
build_dir=${IRONRDP_BUILD_DIR:-$(mktemp -d)}
toolchain=${RUST_TOOLCHAIN:-stable}
commit=905c28b3a4e67b15fac274c5d808ef3cef0eb813
if [[ ! -d "$build_dir/.git" ]]; then
  git clone --filter=blob:none --no-checkout https://github.com/Devolutions/IronRDP.git "$build_dir"
fi
git -C "$build_dir" checkout --detach "$commit"
git -C "$build_dir" apply "$root/tools/ironrdp/patches/uniterm.patch"
rustup target add wasm32-unknown-unknown --toolchain "$toolchain"
cd "$build_dir"
cargo "+$toolchain" build --locked -p ironrdp-web --target wasm32-unknown-unknown --release
# The CLI version must match wasm-bindgen in the pinned Cargo.lock (0.2.129).
wasm-bindgen target/wasm32-unknown-unknown/release/ironrdp_web.wasm --target web --out-dir pkg --out-name ironrdp
cp LICENSE-* pkg/
node "$root/tools/ironrdp/package.mjs" "$build_dir/pkg"
cd pkg
npm pack --pack-destination "$root/frontend/vendor"
