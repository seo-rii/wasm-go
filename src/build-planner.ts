import type {
	BrowserGoBuildPlan,
	BrowserGoCompileRequest,
	BrowserGoGeneratedFile,
	BrowserGoSourceFile,
	BrowserGoToolInvocation,
	GoEmbedPattern,
	GoPackageArchive,
	NormalizedRuntimeManifest
} from './types.js';
import {
	normalizeCompileRequestSource,
	normalizePackageImportPath,
	normalizeRequestedTarget
} from './compiler-support.js';
import { normalizeRuntimeManifest, resolveTargetManifest } from './runtime-manifest.js';

function normalizeWorkspacePath(path: string) {
	const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
	if (normalized.length === 0) {
		throw new Error('wasm-go requires non-empty workspace file paths');
	}
	const segments = normalized.split('/');
	if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
		throw new Error(`wasm-go does not allow workspace traversal paths: ${path}`);
	}
	return normalized;
}

function normalizeSourceFiles(files: NonNullable<BrowserGoCompileRequest['files']>): BrowserGoSourceFile[] {
	const entries = Array.isArray(files)
		? files.map((file) => [file.path, file.contents] as const)
		: Object.entries(files);
	if (entries.length === 0) {
		throw new Error('wasm-go requires at least one Go source file');
	}
	const normalized = entries.map(([path, contents]) => ({
		path: normalizeWorkspacePath(path),
		contents
	}));
	normalized.sort((left, right) => left.path.localeCompare(right.path));
	return normalized;
}

function createAbsoluteWorkspacePath(workspaceRoot: string, relativePath: string) {
	return `${workspaceRoot.replace(/\/+$/, '')}/${normalizeWorkspacePath(relativePath)}`;
}

function createEnvironmentMap(envEntries: string[]) {
	const env = new Map<string, string>();
	for (const entry of envEntries) {
		const separator = entry.indexOf('=');
		if (separator <= 0) {
			continue;
		}
		env.set(entry.slice(0, separator), entry.slice(separator + 1));
	}
	return Object.fromEntries(env);
}

function createImportConfig(dependencies: GoPackageArchive[]) {
	const lines: string[] = [];
	const sorted = [...dependencies].sort((left, right) =>
		left.importPath.localeCompare(right.importPath)
	);
	for (const dependency of sorted) {
		if (dependency.replaceImportPath) {
			lines.push(`importmap ${dependency.importPath}=${dependency.replaceImportPath}`);
			lines.push(`packagefile ${dependency.replaceImportPath}=${dependency.archivePath}`);
			continue;
		}
		lines.push(`packagefile ${dependency.importPath}=${dependency.archivePath}`);
	}
	return lines.join('\n');
}

