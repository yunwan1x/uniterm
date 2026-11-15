#!/bin/sh
set -eu

: "${IRONRDP_CHECKOUT:?Set IRONRDP_CHECKOUT to the patched IronRDP checkout}"
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/uniterm-gpu-bridge.XXXXXX")
trap 'rm -rf -- "$fixture_dir"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$(wasm-bindgen --version)" != 'wasm-bindgen 0.2.129' ]; then
    echo 'wasm-bindgen 0.2.129 is required by the locked fixture' >&2
    exit 1
fi

python3 - "$script_dir" "$fixture_dir" "$IRONRDP_CHECKOUT" <<'PY'
import hashlib
import json
import shutil
import sys
from pathlib import Path

scripts, fixture, checkout = (Path(value).resolve() for value in sys.argv[1:])
gpu = checkout / "crates/ironrdp-web/src/gpu.rs"
crates = ("ironrdp-egfx", "ironrdp-pdu", "ironrdp-core", "ironrdp-dvc", "ironrdp-graphics")
for source in (gpu, *(checkout / "crates" / crate / "Cargo.toml" for crate in crates)):
    if not source.is_file():
        raise SystemExit(f"Missing IronRDP source: {source}")
(fixture / "src").mkdir()
shutil.copyfile(scripts / "src/lib.rs", fixture / "src/lib.rs")
shutil.copyfile(gpu, fixture / "src/gpu.rs")
shutil.copyfile(scripts / "Cargo.lock", fixture / "Cargo.lock")
manifest = '''[package]
name = "uniterm-gpu-copy-test"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[workspace]

[dependencies]
'''
for crate in crates:
    manifest += f'{crate} = {{ path = {json.dumps(str(checkout / "crates" / crate))} }}\n'
manifest += 'js-sys = "=0.3.106"\nwasm-bindgen = "=0.2.129"\n'
(fixture / "Cargo.toml").write_text(manifest)
print(f"GPU source: {gpu}", file=sys.stderr)
print(f"GPU SHA256: {hashlib.sha256((fixture / 'src/gpu.rs').read_bytes()).hexdigest()}", file=sys.stderr)
PY

# Resolve a shared cache before changing directory; source files stay untouched.
CARGO_TARGET_DIR=$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve())' "${CARGO_TARGET_DIR:-$fixture_dir/target}")
export CARGO_TARGET_DIR
cd "$fixture_dir"
cargo build --offline --locked --target wasm32-unknown-unknown --release -j "${GPU_BRIDGE_BUILD_JOBS:-2}"
wasm-bindgen "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/uniterm_gpu_copy_test.wasm" \
    --target nodejs --out-dir "$fixture_dir/pkg" --out-name uniterm_gpu_copy_test
node "$script_dir/test.cjs" "$fixture_dir/pkg/uniterm_gpu_copy_test.js"
