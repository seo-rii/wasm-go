import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const scriptPath = fileURLToPath(import.meta.url);
const scriptsDir = path.dirname(scriptPath);
const projectRoot = path.resolve(scriptsDir, '..');
const distRoot = path.join(projectRoot, 'dist');
const runtimeDir = path.join(distRoot, 'runtime');

async function loadRuntimeManifest() {
	return JSON.parse(
		await readFile(path.join(runtimeDir, 'runtime-manifest.v1.json'), 'utf8')
	);
}

async function loadPackEntries(packAsset, indexAsset) {
	const packBytes = gunzipSync(await readFile(path.join(runtimeDir, packAsset)));
	const index = JSON.parse(
		gunzipSync(await readFile(path.join(runtimeDir, indexAsset))).toString('utf8')
	);
	return index.entries.map((entry) => ({
		runtimePath: entry.runtimePath,
		bytes: packBytes.subarray(entry.offset, entry.offset + entry.length)
	}));
}

async function main() {
	const manifest = await loadRuntimeManifest();
	const target = manifest.targets['wasip1/wasm'];
	if (!target) {
		throw new Error('runtime manifest is missing wasip1/wasm');
	}
	await loadPackEntries(target.sysrootPack.asset, target.sysrootPack.index);
	const [{ compileGo, executeBrowserGoArtifact }] = await Promise.all([
		import(pathToFileURL(path.join(distRoot, 'index.js')).toString())
	]);
	const compileResult = await compileGo({
		target: 'wasip1/wasm',
		code: `package main

import "fmt"

func main() {
	fmt.Println("probe-ok")
}
`,
		log: true
	});
	if (!compileResult.success || !compileResult.artifact) {
		throw new Error(
			`compile probe failed: ${compileResult.stderr || 'unknown error'}`
		);
	}
	const runtimeResult = await executeBrowserGoArtifact(compileResult.artifact);
	if (runtimeResult.exitCode !== 0) {
		throw new Error(`runtime probe exited with ${runtimeResult.exitCode}`);
	}
	if (runtimeResult.stdout !== 'probe-ok\n') {
		throw new Error(
			`runtime probe stdout mismatch: ${JSON.stringify(runtimeResult.stdout)}`
		);
	}
	console.log('compile.success=true');
	console.log(`artifact.format=${compileResult.artifact.format}`);
	console.log(`runtime.exitCode=${runtimeResult.exitCode}`);
	console.log(`runtime.stdout=${JSON.stringify(runtimeResult.stdout)}`);
}

await main();
