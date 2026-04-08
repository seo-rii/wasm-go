# wasm-go

`wasm-go` is a browser-oriented Go compiler runtime prototype for upstream-style `cmd/compile` and
`cmd/link` execution in WebAssembly. The repository is currently `private: true`, and the checked-in
API should be treated as repo-scoped scaffolding rather than a published npm contract.

Current checked-in scope:

- runtime manifest and asset model for `wasip1/wasm`, plus preview1-compatible alias targets for
  `wasip2/wasm` and `wasip3/wasm`
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

Download the pinned official Go `1.26.1` host archive for one of the currently supported
`prepare:runtime` hosts (`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`), verify its
SHA-256, then generate runtime assets:

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
4. links a preview1-compatible hello program
5. executes the linked artifact and checks for `probe-ok\n`

## Target Support

| Target | Planner | In-process execution | Notes |
| --- | --- | --- | --- |
| `wasip1/wasm` | yes | yes | primary packaged/runtime target |
| `wasip2/wasm` | yes | yes | preview1-compatible alias that still compiles with `GOOS=wasip1` |
| `wasip3/wasm` | yes | yes | preview1-compatible alias that still compiles with `GOOS=wasip1` |
| `js/wasm` | partial | no | planner/runtime metadata exists, but the in-process executor still rejects `js/wasm` artifacts |

## Library Contract

The current scaffold supports the consumer-facing path that is closest to `wasm-rust`, without yet
wiring `wasm-idle` itself.

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

If you pass a custom `manifest`, planning still works, but execution currently requires an injected
`dependencies.runTool`. The bundled executor path is only wired for the default bundled runtime
assets.

## Current Limits

- default runtime generation packages `wasip1/wasm`; `wasip2/wasm` and `wasip3/wasm` currently
  reuse the same preview1-compatible toolchain/sysroot as aliases
- module resolution and dependency graphing are still manual; the caller currently supplies the
  `dependencies` list used to build `importcfg`
- `js/wasm` is not executable through the in-process runtime yet, even when `wasm_exec.js` is
  present in the runtime bundle
