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
