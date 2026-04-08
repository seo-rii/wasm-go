import {
	Directory,
	Fd,
	Inode,
	OpenFile,
	PreopenDirectory,
	WASI,
	wasi
} from '@bjorn3/browser_wasi_shim';

import type { BrowserGoArtifact, BrowserGoSourceFile } from './types.js';
import { CaptureFd, toStandaloneBytes, writeGuestFile } from './wasi-guest.js';

export interface BrowserExecutionResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

export interface BrowserExecutionOptions {
	args?: string[];
	env?: Record<string, string>;
	stdin?: () => string | Uint8Array | ArrayBuffer | null;
	stdout?: (chunk: string) => void;
	stderr?: (chunk: string) => void;
	files?: Array<BrowserGoSourceFile | { path: string; contents: string | Uint8Array | ArrayBuffer }>;
}

export interface BrowserWasiHost {
	args: string[];
	envEntries: string[];
	fds: Fd[];
	rootDirectory: Directory;
	stdout: CaptureFd;
	stderr: CaptureFd;
}

class BufferedExecutionInput {
	private currentChunk = new Uint8Array(0);
	private currentOffset = 0;
	private readonly readInput: BrowserExecutionOptions['stdin'];

	constructor(readInput: BrowserExecutionOptions['stdin']) {
		this.readInput = readInput;
	}

	read(size: number) {
		while (this.currentOffset >= this.currentChunk.length) {
			const nextChunk = this.readInput?.();
			if (nextChunk == null) {
				return new Uint8Array(0);
			}
			this.currentChunk = toStandaloneBytes(nextChunk);
			this.currentOffset = 0;
			if (this.currentChunk.byteLength === 0) {
				continue;
			}
		}
		const data = this.currentChunk.slice(this.currentOffset, this.currentOffset + size);
		this.currentOffset += data.byteLength;
		return data;
	}
}

class StdinFd extends Fd {
	ino = Inode.issue_ino();
	private readonly source: BufferedExecutionInput;

	constructor(source: BufferedExecutionInput) {
		super();
		this.source = source;
	}

	fd_filestat_get() {
		return {
			ret: wasi.ERRNO_SUCCESS,
			filestat: new wasi.Filestat(this.ino, wasi.FILETYPE_CHARACTER_DEVICE, 0n)
		};
	}

	fd_fdstat_get() {
		const fdstat = new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0);
		fdstat.fs_rights_base = BigInt(wasi.RIGHTS_FD_READ);
		return {
			ret: wasi.ERRNO_SUCCESS,
			fdstat
		};
	}

	fd_read(size: number) {
		return {
			ret: wasi.ERRNO_SUCCESS,
			data: this.source.read(size)
		};
	}
}

export function createBrowserWasiHost(options: BrowserExecutionOptions = {}): BrowserWasiHost {
	const rootDirectory = new Directory(new Map());
	for (const file of options.files || []) {
		writeGuestFile(rootDirectory, file.path, file.contents);
	}
	const stdin = new BufferedExecutionInput(options.stdin);
	const stdout = new CaptureFd(options.stdout);
	const stderr = new CaptureFd(options.stderr);
	const env = new Map<string, string>([['PWD', '/']]);
	for (const [key, value] of Object.entries(options.env || {})) {
		env.set(key, value);
	}
	return {
		args: ['main.wasm', ...(options.args || [])],
		envEntries: Array.from(env.entries()).map(([key, value]) => `${key}=${value}`),
		rootDirectory,
		stdout,
		stderr,
		fds: [
			new StdinFd(stdin),
			stdout,
			stderr,
			new PreopenDirectory('/tmp', new Map()),
			new PreopenDirectory('/', rootDirectory.contents)
		]
	};
}

export async function executeBrowserGoArtifact(
	artifact: BrowserGoArtifact,
	options: BrowserExecutionOptions = {}
): Promise<BrowserExecutionResult> {
	if (
		(artifact.target !== 'wasip1/wasm' &&
			artifact.target !== 'wasip2/wasm' &&
			artifact.target !== 'wasip3/wasm') ||
		artifact.format !== 'wasi-core-wasm'
	) {
		throw new Error(
			'wasm-go currently executes only preview1-compatible wasi core-wasm artifacts in-process. js/wasm output still needs wasm_exec.js integration.'
		);
	}
	const host = createBrowserWasiHost(options);
	const wasiInstance = new WASI(host.args, host.envEntries, host.fds, { debug: false });
	const bytes =
		artifact.bytes instanceof Uint8Array
			? new Uint8Array(artifact.bytes)
			: new Uint8Array(artifact.bytes);
	const module = await WebAssembly.compile(bytes);
	const instance = await WebAssembly.instantiate(module, {
		wasi_snapshot_preview1: wasiInstance.wasiImport
	});
	const exitCode = wasiInstance.start(instance as unknown as {
		exports: {
			memory: WebAssembly.Memory;
			_start: () => unknown;
		};
	});
	return {
		exitCode,
		stdout: host.stdout.getText(),
		stderr: host.stderr.getText()
	};
}
