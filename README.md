# wasm-go

`wasm-go` is a browser-oriented Go compiler runtime scaffold that follows the staged plan in
`WORK.md`.

Current checked-in scope:

- runtime manifest and asset model for `wasip1/wasm`
- browser/Node WASI execution path
- build planner that emits `compile`/`link` invocations plus `importcfg` and `embedcfg`
- reproducible runtime packaging from the official Go `1.26.1` toolchain
- runtime probe that compiles and runs `fmt.Println("probe-ok")`
- code-only compile requests that auto-populate stdlib `importcfg` entries from the bundled sysroot

## Reproducible Runtime Build

Build the TypeScript package:

```bash
cd /path/to/wasm-go
npm run build
```

Download the pinned official Go `1.26.1` host archive for the current machine, verify its SHA-256,
then generate runtime assets:

```bash
cd /path/to/wasm-go
npm run prepare:runtime
```

That writes:

- `dist/runtime/tools/compile.wasm.gz`
- `dist/runtime/tools/link.wasm.gz`
- `dist/runtime/sysroot/wasip1.pack.gz`
- `dist/runtime/sysroot/wasip1.index.json.gz`
- `dist/runtime/runtime-manifest.v1.json`
- `dist/runtime/runtime-build.json`

`runtime-build.json` records the exact upstream archive URL and checksum so the same runtime can be
rebuilt later.

## Validation

Run the end-to-end local probe:

```bash
cd /path/to/wasm-go
npm run validate:runtime
```

That sequence:

1. builds `dist/`
2. prepares the pinned `go1.26.1` runtime assets
3. calls `compileGo()` against the generated bundled runtime
4. links a `wasip1/wasm` hello program
5. executes the linked artifact and checks for `probe-ok\n`

## Library Contract

The public package now supports the consumer-facing path that is closest to `wasm-rust`, without
yet wiring `wasm-idle` itself.

```ts
import createGoCompiler from './dist/index.js';

const compiler = await createGoCompiler();
const result = await compiler.compile({
  code: `package main

import "fmt"

func main() {
  fmt.Println("hello from wasm-go")
}
`,
  target: 'wasip1/wasm'
});
```

For simple single-file programs, the compiler now:

- defaults the source file to `main.go`
- defaults the package import path for planning/cache purposes
- auto-populates stdlib archive mappings from the bundled sysroot
- returns the linked executable under both `artifact.bytes` and `artifact.wasm`

## Current Limits

- default runtime generation is only wired for `wasip1/wasm`
- module resolution and dependency graphing are still manual; the caller currently supplies the
  `dependencies` list used to build `importcfg`
- `js/wasm` output mode is still planned but not packaged yet
