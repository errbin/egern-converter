# Static JavaScript analysis

## Fixed functional architecture

The toolchain has eight functional categories and four root command entrypoints.
There are 24 first-party JavaScript modules in total, including the entrypoints.
`architecture.json` records the exact file inventory; the Python caller checks it
before batch analysis and generated-script validation. CI runs the architecture
tests before building resources.

| Category | Modules | Responsibility |
| --- | --- | --- |
| `core` | `syntax`, `ast` | Cached parsing, lexical scopes, AST edits and standard globals |
| `analysis` | `analyze`, `behavior`, `values`, `libraries`, `probes` | API diagnostics, output evidence, value/receiver facts, complete-library contracts and input hints |
| `transforms` | `decoding`, `evaluation`, `simplify`, `specialization`, `factories` | String-table grammars, evaluation provenance, static simplification, closed arguments/receivers and factory specialization |
| `platform` | `globals`, `environment`, `clients` | Platform probes/aliases, Env variants, reviewed client/middleware SDKs, device and message semantics |
| `http` | `requests` | Closed HTTP receivers, helper/factory/delegate contracts, Node request calls and request mutations |
| `compiler` | `native`, `flow` | Direct `ctx` emission, async propagation, completion syntax and pending results |
| `output` | `source` | Formatting, compact output and usage/copyright documentation |
| `verification` | `fixtures` | Independent fixture-only Headers, URL, Fetch body and evaluation models |

The root entrypoints remain `batch.mjs`, `check.mjs`, `verify.mjs` and `widget.mjs`.
`vendor/` contains only the declared complete third-party dependencies and their
licenses. Fixture models must never become compiler/runtime dependencies.

Extend an existing functional module with exports and internal sections. Do not
create files for an author, repository, script, failed sample or patch batch; do
not add `extended`, `v2` or `extra` siblings. Do not retain forwarding files at old
paths. The 24-module ceiling and the eight categories are fixed, not a target
that may grow with each bug. Changing these boundaries requires the maintainer's
explicit authorization and coordinated changes to `AGENTS.md`, the inventory,
validation and this document. Ordinary fixes do not authorize expansion. Native
JavaScript functions and complete third-party libraries retain their existing
semantics during organization.

Run the structure and import checks without rebuilding resources:

```sh
python -m unittest discover -s tests -p 'test_analysis_architecture.py' -v
```

## Analysis and conversion

`analysis/analyze.mjs` exports a pure per-script analysis function, returning independent failure reasons, detected APIs, async requirements and API usage. `batch.mjs` accepts a JSON array of `{source, source_format, mode, options}` jobs on stdin and reuses one parser/runtime for the batch. It never evaluates source or decoder functions. Scope and API checks are conservative; this is not a general JavaScript transpiler or an equivalence proof.

Full builds analyze every registered script again. The Python caller deduplicates identical jobs within that build and splits native inputs at 8 jobs or 512 KiB of source text, other modes at 32 jobs or 1 MiB; an oversized individual script is processed alone. Reports retain input order, and each job has its own scope and diagnostics. Generated artifacts receive a separate batch syntax check before the complete site replaces the previous output. No analysis or converted-output cache is reused between builds.

