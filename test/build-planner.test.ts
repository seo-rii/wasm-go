import { describe, expect, it } from 'vitest';

import { createBrowserGoBuildPlan } from '../src/build-planner.js';
import { createCompileRequest, createRuntimeManifest } from './helpers.js';

describe('build planner', () => {
	it('builds compile and link plans for main packages', () => {
		const plan = createBrowserGoBuildPlan(createCompileRequest(), createRuntimeManifest());

		expect(plan.target).toBe('wasip1/wasm');
		expect(plan.compile.args).toEqual([
			'compile',
			'-p',
			'main',
			'-pack',
			'-lang',
			'go1.26',
			'-trimpath',
			'/workspace',
			'-importcfg',
			'/workspace/importcfg',
			'-o',
			'/workspace/pkg/main.a',
			'/workspace/main.go'
		]);
		expect(plan.link?.args).toEqual([
			'link',
			'-importcfg',
			'/workspace/importcfg',
			'-o',
			'/workspace/bin/main.wasm',
			'/workspace/pkg/main.a'
		]);
		expect(plan.importcfg).toContain('packagefile fmt=/sysroot/fmt.a');
		expect(plan.importcfg).toContain('packagefile runtime=/sysroot/runtime.a');
		expect(plan.cacheKeys.compile).toMatch(/^wasm-go:compile:/);
		expect(plan.cacheKeys.link).toMatch(/^wasm-go:link:/);
	});

	it('plans transitional wasip2 and wasip3 requests through the wasip1 toolchain env', () => {
		const wasip2Plan = createBrowserGoBuildPlan(
			createCompileRequest({
				target: 'wasip2/wasm'
			}),
			createRuntimeManifest()
		);
		const wasip3Plan = createBrowserGoBuildPlan(
			createCompileRequest({
				target: 'wasip3/wasm'
			}),
			createRuntimeManifest()
		);

		expect(wasip2Plan.target).toBe('wasip2/wasm');
		expect(wasip2Plan.compile.env.GOOS).toBe('wasip1');
		expect(wasip2Plan.artifactFormat).toBe('wasi-core-wasm');
		expect(wasip3Plan.target).toBe('wasip3/wasm');
		expect(wasip3Plan.compile.env.GOOS).toBe('wasip1');
		expect(wasip3Plan.artifactFormat).toBe('wasi-core-wasm');
	});

	it('emits embedcfg for embed-enabled packages', () => {
		const plan = createBrowserGoBuildPlan(
			createCompileRequest({
				packageKind: 'library',
				embeds: [
					{
						pattern: 'assets/*.txt',
						files: [
							{
								path: 'assets/hello.txt'
							}
						]
					}
				]
			}),
			createRuntimeManifest()
		);

		expect(plan.link).toBeUndefined();
		expect(plan.embedcfg).toBe(
			JSON.stringify(
				{
					Patterns: {
						'assets/*.txt': ['assets/hello.txt']
					},
					Files: {
						'assets/hello.txt': '/workspace/assets/hello.txt'
					}
				},
				null,
				2
			)
		);
		expect(plan.compile.args).toContain('-embedcfg');
		expect(plan.artifactFormat).toBe('go-archive');
	});

	it('rejects traversal paths', () => {
		expect(() =>
			createBrowserGoBuildPlan(
				createCompileRequest({
					files: {
						'../main.go': 'package main'
					}
				}),
				createRuntimeManifest()
			)
		).toThrow(/does not allow workspace traversal paths/);
	});
});
