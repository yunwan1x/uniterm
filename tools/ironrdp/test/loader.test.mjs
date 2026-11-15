import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const stub = `
export const calls = [];
export const syncCalls = [];
export const namedValue = {};
let result = Promise.resolve({ initialized: true });
let exception;
export function setResult(value) { result = value; }
export function setException(value) { exception = value; }
export function initSync(input) { syncCalls.push(input); return namedValue; }
export default function initialize(input) {
    calls.push(input);
    if (exception) throw exception;
    return result;
}
`;
async function fixture(t, validate) {
    const directory = await mkdtemp(join(tmpdir(), 'ironrdp-loader-'));
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await writeFile(join(directory, 'index.js'), source);
    await writeFile(join(directory, 'ironrdp.js'), stub);
    const original = globalThis.WebAssembly;
    if (validate) globalThis.WebAssembly = { validate };
    t.after(async () => { globalThis.WebAssembly = original; await rm(directory, { recursive: true, force: true }); });
    return { directory, module: await import(pathToFileURL(join(directory, 'index.js'))) };
}

for (const supported of [false, true]) {
    test(`default initialization selects ${supported ? 'SIMD' : 'scalar'} once`, async t => {
        let probes = 0;
        const realValidate = WebAssembly.validate;
        const { module, directory } = await fixture(t, bytes => {
            probes++;
            assert.equal(realValidate(bytes), true, 'probe itself is valid fixed-width SIMD');
            const probe = new WebAssemblyOriginal.Module(bytes);
            assert.deepEqual(WebAssemblyOriginal.Module.imports(probe), []);
            assert.deepEqual(WebAssemblyOriginal.Module.exports(probe), []);
            return supported;
        });
        await module.default(); await module.default(undefined);
        assert.equal(probes, 1);
        assert.equal(module.calls.length, 2);
        const filename = supported ? 'ironrdp_simd_bg.wasm' : 'ironrdp_bg.wasm';
        for (const input of module.calls) assert.equal(input.module_or_path.href, pathToFileURL(join(directory, filename)).href);
    });
}
const WebAssemblyOriginal = globalThis.WebAssembly;

test('explicit async inputs retain identity and bypass capability detection', async t => {
    const { module } = await fixture(t, () => { throw new Error('Explicit input must not probe'); });
    const inputs = [new URL('https://example.invalid/custom.wasm'), 'custom.wasm', new Uint8Array([0]),
        new Response(new Uint8Array([0])), Promise.resolve(new Uint8Array([0])),
        new WebAssemblyOriginal.Module(new Uint8Array([0,97,115,109,1,0,0,0])),
        { module_or_path: 'custom.wasm' }, {}, null];
    for (const input of inputs) { await module.default(input); assert.equal(module.calls.at(-1), input); }
});

test('named exports and initSync are the original bindings', async t => {
    const { module, directory } = await fixture(t, () => { throw new Error('initSync must not probe'); });
    const raw = await import(pathToFileURL(join(directory, 'ironrdp.js')));
    assert.equal(module.initSync, raw.initSync); assert.equal(module.namedValue, raw.namedValue);
    const input = { module: new Uint8Array([0]) };
    assert.equal(module.initSync(input), raw.namedValue);
    assert.equal(module.syncCalls[0], input); assert.equal(module.calls.length, 0);
});

test('initialization rejection propagates without retry or scalar fetch', async t => {
    const { module } = await fixture(t, () => true);
    const error = new TypeError('network/MIME/link/initialization failure');
    const rejection = Promise.reject(error);
    module.setResult(rejection);
    const actual = module.default();
    assert.equal(actual, rejection);
    await assert.rejects(actual, e => e === error);
    assert.equal(module.calls.length, 1);
    assert.match(module.calls[0].module_or_path.pathname, /ironrdp_simd_bg\.wasm$/);
});

test('synchronous initializer errors preserve identity with one call', async t => {
    const { module } = await fixture(t, () => true);
    const error = new Error('original synchronous error'); module.setException(error);
    assert.throws(() => module.default(), e => e === error); assert.equal(module.calls.length, 1);
});

for (const supported of [false, true]) {
    test(`same entry selects ${supported ? 'SIMD' : 'scalar'} inside a Worker`, async t => {
        const { directory } = await fixture(t);
        const workerPath = join(directory, 'worker.mjs');
        await writeFile(workerPath, `
            import { parentPort } from 'node:worker_threads';
            WebAssembly.validate = () => ${supported};
            const module = await import('./index.js');
            await module.default();
            parentPort.postMessage(module.calls.map(input => input.module_or_path.href));
        `);
        const worker = new Worker(pathToFileURL(workerPath)); t.after(() => worker.terminate());
        const paths = await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
        assert.deepEqual(paths, [pathToFileURL(join(directory, supported ? 'ironrdp_simd_bg.wasm' : 'ironrdp_bg.wasm')).href]);
    });
}