function createEmbedConfig(embeds: GoEmbedPattern[], workspaceRoot: string) {
	const patterns = Object.fromEntries(
		[...embeds]
			.sort((left, right) => left.pattern.localeCompare(right.pattern))
			.map((entry) => [
				entry.pattern,
				[...entry.files]
					.map((file) => normalizeWorkspacePath(file.path))
					.sort((left, right) => left.localeCompare(right))
			])
	);
	const files = Object.fromEntries(
		[...embeds]
			.sort((left, right) => left.pattern.localeCompare(right.pattern))
			.flatMap((entry) =>
				[...entry.files]
					.sort((left, right) => left.path.localeCompare(right.path))
					.map((file) => [
						normalizeWorkspacePath(file.path),
						file.sourcePath || createAbsoluteWorkspacePath(workspaceRoot, file.path)
					] as const)
			)
	);
	return JSON.stringify(
		{
			Patterns: patterns,
			Files: files
		},
		null,
		2
	);
}

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
	}
	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
			left.localeCompare(right)
		);
		return `{${entries
			.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

function fnv1a(input: string) {
	let hash = 0x811c9dc5;
	for (const byte of new TextEncoder().encode(input)) {
		hash ^= byte;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}

function buildGeneratedFile(path: string, contents: string): BrowserGoGeneratedFile {
	return {
		path,
		contents
	};
}

export function createBrowserGoBuildPlan(
	request: BrowserGoCompileRequest,
	manifestInput: NormalizedRuntimeManifest | unknown
): BrowserGoBuildPlan {
	const manifest = normalizeRuntimeManifest(manifestInput);
	const normalizedFiles = normalizeCompileRequestSource(request);
	const packageImportPath = normalizePackageImportPath(request);
	const normalizedRequest: BrowserGoCompileRequest = {
		...request,
		files: normalizedFiles,
		packageImportPath
	};
	const targetConfig = resolveTargetManifest(manifest, normalizeRequestedTarget(normalizedRequest));
	const sourceFiles = normalizeSourceFiles(normalizedFiles);
	const dependencies = normalizedRequest.dependencies || [];
	const packageKind = normalizedRequest.packageKind || 'main';
	const workspaceRoot = targetConfig.planner.workspaceRoot.replace(/\/+$/, '');
	const importcfg = createImportConfig(dependencies);
	const embedcfg =
		normalizedRequest.embeds && normalizedRequest.embeds.length > 0
			? createEmbedConfig(normalizedRequest.embeds, workspaceRoot)
			: undefined;
	const generatedFiles: BrowserGoGeneratedFile[] = [
		buildGeneratedFile(targetConfig.planner.importcfgPath, importcfg)
	];
	if (embedcfg) {
		generatedFiles.push(buildGeneratedFile(targetConfig.planner.embedcfgPath, embedcfg));
	}
	const env = {
		...createEnvironmentMap(manifest.compiler.host.env),
		GOOS: targetConfig.goos,
		GOARCH: targetConfig.goarch,
		TMPDIR: manifest.compiler.host.tmpDirectory,
		PWD: manifest.compiler.host.pwd
	};
	const lang = request.lang || targetConfig.planner.defaultLang;
	const trimpath = request.trimpath || targetConfig.planner.defaultTrimpath;
	const compileOutputPath = targetConfig.planner.compileOutputPath;
	const compileInputFiles: BrowserGoSourceFile[] = [
		...sourceFiles.map((file) => ({
			path: createAbsoluteWorkspacePath(workspaceRoot, file.path),
			contents: file.contents
		})),
		...generatedFiles.map((file) => ({
			path: file.path,
			contents: file.contents
		}))
	];
	const compileArgs = [
		manifest.compiler.compile.argv0,
		'-p',
		packageKind === 'main' ? 'main' : packageImportPath,
		'-pack',
		'-lang',
		lang,
		'-trimpath',
		trimpath,
		'-importcfg',
		targetConfig.planner.importcfgPath,
		...(embedcfg ? ['-embedcfg', targetConfig.planner.embedcfgPath] : []),
		'-o',
		compileOutputPath,
		...sourceFiles.map((file) => createAbsoluteWorkspacePath(workspaceRoot, file.path))
	];
	const compileInvocation: BrowserGoToolInvocation = {
		tool: 'compile',
		toolAsset: manifest.compiler.compile.asset,
		argv0: manifest.compiler.compile.argv0,
		args: compileArgs,
		env,
		inputFiles: compileInputFiles,
		outputPath: compileOutputPath,
		timeoutMs: manifest.compiler.compileTimeoutMs
	};
	const linkInvocation =
		packageKind === 'main'
			? ({
					tool: 'link',
					toolAsset: manifest.compiler.link.asset,
					argv0: manifest.compiler.link.argv0,
					args: [
						manifest.compiler.link.argv0,
						'-importcfg',
						targetConfig.planner.importcfgPath,
						'-o',
						targetConfig.planner.linkOutputPath,
						compileOutputPath
					],
					env,
					inputFiles: generatedFiles.map((file) => ({
						path: file.path,
						contents: file.contents
					})),
					outputPath: targetConfig.planner.linkOutputPath,
					timeoutMs: manifest.compiler.linkTimeoutMs
				} satisfies BrowserGoToolInvocation)
			: undefined;
	const compileKeyInput = stableStringify({
		cacheVersion: 1,
		goVersion: manifest.goVersion,
		target: targetConfig.target,
		packageKind,
		packageImportPath,
		lang,
		trimpath,
		sourceFiles,
		dependencies,
		embeds: normalizedRequest.embeds || []
	});
	const compileCacheKey = `wasm-go:compile:${fnv1a(compileKeyInput)}`;
	const linkCacheKey = linkInvocation
		? `wasm-go:link:${fnv1a(
				stableStringify({
					cacheVersion: 1,
					compileCacheKey,
					target: targetConfig.target,
					args: linkInvocation.args
				})
			)}`
		: undefined;
		return {
			target: targetConfig.target,
			goVersion: manifest.goVersion,
			packageImportPath,
		packageKind,
		artifactFormat: packageKind === 'main' ? targetConfig.artifactFormat : 'go-archive',
		workspaceRoot,
		sourceFiles,
		generatedFiles,
		importcfg,
		...(embedcfg ? { embedcfg } : {}),
		...(targetConfig.sysrootFiles ? { sysrootFiles: targetConfig.sysrootFiles } : {}),
		...(targetConfig.sysrootPack ? { sysrootPack: targetConfig.sysrootPack } : {}),
		execution: targetConfig.execution,
		compile: compileInvocation,
		...(linkInvocation ? { link: linkInvocation } : {}),
		cacheKeys: {
			compile: compileCacheKey,
			...(linkCacheKey ? { link: linkCacheKey } : {})
		}
	};
}
