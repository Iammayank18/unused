# Unused — Unused Code Detector for TypeScript & JavaScript

Find and remove unused code in your TypeScript/JavaScript projects directly inside VS Code.

---

## Features

### Unused Files
Detects `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.mjs`, `.cjs` files that are never imported anywhere in your project.

### Unused Exports
Identifies exported functions, classes, constants, interfaces, types, and enums that nothing in your codebase imports.

### Commented-Out Code
Finds blocks of commented-out code that should either be deleted or restored.

---

## Usage

1. Open the **Unused** panel from the Activity Bar (left sidebar).
2. Click the **↻ Refresh** button to run the analysis on your workspace.
3. Click any result in the tree to jump directly to the file at the relevant line.

**Analyze a specific folder:** right-click any folder in the Explorer → **Unused: Analyze Folder**.

---

## Configuration

All settings are under `unused.*` in VS Code Settings (`Ctrl+,` / `Cmd+,`).

| Setting | Default | Description |
|---------|---------|-------------|
| `unused.includePatterns` | `["**/*.{ts,tsx,js,jsx,mts,mjs,cjs}"]` | Glob patterns for files to analyse |
| `unused.ignorePatterns` | `["**/node_modules/**", "**/dist/**", "**/out/**", "**/build/**"]` | Glob patterns to exclude |
| `unused.rules.unusedFiles` | `true` | Detect files with no importers |
| `unused.rules.unusedExports` | `true` | Detect exported symbols with no consumers |
| `unused.rules.commentedCode` | `true` | Detect commented-out code blocks |

---

## Supported Patterns

**Import styles recognised:**
- ES Module static: `import x from '…'`, `import { a, b } from '…'`, `import * as ns from '…'`
- ES Module dynamic: `import('…')`
- CommonJS: `require('…')`
- Re-exports: `export * from '…'`, `export * as ns from '…'`, `export { a } from '…'`

**Entry points — never flagged as unused:**
- Framework conventions: `page.tsx`, `layout.tsx`, `error.tsx`, `loading.tsx`, `not-found.tsx`, `route.ts` (Next.js / Remix)
- App roots: `index.ts`, `main.ts`, `app.tsx`, `extension.ts` (and `.js`/`.jsx` variants)
- Tests and stories: `*.test.*`, `*.spec.*`, `*.stories.*`

**Path aliases resolved:**
- `@/` and `~/` are auto-resolved to `src/` then project root
- Custom aliases in `tsconfig.json` → `compilerOptions.paths` are read and resolved automatically

---

## Requirements

- VS Code **1.80** or later
- A TypeScript or JavaScript project (ES Modules or CommonJS)

---

## Known Limitations

- Analysis is scoped to the open workspace — files in `node_modules` are not followed.
- Decorator-based usage (Angular `@Component`, NestJS `@Injectable`) is not yet detected.
- Cross-package analysis in monorepos is not yet supported.
- Dynamic `require(variable)` (non-string arguments) cannot be resolved.

---

## License

MIT
