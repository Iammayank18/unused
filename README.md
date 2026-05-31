# Unused

A VS Code extension and tooling monorepo for detecting unused code in TypeScript & JavaScript projects — unused files, unused exports, unused imports, and commented-out code.

![CI](https://github.com/Iammayank18/unused/actions/workflows/ci.yml/badge.svg)

## Packages

```
apps/
  vscode-extension/   VS Code extension (sidebar, diagnostics, code actions, commands)

packages/
  core-engine/        Orchestrates scan, parse, graph, and rules
  parser/             AST-based import/export/comment extraction
  graph/              Dependency graph with symbol-level tracking and re-export chains
  rules/              Analysis rules (unused-file, unused-export, unused-import, commented-code)
  framework-adapters/ Framework-specific entry detection (Next.js, Angular, NestJS, etc.)
  shared/             Shared types and utilities
  cli/                CLI for running analysis outside VS Code
```

## Getting Started

```bash
npm install
npm run build       # builds all packages & extension (via Turborepo)
npm test            # runs all tests (72+)
```

### Build specific

```bash
npm run build:ext    # build only the VS Code extension
npm run package:ext  # build + package .vsix for manual install
```

## VS Code Extension

The extension lives in `apps/vscode-extension/`. Install the `.vsix` from Extensions → ⋮ → Install from VSIX..., or publish from the VS Code Marketplace.

### Features

- **Unused Files** — files never imported by any other file (skips barrel/re-export files and entrypoints)
- **Unused Exports** — exported symbols with no consumers across the entire import graph (functions, classes, types, interfaces, enums, constants)
- **Unused Imports** — imported symbols never referenced in the importing file
- **Commented-Out Code** — comments containing code syntax, detected via AST heuristics
- **Framework-Aware** — understands Next.js conventions (`getStaticProps`, route handlers, metadata exports), Angular/NestJS/TypeORM decorators, and more
- **Re-Export Chain Resolution** — follows barrel files and transitive re-exports to find real consumers
- **Dynamic Imports** — handles `import()`, `require()`, `React.lazy`, `next/dynamic`
- **Quick Fixes** — remove unused imports or `export` keyword with a single click
- **Monorepo Support** — resolves npm/yarn workspace packages automatically
- **Customizable** — per-rule severity, file patterns, max scan depth, file size limits, and more

### Settings

| Setting | Default | Description |
|---|---|---|
| `unused.includePatterns` | `["**/*.{ts,tsx,js,jsx}"]` | Glob patterns to scan |
| `unused.ignorePatterns` | `["**/node_modules/**", ...]` | Glob patterns to ignore |
| `unused.rules.unusedFiles` | `true` | Enable/disable unused file detection |
| `unused.rules.unusedExports` | `true` | Enable/disable unused export detection |
| `unused.rules.unusedImports` | `true` | Enable/disable unused import detection |
| `unused.rules.commentedCode` | `true` | Enable/disable commented code detection |
| `unused.rules.*.severity` | varies | Per-rule severity (`error`, `warning`, `info`) |
| `unused.includeEntryFiles` | `false` | Include entrypoints in analysis |
| `unused.includeTestFiles` | `false` | Include test files in analysis |
| `unused.maxScanDepth` | `8` | Maximum directory depth for scanning |
| `unused.fileSizeLimit` | `0` | Skip files larger than N KB (0 = no limit) |
| `unused.showProblemsPanel` | `true` | Show results in the Problems panel |
| `unused.showNotifications` | `true` | Show result notifications |

### Commands

- `Unused: Scan Workspace` — analyze the entire workspace
- `Unused: Scan Folder` — analyze a specific folder (available from explorer context menu)
- `Unused: Refresh` — re-run analysis
- `Unused: Open Settings` — open extension settings

## License

MIT