Requires Node.js 22+. No npm install is required. The vendored parser is [Acorn 8.15.0](https://github.com/acornjs/acorn/tree/8.15.0), licensed under MIT; see `vendor/LICENSE-acorn.txt`. The build-only formatter is [JS Beautify 2.0.3](https://github.com/beautifier/js-beautify/tree/v2.0.3), with its standalone bundle in `vendor/beautify.cjs` and MIT license in `vendor/LICENSE-js-beautify.txt`; the bundle is copied unchanged from `js/lib/beautify.js`. Optional deobfuscation is a separate tool in `tools/js-readability`.

`batch.mjs` also accepts `mode: "behavior"`. `analysis/behavior.mjs` parses legacy scripts and native ES-module entry points without conversion, returning output-related fields, operations, line evidence and limitations. It uses lexical bindings, a bounded local call graph and flow-insensitive data dependencies from completion/return values, including simple object aliases. Unrelated literals, comments, shadowed platform APIs and uncalled helpers are excluded. This is a conservative possible-path summary, not a runtime or effect proof: unknown calls, dynamic execution and depth bounds remain explicit limitations. It never executes code or loads imports. The build uses these facts plus module configuration only when upstream documentation is absent; native resources remain verbatim.

`compiler/native.mjs` statically compiles supported legacy scripts into direct Egern `ctx` calls. It folds platform probes, tracks lexical bindings, propagates completion through a bounded local call graph, lowers terminal HTTP callbacks, and consumes response streams once. It emits no legacy API objects, compatibility runtime, completion sentinel, proxy, or promise tracker. Unsupported return propagation, escaping response shapes, concurrent completion and finally semantics are explicit build errors. A final AST check rejects free legacy API identifiers. Native upstream ES modules remain byte-for-byte unchanged.

`analysis/values.mjs` distinguishes object/error/URL formatting from function source inspection. Closed Object.create descriptors, inherited non-callable instances and read-only built-in aliases retain ordinary JavaScript semantics. Known protobuf-ts runtimes may include structurally identified generated schema declarations: only MessageType subclasses and enum/instance declarations qualify, all lexical dependencies are checked, and their source is restored verbatim. A matching library cannot hide proxy calls introduced in a schema or helper.

`platform/clients.mjs` specializes the reviewed `createInstance` middleware SDK protocol independently of the singleton-client pass. Inherited platform classes are removed; ordinary routing, middleware, message prototypes and business state remain source-derived. The entry awaits the dispatcher, the finalizer returns the selected result, and the outer entry returns that value. Method contracts reject changed constructors/finalizers, escaped factories and additional platform-class initialization. Parameter decoding uses native `ctx.env`; no legacy API façade is introduced. Already-async middleware forms an async-propagation boundary, so adding an awaited compression call inside it does not falsely classify the existing middleware callback as a newly escaping synchronous function. The reviewed factory selects its author's Surge default protocol for native output, independently of module syntax; `verification_format: surge` records this explicitly. Optional trailer checks and the author's missing-trailer fallback remain ordinary source JS. HTTP calls use native `ctx.http`, seconds become milliseconds, and binary replies are read once. No Loon ALPN control or undocumented native trailer field is invented. Differential fixtures compare the authored default protocol, not all Loon extensions. Already-async bodies still await newly lifted compression helpers in place, preserving assignment receiver and branch evaluation order.

`analysis/values.mjs` infers string arguments through closed calls, immutable JSON data and successful string operations. Unknown calls, escapes, revivers, reassigned parameters and object mutations do not establish a string type. Conditional URL/media notification options are mapped at the native call site only for closed, explicitly written property sets. Platform constants captured in callbacks are folded only after initialization is proved across all enclosing entry points.

`transforms/decoding.mjs` independently implements a bounded RC4/literal-table grammar. Decoder and rotation AST contracts grant only constant string decoding; the complete decoded self-defence shell has its own contract. Business statements and their intervening loops/assignments come from the current input AST, never from a URL or file digest. Unknown shells, nonconstant decoder references and business dependencies on shell/console state reject conversion. The removal of the reviewed debugger/timer/console-suppression shell is recorded in `static_transformations`. No input function, eval or VM is invoked during compilation.

`output/source.mjs` formats the compiled entry point with two-space indentation and consistent statement/block layout. It excludes the attribution/description/YAML header and does not format native upstream modules. Acorn's automatically inserted semicolons are made explicit before formatting to protect newline-dependent return/break/continue boundaries. Before accepting output, it reparses and compares complete ASTs (excluding positions, retaining literal raw spelling, directives and template values) and comment contents (excluding line indentation). Any discrepancy rejects conversion. The formatter runs inside the existing batch process, is fingerprinted with the compiler and never ships as a runtime dependency in generated scripts.

`verification/fixtures.mjs` models the documented native Headers property and method API for test hosts only. `verify.mjs` runs original and converted scripts in separate fixture realms; its old-platform mocks are never copied to release artifacts.

See [native conversion behavior and limits](../../docs/script-api-compatibility.md).
