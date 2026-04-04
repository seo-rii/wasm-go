import { describe, expect, it } from 'vitest';
import wabt from 'wabt';

import { createBrowserWasiHost, executeBrowserGoArtifact } from '../src/browser-execution.js';

async function buildPreview1StdoutModule() {
	const wabtApi = await wabt();
	const parsed = wabtApi.parseWat(
		'stdout.wat',
		`(module
			(import "wasi_snapshot_preview1" "fd_write"
				(func $fd_write (param i32 i32 i32 i32) (result i32)))
			(import "wasi_snapshot_preview1" "proc_exit"
				(func $proc_exit (param i32)))
			(memory (export "memory") 1)
			(data (i32.const 8) "hi\\0a")
			(func (export "_start")
				(i32.store (i32.const 0) (i32.const 8))
				(i32.store (i32.const 4) (i32.const 3))
				(drop
					(call $fd_write
						(i32.const 1)
						(i32.const 0)
						(i32.const 1)
						(i32.const 20)))
				(call $proc_exit (i32.const 0))
			)
		)`
	);
	const binary = parsed.toBinary({});
	return new Uint8Array(binary.buffer);
}

describe('browser execution', () => {
	it('builds a wasi host with PWD=/ and a root preopen', () => {
		const host = createBrowserWasiHost({
			files: [
				{
					path: 'nested/hello.txt',
					contents: 'hello'
				}
			]
		});

		expect(host.envEntries).toContain('PWD=/');
		expect(host.rootDirectory.contents.get('nested')).toBeDefined();
		expect(host.fds).toHaveLength(5);
	});

	it('executes preview1 wasi modules and captures stdout', async () => {
		const bytes = await buildPreview1StdoutModule();
		const result = await executeBrowserGoArtifact({
			bytes,
			target: 'wasip1/wasm',
			format: 'wasi-core-wasm'
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe('hi\n');
		expect(result.stderr).toBe('');
	});

	it('rejects js/wasm execution until wasm_exec.js is wired', async () => {
		await expect(
			executeBrowserGoArtifact({
				bytes: new Uint8Array([0, 97, 115, 109]),
				target: 'js/wasm',
				format: 'js-wasm'
			})
		).rejects.toThrow(/currently executes only wasip1\/wasm artifacts/);
	});
});
