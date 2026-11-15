import { createHash } from 'node:crypto';
import { readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { parse } from 'acorn';
import { readAbi } from './wasm-abi.mjs';

const require = createRequire(import.meta.url);
const wabtPackage = require.resolve('wabt/package.json');
const wabtVersion = JSON.parse(await readFile(wabtPackage, 'utf8')).version;
if (wabtVersion !== '1.0.37') throw new Error(`Expected locked wabt 1.0.37, got ${wabtVersion}`);
const validator = join(dirname(wabtPackage), 'bin', 'wasm-validate');
const sha256 = data => createHash('sha256').update(data).digest('hex');

// Only the decimal index inside the generated Cast intrinsic comment is ignored.
// Executable tokens, other comment contents, line endings and whitespace must match.
export function normalizeGlue(text) {
    const comments = [];
    parse(text, { ecmaVersion: 'latest', sourceType: 'module', onComment: comments });
    for (const comment of comments.reverse()) {
        if (comment.type !== 'Line' || !/^ Cast intrinsic for .*\bshim_idx: \d+,/.test(comment.value)) continue;
        const original = text.slice(comment.start, comment.end);
        const normalized = original.replace(/(\bshim_idx: )\d+(,)/g, '$1<index>$2');
        text = text.slice(0, comment.start) + normalized + text.slice(comment.end);
    }
    return text;
}

async function filesBelow(directory, prefix = '') {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT' && !prefix) return []; throw error; }
    const files = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const relative = prefix + entry.name, full = join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await filesBelow(full, relative + '/'));
        else if (entry.isFile()) files.push(relative);
        else throw new Error(`Unsupported package snippet entry: ${full}`);
    }
    return files;
}
async function readRegular(path) {
    if (!(await lstat(path)).isFile()) throw new Error(`Expected regular file: ${path}`);
    return readFile(path);
}
function validate(path, disableSimd = false) {
    const result = spawnSync(process.execPath, [validator, ...(disableSimd ? ['--disable-simd'] : []), path], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    if (result.error || result.signal || result.status === null) throw result.error ?? new Error(`WABT validation terminated: ${result.signal}`);
    return { ok: result.status === 0, status: result.status, diagnostic: result.stderr.trim() };
}

export async function verifyPackages(scalarDirectory, simdDirectory) {
    const scalar = resolve(scalarDirectory), simd = resolve(simdDirectory);
    const files = {};
    for (const name of ['ironrdp.js', 'ironrdp.d.ts', 'ironrdp_bg.wasm.d.ts']) {
        const a = await readRegular(join(scalar, name)), b = await readRegular(join(simd, name));
        const equal = name.endsWith('.js') ? normalizeGlue(a.toString()) === normalizeGlue(b.toString()) : a.equals(b);
        if (!equal) throw new Error(`Dual-package glue/type mismatch: ${name}`);
        files[name] = { scalar: sha256(a), simd: sha256(b) };
    }
    const aSnippets = await filesBelow(join(scalar, 'snippets')), bSnippets = await filesBelow(join(simd, 'snippets'));
    if (JSON.stringify(aSnippets) !== JSON.stringify(bSnippets)) throw new Error('Dual-package snippet file lists differ');
    for (const name of aSnippets) {
        const a = await readRegular(join(scalar, 'snippets', name)), b = await readRegular(join(simd, 'snippets', name));
        if (!a.equals(b)) throw new Error(`Dual-package snippet mismatch: ${name}`);
        files['snippets/' + name] = { scalar: sha256(a), simd: sha256(b) };
    }
    const aPath = join(scalar, 'ironrdp_bg.wasm'), bPath = join(simd, 'ironrdp_bg.wasm');
    const a = await readRegular(aPath), b = await readRegular(bPath);
    const scalarValidation = validate(aPath, true), simdValidation = validate(bPath), simdDisabledValidation = validate(bPath, true);
    if (!scalarValidation.ok) throw new Error(`Scalar artifact fails SIMD-disabled WABT validation: ${scalarValidation.diagnostic}`);
    if (!simdValidation.ok) throw new Error(`SIMD artifact fails standard WABT validation: ${simdValidation.diagnostic}`);
    if (simdDisabledValidation.ok) throw new Error('SIMD artifact does not require SIMD; wrong candidate artifact');
    const aAbi = readAbi(a), bAbi = readAbi(b);
    if (JSON.stringify(aAbi) !== JSON.stringify(bAbi)) throw new Error('Scalar/SIMD external ABI mismatch (names, kinds, or resolved types/limits)');
    if (!a.equals(await readRegular(aPath)) || !b.equals(await readRegular(bPath))) throw new Error('WASM inputs changed during verification');
    const version = spawnSync(process.execPath, [validator, '--version'], { encoding: 'utf8' });
    if (version.status !== 0) throw new Error('Could not determine WABT CLI version');
    return {
        schemaVersion: 1, scalar, simd, wabtPackageVersion: wabtVersion, wabtCliVersion: version.stdout.trim(),
        ignoredGlueDifferences: 'Only shim_idx decimal values inside generated Cast intrinsic line comments',
        files, scalarWasm: { bytes: a.length, sha256: sha256(a), validatesWithoutSimd: true },
        simdWasm: { bytes: b.length, sha256: sha256(b), validatesWithStandardSimd: true, validatesWithoutSimd: false },
        abiSha256: sha256(JSON.stringify(aAbi)), abi: aAbi,
    };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const [scalar, simd, flag, report, ...extra] = process.argv.slice(2);
        if (!scalar || !simd || extra.length || (flag !== undefined && (flag !== '--report' || !report))) {
            throw new Error('Usage: node verify-dual-package.mjs SCALAR_PACKAGE SIMD_PACKAGE [--report FILE]');
        }
        const result = await verifyPackages(scalar, simd);
        const output = JSON.stringify(result, null, 2) + '\n';
        if (report) await writeFile(report, output, { flag: 'wx' });
        process.stdout.write(output);
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
