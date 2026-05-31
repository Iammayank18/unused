# Changelog

All notable changes to Unused are documented here.

## [0.0.1] — 2026-05-29

### Added
- **Unused file detection** — reports files that are never imported anywhere in the workspace.
- **Unused export detection** — reports exported symbols (functions, classes, constants, interfaces, types, enums) that have no consumers.
- **Commented-out code detection** — reports comment blocks that contain code syntax.
- Activity Bar panel with a tree view grouped by folder.
- Click-to-navigate: clicking a result opens the file at the relevant line.
- **Unused: Analyze Folder** context menu command for folder-scoped analysis.
- Configurable include/ignore glob patterns (`unused.includePatterns`, `unused.ignorePatterns`).
- Per-rule toggles (`unused.rules.unusedFiles`, `unused.rules.unusedExports`, `unused.rules.commentedCode`).
- Support for ES Module and CommonJS imports, dynamic `import()`, and `require()`.
- Re-export tracking: `export * from`, `export * as ns from`, `export { a } from`.
- Automatic resolution of `@/` and `~/` path aliases.
- Reads `tsconfig.json` `compilerOptions.paths` to resolve custom path aliases.
- Entry-point awareness for Next.js, Remix, and other framework conventions.
- Batch parsing (50 files at a time) to avoid blocking the event loop on large projects.
