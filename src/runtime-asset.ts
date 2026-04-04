import { resolveVersionedAssetUrl } from './asset-url.js';
import type {
	RuntimeAssetPackReference,
	RuntimePackIndex,
	RuntimePackIndexEntry
} from './types.js';

const runtimePackBytesCache = new Map<string, Promise<Uint8Array>>();
const runtimePackIndexCache = new Map<string, Promise<RuntimePackIndex>>();

function expectObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`invalid ${label} in wasm-go runtime pack index`);
	}
	return value as Record<string, unknown>;
}

function expectString(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`invalid ${label} in wasm-go runtime pack index`);
	}
	return value;
}

function expectNonNegativeInteger(value: unknown, label: string): number {
	if (
		typeof value !== 'number' ||
		!Number.isInteger(value) ||
		value < 0 ||
		!Number.isFinite(value)
	) {
		throw new Error(`invalid ${label} in wasm-go runtime pack index`);
	}
	return value;
}

export function clearRuntimePackCache() {
	runtimePackBytesCache.clear();
	runtimePackIndexCache.clear();
}

export function parseRuntimePackIndex(value: unknown): RuntimePackIndex {
	const root = expectObject(value, 'root');
	if (root.format !== 'wasm-go-runtime-pack-index-v1') {
		throw new Error('invalid root.format in wasm-go runtime pack index');
	}
	if (!Array.isArray(root.entries)) {
		throw new Error('invalid root.entries in wasm-go runtime pack index');
	}
	const totalBytes = expectNonNegativeInteger(root.totalBytes, 'root.totalBytes');
	const entries = root.entries.map((entry, index) => {
		const object = expectObject(entry, `root.entries[${index}]`);
		return {
			runtimePath: expectString(object.runtimePath, `root.entries[${index}].runtimePath`),
			offset: expectNonNegativeInteger(object.offset, `root.entries[${index}].offset`),
			length: expectNonNegativeInteger(object.length, `root.entries[${index}].length`)
		} satisfies RuntimePackIndexEntry;
	});
	const fileCount = expectNonNegativeInteger(root.fileCount, 'root.fileCount');
	if (fileCount !== entries.length) {
		throw new Error('invalid root.fileCount in wasm-go runtime pack index');
	}
	const seenRuntimePaths = new Set<string>();
	for (const entry of entries) {
		if (seenRuntimePaths.has(entry.runtimePath)) {
			throw new Error(
				`invalid root.entries runtimePath ${entry.runtimePath} in wasm-go runtime pack index`
			);
		}
		seenRuntimePaths.add(entry.runtimePath);
		if (entry.offset + entry.length > totalBytes) {
			throw new Error(
				`invalid runtime pack range for ${entry.runtimePath}: ${entry.offset}+${entry.length} exceeds ${totalBytes}`
			);
		}
	}
	return {
		format: 'wasm-go-runtime-pack-index-v1',
		fileCount,
		totalBytes,
		entries
	};
}

