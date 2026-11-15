import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import wabtFactory from 'wabt';
import { normalizeGlue, verifyPackages } from '../verify-dual-package.mjs';
import { readAbi } from '../wasm-abi.mjs';
import { packageDual } from '../package.mjs';

const wabt = await wabtFactory();
function binary({ simd = false, imported = 'f64', returned = 'i32', memoryMax = 4,
    tableMax = 4, mutable = true, name = 'run', hidden = false } = {}) {
    const wat = `(module
        (import "env" "callback" (func (param ${imported})))
        (memory (export "memory") 1 ${memoryMax})
        (table (export "table") 1 ${tableMax} funcref)
        (global (export "global") ${mutable ? '(mut i32)' : 'i32'} (i32.const 0))
        ${hidden ? '(func (param f32) (result f64) f64.const 1)' : ''}
        (func (export "${name}") (param i32) (result ${returned})
            ${simd ? 'v128.const i32x4 0 0 0 0 drop' : 'i32.const 0 drop'}
            ${returned}.const 1))`;
    const module = wabt.parseWat('fixture.wat', wat, { simd: true });
    try { module.resolveNames(); module.validate(); return Buffer.from(module.toBinary({}).buffer); }
    finally { module.destroy(); }
}
async function fixture(t) {
    const directory = await mkdtemp(join(tmpdir(), 'ironrdp-guard-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const scalar = join(directory, 'scalar'), simd = join(directory, 'simd');
    for (const [path, vector] of [[scalar, false], [simd, true]]) {
        await mkdir(join(path, 'snippets'), { recursive: true });
        await writeFile(join(path, 'ironrdp.js'), `// Cast intrinsic for Closure { shim_idx: ${vector ? 9 : 4}, ret: Unit }\nexport const value = 1;\n`);
        await writeFile(join(path, 'ironrdp.d.ts'), 'export const value: number;\n');
        await writeFile(join(path, 'ironrdp_bg.wasm.d.ts'), 'export const run: (x: number) => number;\n');
        await writeFile(join(path, 'snippets', 'helper.js'), 'export const helper = 1;\n');
        await writeFile(join(path, 'ironrdp_bg.wasm'), binary({ simd: vector }));
    }
    return { scalar, simd };
}

test('accepts matching ABI with different code, indices, and allowed comment values', async t => {
    const { scalar, simd } = await fixture(t);
    await writeFile(join(simd, 'ironrdp_bg.wasm'), binary({ simd: true, hidden: true }));
    const result = await verifyPackages(scalar, simd);
    assert.equal(result.scalarWasm.validatesWithoutSimd, true);
    assert.equal(result.simdWasm.validatesWithoutSimd, false);
    assert.deepEqual(result.abi.imports[0].type, { parameters: ['f64'], results: [] });
    assert.deepEqual(result.abi.exports.find(e => e.name === 'run').type, { parameters: ['i32'], results: ['i32'] });
});

test('normalization never ignores strings, template contents, or executable shim_idx values', () => {
    const a = 'const template = `\n// Cast intrinsic for Closure { shim_idx: 4, ret: Unit }\n`;\nconst shim_idx = 4;\n';
    assert.equal(normalizeGlue(a), a);
    assert.notEqual(normalizeGlue(a), normalizeGlue(a.replaceAll('4', '9')));
    const comment = '// Cast intrinsic for Closure { shim_idx: 4, ret: Unit }\n';
    assert.equal(normalizeGlue(comment), normalizeGlue(comment.replace('4', '9')));
    assert.notEqual(normalizeGlue(comment), normalizeGlue(comment.replace('Unit', 'F64')));
});

for (const [label, options] of [
    ['import function parameter', { imported: 'i64' }],
    ['export function result', { returned: 'f64' }],
    ['export name', { name: 'different' }],
    ['memory limits', { memoryMax: 5 }],
    ['table limits', { tableMax: 5 }],
    ['global mutability', { mutable: false }],
]) {
    test(`rejects changed ${label} although binding text is identical`, async t => {
        const { scalar, simd } = await fixture(t);
        await writeFile(join(simd, 'ironrdp_bg.wasm'), binary({ simd: true, ...options }));
        await assert.rejects(verifyPackages(scalar, simd), /external ABI mismatch/);
    });
}
for (const name of ['ironrdp.js', 'ironrdp.d.ts', 'ironrdp_bg.wasm.d.ts', 'snippets/helper.js']) {
    test(`rejects changed ${name}`, async t => {
        const { scalar, simd } = await fixture(t);
        await writeFile(join(simd, name), (await readFile(join(simd, name), 'utf8')).replace('1', '2') + '\n');
        await assert.rejects(verifyPackages(scalar, simd), /mismatch/);
    });
}
test('rejects missing snippet', async t => {
    const { scalar, simd } = await fixture(t);
    await rm(join(simd, 'snippets', 'helper.js'));
    await assert.rejects(verifyPackages(scalar, simd), /file lists differ/);
});
test('rejects SIMD instructions in scalar even with otherwise equal ABI', async t => {
    const { scalar, simd } = await fixture(t);
    await writeFile(join(scalar, 'ironrdp_bg.wasm'), binary({ simd: true }));
    await assert.rejects(verifyPackages(scalar, simd), /Scalar artifact fails SIMD-disabled/);
});
test('rejects a scalar file mislabeled as SIMD', async t => {
    const { scalar, simd } = await fixture(t);
    await writeFile(join(simd, 'ironrdp_bg.wasm'), binary());
    await assert.rejects(verifyPackages(scalar, simd), /does not require SIMD/);
});
test('rejects invalid candidate WASM', async t => {
    const { scalar, simd } = await fixture(t);
    await writeFile(join(simd, 'ironrdp_bg.wasm'), binary({ simd: true }).subarray(0, -1));
    await assert.rejects(verifyPackages(scalar, simd), /fails standard WABT/);
});
test('ABI parser rejects unknown future type forms instead of silently equating them', () => {
    const bytes = Buffer.from([0,97,115,109,1,0,0,0,1,4,1,0x5e,0x7f,0]);
    assert.throws(() => readAbi(bytes), /Unsupported non-function/);
});

test('packager produces both verified binaries and wrapper without runtime dependencies', async t => {
    const { scalar, simd } = await fixture(t);
    for (const name of ['LICENSE-APACHE', 'LICENSE-MIT']) await writeFile(join(scalar, name), 'fixture license');
    const output = join(scalar, '..', 'package');
    const result = await packageDual(scalar, simd, output);
    const manifest = JSON.parse(await readFile(join(output, 'package.json'), 'utf8'));
    assert.equal(result.version, '0.5.1-uniterm.18');
    assert.equal(manifest.main, 'index.js'); assert.equal(manifest.types, 'index.d.ts');
    assert.equal(manifest.dependencies, undefined); assert.equal(manifest.devDependencies, undefined);
    assert.equal(manifest.files.includes('build-verification.json'), false);
    assert.deepEqual(await readFile(join(output, 'ironrdp_bg.wasm')), await readFile(join(scalar, 'ironrdp_bg.wasm')));
    assert.deepEqual(await readFile(join(output, 'ironrdp_simd_bg.wasm')), await readFile(join(simd, 'ironrdp_bg.wasm')));
    assert.deepEqual(await readFile(join(output, 'index.js')), await readFile(new URL('../index.js', import.meta.url)));
    await assert.rejects(packageDual(scalar, simd, output), /already exists/);
});

test('packager refuses an ABI mismatch before creating output and refuses nested output', async t => {
    const { scalar, simd } = await fixture(t);
    const output = join(scalar, '..', 'package');
    await writeFile(join(simd, 'ironrdp_bg.wasm'), binary({ simd: true, returned: 'f64' }));
    await assert.rejects(packageDual(scalar, simd, output), /external ABI mismatch/);
    await assert.rejects(readFile(join(output, 'package.json')), { code: 'ENOENT' });
    await assert.rejects(packageDual(scalar, simd, join(scalar, 'nested')), /outside both/);
});
