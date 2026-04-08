import type {
	BrowserGoCompileRequest,
	CompilerDiagnostic,
	GoPackageArchive,
	SupportedGoTarget
} from './types.js';

const SUPPORTED_TARGETS = new Set<SupportedGoTarget>([
	'wasip1/wasm',
	'wasip2/wasm',
	'wasip3/wasm',
	'js/wasm'
]);
const SUPPORTED_PACKAGE_KINDS = new Set(['main', 'library']);
const SUPPORTED_AUTO_DEPENDENCY_MODES = new Set(['sysroot', 'none']);

export function validateCompileRequest(request: BrowserGoCompileRequest) {
	const hasCode = typeof request.code === 'string' && request.code.trim().length > 0;
	const hasFiles =
		(Array.isArray(request.files) && request.files.length > 0) ||
		(!!request.files && !Array.isArray(request.files) && Object.keys(request.files).length > 0);
	if (!hasCode && !hasFiles) {
		return 'wasm-go requires either a non-empty Go source string or at least one workspace file';
	}
	if (request.packageKind && !SUPPORTED_PACKAGE_KINDS.has(request.packageKind)) {
		return `unsupported browser compiler package kind: ${request.packageKind}`;
	}
	const requestedTarget = request.targetTriple || request.target;
	if (requestedTarget && !SUPPORTED_TARGETS.has(requestedTarget)) {
		return `unsupported browser compiler target: ${requestedTarget}`;
	}
	if (
		request.autoDependencies &&
		!SUPPORTED_AUTO_DEPENDENCY_MODES.has(request.autoDependencies)
	) {
		return `unsupported browser compiler autoDependencies mode: ${request.autoDependencies}`;
	}
	return null;
}

export function normalizeRequestedTarget(request: BrowserGoCompileRequest) {
	return request.targetTriple || request.target;
}

export function normalizeCompileRequestSource(request: BrowserGoCompileRequest) {
	if (request.files) {
		return request.files;
	}
	return {
		[request.fileName || 'main.go']: request.code || ''
	};
}

export function normalizePackageImportPath(request: BrowserGoCompileRequest) {
	if (request.packageImportPath && request.packageImportPath.trim().length > 0) {
		return request.packageImportPath;
	}
	if ((request.packageKind || 'main') === 'main') {
		return 'example.com/wasm-go/main';
	}
	return 'example.com/wasm-go/library';
}

export function parseCompilerDiagnostics(stderr: string | undefined): CompilerDiagnostic[] {
	if (!stderr) {
		return [];
	}
	const diagnostics: CompilerDiagnostic[] = [];
	for (const line of stderr.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		const match = trimmed.match(/^(.*?):(\d+):(?:(\d+):)?\s*(.*)$/);
		if (match) {
			diagnostics.push({
				fileName: match[1],
				lineNumber: Number(match[2]),
				...(match[3] ? { columnNumber: Number(match[3]) } : {}),
				severity: 'error',
				message: match[4] || trimmed
			});
			continue;
		}
		diagnostics.push({
			severity: 'error',
			message: trimmed
		});
	}
	return diagnostics;
}

export function collectCompilerDiagnosticText(stderr?: string, stdout?: string) {
	const parts = [stderr, stdout]
		.map((value) => value?.trim())
		.filter((value): value is string => Boolean(value));
	return parts.length > 0 ? parts.join('\n') : undefined;
}

export function createSysrootDependency(runtimePath: string): GoPackageArchive | null {
	if (!runtimePath.startsWith('/sysroot/') || !runtimePath.endsWith('.a')) {
		return null;
	}
	const importPath = runtimePath.slice('/sysroot/'.length, -'.a'.length);
	if (!importPath) {
		return null;
	}
	return {
		importPath,
		archivePath: runtimePath
	};
}
