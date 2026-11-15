#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
build_dir=${IRONRDP_BUILD_DIR:-$(mktemp -d)}
toolchain=${RUST_TOOLCHAIN:-stable}
commit=905c28b3a4e67b15fac274c5d808ef3cef0eb813
if [[ ${CARGO_ENCODED_RUSTFLAGS+x} ]]; then
  echo 'Use RUSTFLAGS instead of CARGO_ENCODED_RUSTFLAGS for this dual-artifact build' >&2
  exit 1
fi
if [[ ! -e "$build_dir/.git" ]]; then
  git clone --filter=blob:none --no-checkout https://github.com/Devolutions/IronRDP.git "$build_dir"
fi
build_dir=$(cd "$build_dir" && pwd)
checkout_status=$(git -C "$build_dir" status --porcelain)
if [[ -n "$checkout_status" ]]; then
  echo 'IRONRDP_BUILD_DIR must be a clean checkout without the uniTerm patch' >&2
  exit 1
fi
for output in pkg pkg-scalar pkg-simd; do
  if [[ -e "$build_dir/$output" || -L "$build_dir/$output" ]]; then
    echo "Refusing existing build output: $build_dir/$output" >&2
    exit 1
  fi
done
git -C "$build_dir" checkout --detach "$commit"
git -C "$build_dir" apply "$root/tools/ironrdp/patches/uniterm.patch"
rustup target add wasm32-unknown-unknown --toolchain "$toolchain"
npm --prefix "$root/tools/ironrdp" ci --include=dev --ignore-scripts --no-audit --no-fund
cd "$build_dir"
scalar_target=${CARGO_TARGET_DIR:-"$build_dir/target"}
simd_target=${IRONRDP_SIMD_TARGET_DIR:-"$build_dir/target-simd"}
# RUSTFLAGS overrides the checkout's target-specific configuration, so retain
# its JavaScript randomness backend explicitly in both builds.
base_flags="--cfg getrandom_backend=\"wasm_js\" ${RUSTFLAGS:-}"
CARGO_TARGET_DIR="$scalar_target" RUSTFLAGS="$base_flags" \
  cargo "+$toolchain" build --locked -p ironrdp-web --target wasm32-unknown-unknown --release
# The CLI version must match wasm-bindgen in the pinned Cargo.lock (0.2.129).
wasm-bindgen "$scalar_target/wasm32-unknown-unknown/release/ironrdp_web.wasm" \
  --target web --out-dir pkg-scalar --out-name ironrdp
CARGO_TARGET_DIR="$simd_target" RUSTFLAGS="$base_flags -C target-feature=+simd128" \
  cargo "+$toolchain" build --locked -p ironrdp-web --target wasm32-unknown-unknown --release
wasm-bindgen "$simd_target/wasm32-unknown-unknown/release/ironrdp_web.wasm" \
  --target web --out-dir pkg-simd --out-name ironrdp
cp LICENSE-* pkg-scalar/
cp LICENSE-* pkg-simd/
# Packaging rejects divergent bindings or ABI, a SIMD scalar fallback, and
# relaxed SIMD before creating a shared JavaScript entry point.
node "$root/tools/ironrdp/package.mjs" "$build_dir/pkg-scalar" "$build_dir/pkg-simd" "$build_dir/pkg"
cd pkg
npm pack --ignore-scripts --pack-destination "$root/frontend/vendor"
