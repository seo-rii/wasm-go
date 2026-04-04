import { describe, expect, it } from 'vitest';

import {
	loadRuntimeManifest,
	normalizeRuntimeManifest,
	parseRuntimeManifest,
	resolveTargetManifest
} from '../src/runtime-manifest.js';
import { createRuntimeManifest } from './helpers.js';

describe('runtime manifest', () => {
	it('parses and normalizes the manifest', () => {
		const manifest = normalizeRuntimeManifest(parseRuntimeManifest(createRuntimeManifest()));

		expect(manifest.goVersion).toBe('go1.26.1');
		expect(manifest.targets['wasip1/wasm']?.target).toBe('wasip1/wasm');
		expect(manifest.targets['wasip2/wasm']?.goos).toBe('wasip1');
		expect(manifest.targets['wasip3/wasm']?.goos).toBe('wasip1');
		expect(manifest.targets['js/wasm']?.execution.kind).toBe('js-wasm-exec');
	});

	it('rejects malformed runtime manifest fields', () => {
		expect(() =>
			parseRuntimeManifest({
				...createRuntimeManifest(),
				goVersion: ''
			})
		).toThrow(/invalid root.goVersion/);

		expect(() =>
			parseRuntimeManifest({
				...createRuntimeManifest(),
				compiler: {
					...createRuntimeManifest().compiler,
					compile: {
						...createRuntimeManifest().compiler.compile,
						asset: ''
					}
				}
			})
		).toThrow(/invalid root.compiler.compile.asset/);

		expect(() =>
			parseRuntimeManifest({
				...createRuntimeManifest(),
				targets: {
					...createRuntimeManifest().targets,
					'wasip1/wasm': {
						...createRuntimeManifest().targets['wasip1/wasm'],
						goos: 'js'
					}
				}
			})
		).toThrow(/invalid root.targets.wasip1\/wasm.goos\/goarch/);
	});

	it('resolves explicit targets and rejects missing targets', () => {
		const manifest = normalizeRuntimeManifest(createRuntimeManifest());
		expect(resolveTargetManifest(manifest, 'js/wasm').execution.kind).toBe('js-wasm-exec');
		expect(resolveTargetManifest(manifest, 'wasip2/wasm').goos).toBe('wasip1');
		expect(resolveTargetManifest(manifest, 'wasip3/wasm').goos).toBe('wasip1');
		expect(() =>
			resolveTargetManifest(
				normalizeRuntimeManifest({
					...createRuntimeManifest(),
					targets: {
						'wasip1/wasm': createRuntimeManifest().targets['wasip1/wasm']
					}
				}),
				'js/wasm'
			)
		).toThrow(/unsupported wasm-go target js\/wasm/);
	});

	it('loads the manifest through fetch', async () => {
		const loaded = await loadRuntimeManifest('https://example.invalid/runtime-manifest.v1.json', async () =>
			new Response(JSON.stringify(createRuntimeManifest()))
		);

		expect(loaded.defaultTarget).toBe('wasip1/wasm');
		expect(Object.keys(loaded.targets)).toEqual(
			expect.arrayContaining(['wasip1/wasm', 'wasip2/wasm', 'wasip3/wasm', 'js/wasm'])
		);
	});
});
