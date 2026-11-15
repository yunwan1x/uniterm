import { chmod, copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPackages } from './verify-dual-package.mjs';

function contains(parent, child) {
    const path = relative(parent, child);
    return path === '' || (!path.startsWith('..') && !path.startsWith('/'));
}
async function requireAbsent(path) {
    try { await lstat(path); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    throw new Error(`Output already exists: ${path}`);
}
async function normalizeModes(directory) {
    await chmod(directory, 0o755);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await normalizeModes(path);
        else if (entry.isFile()) await chmod(path, 0o644);
        else throw new Error(`Unsupported staged package entry: ${path}`);
    }
}

export async function packageDual(scalarDirectory, simdDirectory, outputDirectory, version = '0.5.1-uniterm.18') {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid package version');
    const scalar = resolve(scalarDirectory), simd = resolve(simdDirectory), output = resolve(outputDirectory);
    if (contains(scalar, output) || contains(simd, output)) throw new Error('Output must be outside both source packages');
    await requireAbsent(output);
    const verification = await verifyPackages(scalar, simd);
    for (const name of ['LICENSE-APACHE', 'LICENSE-MIT']) {
        if (!(await lstat(join(scalar, name))).isFile()) throw new Error(`Missing regular ${name} in scalar package`);
    }
    await mkdir(dirname(output), { recursive: true });
    const staging = await mkdtemp(join(dirname(output), `.${basename(output)}-`));
    try {
        for (const name of ['ironrdp.js', 'ironrdp.d.ts', 'ironrdp_bg.wasm', 'ironrdp_bg.wasm.d.ts', 'LICENSE-APACHE', 'LICENSE-MIT']) {
            await copyFile(join(scalar, name), join(staging, name));
        }
        await copyFile(join(simd, 'ironrdp_bg.wasm'), join(staging, 'ironrdp_simd_bg.wasm'));
        if ((await readdir(scalar)).includes('snippets')) await cp(join(scalar, 'snippets'), join(staging, 'snippets'), { recursive: true, errorOnExist: true, force: false });
        for (const name of ['index.js', 'index.d.ts']) await copyFile(new URL(name, import.meta.url), join(staging, name));
        const manifest = {
            name: '@ys-ll/ironrdp-wasm', version, type: 'module',
            description: 'Pinned IronRDP with frame-atomic EGFX, batched Canvas presentation, browser media capture, and optional SIMD',
            main: 'index.js', types: 'index.d.ts', license: 'MIT OR Apache-2.0',
            repository: 'https://github.com/Devolutions/IronRDP',
            files: ['index.js', 'index.d.ts', 'ironrdp.js', 'ironrdp.d.ts', 'ironrdp_bg.wasm',
                'ironrdp_simd_bg.wasm', 'ironrdp_bg.wasm.d.ts', 'snippets', 'LICENSE-*'],
        };
        await writeFile(join(staging, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
        // Build evidence is intentionally excluded from the runtime npm package.
        await writeFile(join(staging, 'build-verification.json'), JSON.stringify(verification, null, 2) + '\n');
        // Recheck the bytes actually copied before making the result visible.
        const { createHash } = await import('node:crypto');
        const hash = bytes => createHash('sha256').update(bytes).digest('hex');
        for (const [name, expected] of [['ironrdp_bg.wasm', verification.scalarWasm.sha256], ['ironrdp_simd_bg.wasm', verification.simdWasm.sha256]]) {
            if (hash(await readFile(join(staging, name))) !== expected) throw new Error(`Input changed during packaging: ${name}`);
        }
        for (const [name, hashes] of Object.entries(verification.files)) {
            if (hash(await readFile(join(staging, name))) !== hashes.scalar) throw new Error(`Input changed during packaging: ${name}`);
        }
        await normalizeModes(staging);
        await requireAbsent(output);
        await rename(staging, output);
        return { output, version, scalarSha256: verification.scalarWasm.sha256, simdSha256: verification.simdWasm.sha256 };
    } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const [scalar, simd, output, version, ...extra] = process.argv.slice(2);
        if (!scalar || !simd || !output || extra.length) throw new Error('Usage: node package.mjs SCALAR_PACKAGE SIMD_PACKAGE OUTPUT_DIRECTORY [VERSION]');
        console.log(JSON.stringify(await packageDual(scalar, simd, output, version), null, 2));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