export async function fetchRuntimeAssetBytes(
	assetUrl: string | URL,
	assetLabel: string,
	fetchImpl: typeof fetch = fetch,
	allowCompressedFallback = true
) {
	const resolvedAssetUrl = assetUrl.toString();
	const resolvedAssetUrlObject = new URL(resolvedAssetUrl);
	let response: Response;
	try {
		response = await fetchImpl(resolvedAssetUrl);
	} catch (error) {
		throw new Error(
			`failed to fetch ${assetLabel} from ${resolvedAssetUrl}: ${error instanceof Error ? error.message : String(error)}. This usually means the browser loaded a stale wasm-go bundle or blocked a nested runtime asset request; hard refresh and resync the runtime assets.`
		);
	}
	const assetBytes = new Uint8Array(await response.arrayBuffer());
	const assetPreview = new TextDecoder()
		.decode(assetBytes.slice(0, 128))
		.replace(/^\uFEFF/, '')
		.trimStart()
		.toLowerCase();
	const responseLooksLikeHtml =
		assetPreview.startsWith('<!doctype html') ||
		assetPreview.startsWith('<html') ||
		assetPreview.startsWith('<head') ||
		assetPreview.startsWith('<body');
	if (
		allowCompressedFallback &&
		!resolvedAssetUrlObject.pathname.endsWith('.gz') &&
		(!response.ok || responseLooksLikeHtml)
	) {
		const compressedAssetUrl = new URL(resolvedAssetUrl);
		compressedAssetUrl.pathname = `${compressedAssetUrl.pathname}.gz`;
		try {
			return await fetchRuntimeAssetBytes(compressedAssetUrl, assetLabel, fetchImpl, false);
		} catch {}
	}
	if (!response.ok) {
		throw new Error(
			`failed to fetch ${assetLabel} from ${resolvedAssetUrl} (status ${response.status}). This usually means the browser loaded a stale wasm-go bundle or a nested runtime asset is missing.`
		);
	}
	if (responseLooksLikeHtml) {
		throw new Error(
			`failed to fetch ${assetLabel} from ${resolvedAssetUrl}: expected a wasm-go runtime asset but got HTML instead. This usually means the browser loaded a stale or wrong wasm-go bundle, or the host rewrote a missing nested asset request to index.html; hard refresh and resync the runtime assets.`
		);
	}
	if (!resolvedAssetUrlObject.pathname.endsWith('.gz')) {
		return assetBytes;
	}
	if (assetBytes.byteLength < 2 || assetBytes[0] !== 0x1f || assetBytes[1] !== 0x8b) {
		return assetBytes;
	}
	if (typeof DecompressionStream !== 'function') {
		throw new Error(
			`failed to decompress ${assetLabel} from ${resolvedAssetUrl}: this browser does not support DecompressionStream('gzip').`
		);
	}
	try {
		const decompressedResponse = new Response(
			new Blob([assetBytes]).stream().pipeThrough(new DecompressionStream('gzip'))
		);
		return new Uint8Array(await decompressedResponse.arrayBuffer());
	} catch (error) {
		throw new Error(
			`failed to decompress ${assetLabel} from ${resolvedAssetUrl}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

export async function fetchRuntimeAssetJson<T>(
	assetUrl: string | URL,
	assetLabel: string,
	fetchImpl: typeof fetch = fetch
): Promise<T> {
	return JSON.parse(
		new TextDecoder().decode(await fetchRuntimeAssetBytes(assetUrl, assetLabel, fetchImpl))
	) as T;
}

async function loadRuntimePackBytes(
	baseUrl: string | URL,
	pack: RuntimeAssetPackReference,
	fetchImpl: typeof fetch
) {
	const assetUrl = resolveVersionedAssetUrl(baseUrl, pack.asset).toString();
	let cached = runtimePackBytesCache.get(assetUrl);
	if (!cached) {
		cached = fetchRuntimeAssetBytes(assetUrl, `wasm-go runtime pack ${pack.asset}`, fetchImpl);
		runtimePackBytesCache.set(assetUrl, cached);
		cached.catch(() => {
			if (runtimePackBytesCache.get(assetUrl) === cached) {
				runtimePackBytesCache.delete(assetUrl);
			}
		});
	}
	return cached;
}

export async function loadRuntimePackIndex(
	baseUrl: string | URL,
	pack: RuntimeAssetPackReference,
	fetchImpl: typeof fetch = fetch
) {
	const indexUrl = resolveVersionedAssetUrl(baseUrl, pack.index).toString();
	let cached = runtimePackIndexCache.get(indexUrl);
	if (!cached) {
		cached = fetchRuntimeAssetJson<unknown>(
			indexUrl,
			`wasm-go runtime pack index ${pack.index}`,
			fetchImpl
		).then((value) => parseRuntimePackIndex(value));
		runtimePackIndexCache.set(indexUrl, cached);
		cached.catch(() => {
			if (runtimePackIndexCache.get(indexUrl) === cached) {
				runtimePackIndexCache.delete(indexUrl);
			}
		});
	}
	return cached;
}

export async function loadRuntimePackEntries(
	baseUrl: string | URL,
	pack: RuntimeAssetPackReference,
	fetchImpl: typeof fetch = fetch
) {
	const [index, bytes] = await Promise.all([
		loadRuntimePackIndex(baseUrl, pack, fetchImpl),
		loadRuntimePackBytes(baseUrl, pack, fetchImpl)
	]);
	return index.entries.map((entry) => ({
		runtimePath: entry.runtimePath,
		bytes: bytes.slice(entry.offset, entry.offset + entry.length)
	}));
}
