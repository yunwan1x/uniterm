import init from './ironrdp.js';

export * from './ironrdp.js';

// (module (func (result v128) i32.const 0 i8x16.splat))
// Validate before fetching either artifact. No SIMD code executes in this probe.
const SIMD_PROBE = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0,
    1, 5, 1, 96, 0, 1, 123,
    3, 2, 1, 0,
    10, 8, 1, 6, 0, 65, 0, 253, 15, 11,
]);
let supportsSimd;

export default function initialize(input) {
    // Preserve wasm-bindgen's explicit input and initSync contracts unchanged.
    if (input !== undefined) return init(input);

    supportsSimd ??= typeof WebAssembly === 'object'
        && typeof WebAssembly.validate === 'function'
        && WebAssembly.validate(SIMD_PROBE);

    // Keep both literal URLs visible to bundlers, including Worker builds.
    const module_or_path = supportsSimd
        ? new URL('ironrdp_simd_bg.wasm', import.meta.url)
        : new URL('ironrdp_bg.wasm', import.meta.url);
    return init({ module_or_path });
}
