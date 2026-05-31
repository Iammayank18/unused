import glob from 'fast-glob';
import * as path from 'path';
import * as fs from 'fs';
import { AstParser } from '@unused/parser';
import { DependencyGraph } from '@unused/graph';
import { UnusedFileRule, UnusedExportRule, CommentedCodeRule, UnusedImportRule, Diagnostic } from '@unused/rules';

export interface CoreEngineOptions {
    includePatterns?: string[];
    ignorePatterns?: string[];
    enabledRules?: {
        unusedFiles?: boolean;
        unusedExports?: boolean;
        commentedCode?: boolean;
        unusedImports?: boolean;
    };
    severityOverrides?: {
        unusedFiles?: 'error' | 'warning' | 'info';
        unusedExports?: 'error' | 'warning' | 'info';
        commentedCode?: 'error' | 'warning' | 'info';
        unusedImports?: 'error' | 'warning' | 'info';
    };
    includeEntryFiles?: boolean;
    includeTestFiles?: boolean;
    fileSizeLimit?: number;
}

class TsConfigCache {
    private cache = new Map<string, Record<string, string[]> | null>();
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    public getPathsForFile(filePath: string): Record<string, string[]> | null {
        let currentDir = path.dirname(filePath);
        const searchDirs: string[] = [];

        let foundPaths: Record<string, string[]> | null = null;

        while (currentDir.startsWith(this.workspaceRoot) && currentDir !== path.dirname(currentDir)) {
            if (this.cache.has(currentDir)) {
                foundPaths = this.cache.get(currentDir) ?? null;
                break;
            }

            const paths = this.readPaths(currentDir);
            if (paths) {
                this.cache.set(currentDir, paths);
                foundPaths = paths;
                break;
            }

            searchDirs.push(currentDir);
            currentDir = path.dirname(currentDir);
        }

        // Cache the result for all directories we walked through
        for (const dir of searchDirs) {
            this.cache.set(dir, foundPaths);
        }

        return foundPaths;
    }

    private readPaths(dir: string): Record<string, string[]> | null {
        const candidates = ['tsconfig.json', 'tsconfig.base.json', 'tsconfig.app.json'];
        
        for (const name of candidates) {
            const tsconfigPath = path.join(dir, name);
            if (!fs.existsSync(tsconfigPath)) continue;
            try {
                const raw = fs.readFileSync(tsconfigPath, 'utf-8');
                // Strip comments and trailing commas
                const clean = raw.replace(/\/\/[^\n]*/g, '').replace(/,\s*([}\]])/g, '$1');
                const parsed = JSON.parse(clean);
                const paths = parsed?.compilerOptions?.paths;
                if (!paths) continue;
                
                const baseUrl: string = parsed?.compilerOptions?.baseUrl ?? '.';
                const base = path.resolve(dir, baseUrl);
                
                const merged: Record<string, string[]> = {};
                for (const [alias, targets] of Object.entries(paths)) {
                    merged[alias] = (targets as string[]).map(t => path.join(base, t));
                }
                return merged;
            } catch {
                // Malformed tsconfig — skip
            }
        }
        return null;
    }
}

// Phase 5+: Resolve monorepo workspace packages by name
class WorkspaceResolver {
    private packageMap: Map<string, string> | null = null;

    constructor(workspaceRoot: string) {
        this.init(workspaceRoot);
    }

    private init(workspaceRoot: string) {
        try {
            const rootPkg = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf-8'));
            const workspaces: string[] = rootPkg.workspaces ?? [];
            if (workspaces.length === 0) return;

            // Map workspace names to their entry files
            const map = new Map<string, string>();
            for (const ws of workspaces) {
                // Workspace patterns like "packages/*" or "apps/*"
                const wsFiles = fs.readdirSync(path.resolve(workspaceRoot, path.dirname(ws + '/x')))
                    .filter(f => {
                        const fullPath = path.join(workspaceRoot, path.dirname(ws + '/x'), f);
                        return fs.statSync(fullPath).isDirectory();
                    })
                    .map(f => path.join(workspaceRoot, path.dirname(ws + '/x'), f, 'package.json'))
                    .filter(f => fs.existsSync(f));

                for (const pkgPath of wsFiles) {
                    try {
                        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                        const name = pkg.name;
                        if (!name) continue;

                        // Find entry file: try main, types, module, then common defaults
                        const entry = pkg.main || pkg.types || pkg.module || 'src/index.ts';
                        const resolved = resolveImportPath(path.resolve(path.dirname(pkgPath), entry));
                        if (resolved) {
                            map.set(name, resolved);
                            // Also index by scoped name parts for fuzzy matching
                            if (name.startsWith('@')) {
                                const parts = name.split('/');
                                if (parts.length > 1) {
                                    map.set(parts[1], resolved);
                                }
                            }
                        }
                    } catch {
                        // skip malformed package.json
                    }
                }
            }

            this.packageMap = map.size > 0 ? map : null;
        } catch {
            this.packageMap = null;
        }
    }

    public resolve(name: string): string | null {
        return this.packageMap?.get(name) ?? null;
    }
}

// Edge 8: Precise framework entry filenames
const FRAMEWORK_ENTRY_BASENAMES = new Set([
    'page.tsx', 'page.ts', 'page.jsx', 'page.js',
    'layout.tsx', 'layout.ts', 'layout.jsx', 'layout.js',
    'error.tsx', 'error.ts', 'error.jsx', 'error.js',
    'not-found.tsx', 'not-found.ts', 'not-found.jsx', 'not-found.js',
    'loading.tsx', 'loading.ts', 'loading.jsx', 'loading.js',
    'route.ts', 'route.js',
    'root.tsx', 'root.jsx',
    'app.tsx', 'app.ts', 'app.jsx', 'app.js',
    'main.ts', 'main.tsx', 'main.js', 'main.jsx',
    'index.ts', 'index.tsx', 'index.js', 'index.jsx',
    'index.mts', 'index.cts', 'index.mjs', 'index.cjs',
    'extension.ts',
]);

// Edge 9: All extensions to try when resolving imports
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

function resolveImportPath(resolvedBase: string): string | null {
    if (fs.existsSync(resolvedBase) && fs.statSync(resolvedBase).isFile()) return resolvedBase;

    for (const ext of RESOLVE_EXTENSIONS) {
        if (fs.existsSync(resolvedBase + ext)) return resolvedBase + ext;
    }
    for (const ext of RESOLVE_EXTENSIONS) {
        const idx = path.join(resolvedBase, 'index' + ext);
        if (fs.existsSync(idx)) return idx;
    }
    return null;
}

export class CoreEngine {
    private parser = new AstParser();
    private rules = [
        new UnusedFileRule(),
        new UnusedExportRule(),
        new CommentedCodeRule(),
        new UnusedImportRule()
    ];

    constructor() {
        console.log("CoreEngine initialized with V2/V3 rules");
    }

    public async analyze(workspaceRoot: string, options?: CoreEngineOptions): Promise<Diagnostic[]> {
        console.log(`Running analysis on workspace: ${workspaceRoot}`);

        const include = options?.includePatterns && options.includePatterns.length > 0
            ? options.includePatterns
            // Edge 9: include modern module extensions in default scan
            : ['**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}'];

        const ignore = options?.ignorePatterns && options.ignorePatterns.length > 0
            ? options.ignorePatterns
            : ['**/node_modules/**', '**/dist/**', '**/out/**', '**/build/**'];

        // Edge 6: resolve tsconfig path aliases dynamically for each file
        const tsconfigCache = new TsConfigCache(workspaceRoot);
        const workspaceResolver = new WorkspaceResolver(workspaceRoot);

        // 1. Scan files
        const files = await glob(include, {
            cwd: workspaceRoot,
            ignore: ignore,
            absolute: true
        });

        console.log(`Found ${files.length} files to analyze.`);

        const graph = new DependencyGraph();

        // 2. Parse in Batches for Optimization (prevents event loop blocking)
        const BATCH_SIZE = 50;
        const maxSize = options?.fileSizeLimit ?? 0;
        for (let i = 0; i < files.length; i += BATCH_SIZE) {
            const batch = files.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (file) => {
                // Skip oversized files
                if (maxSize > 0) {
                    const stat = await fs.promises.stat(file);
                    if (stat.size > maxSize) return;
                }

                const content = await fs.promises.readFile(file, 'utf-8');
                const parsed = this.parser.parseFile(file, content);

                // Edge 8: use lowercase basename for case-insensitive entry detection
                // path.basename('App.tsx') = 'App.tsx' — must lowercase before Set lookup
                const base = path.basename(file).toLowerCase();
                let isEntry =
                    FRAMEWORK_ENTRY_BASENAMES.has(base);

                // Only mark test/spec/stories files as entry if includeTestFiles is false
                if (!(options?.includeTestFiles) && (file.includes('.test.') || file.includes('.spec.') || file.includes('.stories.'))) {
                    isEntry = true;
                }

                // Don't mark framework entries if includeEntryFiles is true
                if (options?.includeEntryFiles && FRAMEWORK_ENTRY_BASENAMES.has(base)) {
                    isEntry = false;
                }

                graph.addNode(file, isEntry);
                graph.setExportedSymbols(file, parsed.exports);
                if (parsed.comments) {
                    graph.setComments(file, parsed.comments);
                }
                graph.setUsedImportedNames(file, parsed.usages?.map(u => u.symbol) ?? []);
                if (parsed.usedLocalExports) {
                    graph.setUsedLocalExports(file, parsed.usedLocalExports);
                }
                if (parsed.frameworkUsages) {
                    graph.setFrameworkConsumed(file, parsed.frameworkUsages.map(u => u.exportName));
                }

                for (const imp of parsed.imports) {
                    let resolvedBase: string | null = null;

                    if (imp.path.startsWith('.')) {
                        resolvedBase = path.resolve(path.dirname(file), imp.path);
                    } else {
                        // Edge 6: try tsconfig path aliases before falling back to @/ ~/
                        const fileAliases = tsconfigCache.getPathsForFile(file);
                        let matched = false;
                        if (fileAliases) {
                            for (const [alias, targets] of Object.entries(fileAliases)) {
                                const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\*', '(.+)');
                                const match = imp.path.match(new RegExp('^' + escapedAlias + '$'));
                                if (match) {
                                    const target = targets[0].replace('*', match[1] ?? '');
                                    resolvedBase = target;
                                    matched = true;
                                    break;
                                }
                            }
                        }

                        if (!matched) {
                            // Fallback: hardcoded @/ and ~/ aliases
                            if (imp.path.startsWith('@/') || imp.path.startsWith('~/')) {
                                const subPath = imp.path.substring(2);
                                const possibleSrc = path.join(workspaceRoot, 'src', subPath);
                                const possibleRoot = path.join(workspaceRoot, subPath);
                                const srcResolved = resolveImportPath(possibleSrc);
                                resolvedBase = srcResolved ? srcResolved : resolveImportPath(possibleRoot);
                                if (!resolvedBase) {
                                    // Also try app/ directory (Next.js convention)
                                    const possibleApp = path.join(workspaceRoot, 'app', subPath);
                                    resolvedBase = resolveImportPath(possibleApp);
                                }
                            }

                            // Try workspace package resolution
                            if (!resolvedBase) {
                                resolvedBase = workspaceResolver.resolve(imp.path);
                            }
                        }
                    }

                    if (resolvedBase) {
                        const resolved = resolveImportPath(resolvedBase);
                        if (resolved) {
                            graph.addEdge(file, resolved, imp.symbols, imp.typeOnly ?? [], imp.localNames ?? []);
                        }
                    }
                }

                // Phase 5: Dynamic imports — treat as edges with wildcard symbols
                if (parsed.dynamicImports) {
                    for (const d of parsed.dynamicImports) {
                        let resolvedBase: string | null = null;
                        if (d.path.startsWith('.')) {
                            resolvedBase = path.resolve(path.dirname(file), d.path);
                        } else {
                            const fileAliases = tsconfigCache.getPathsForFile(file);
                            let matched = false;
                            if (fileAliases) {
                                for (const [alias, targets] of Object.entries(fileAliases)) {
                                    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\*', '(.+)');
                                    const match = d.path.match(new RegExp('^' + escapedAlias + '$'));
                                    if (match) {
                                        const target = targets[0].replace('*', match[1] ?? '');
                                        resolvedBase = target;
                                        matched = true;
                                        break;
                                    }
                                }
                            }
                            if (!matched) {
                                if (d.path.startsWith('@/') || d.path.startsWith('~/')) {
                                    const subPath = d.path.substring(2);
                                    const possibleSrc = path.join(workspaceRoot, 'src', subPath);
                                    const possibleRoot = path.join(workspaceRoot, subPath);
                                    const srcResolved = resolveImportPath(possibleSrc);
                                    resolvedBase = srcResolved ? srcResolved : resolveImportPath(possibleRoot);
                                    if (!resolvedBase) {
                                        const possibleApp = path.join(workspaceRoot, 'app', subPath);
                                        resolvedBase = resolveImportPath(possibleApp);
                                    }
                                }
                                if (!resolvedBase) {
                                    resolvedBase = workspaceResolver.resolve(d.path);
                                }
                            }
                        }
                        if (resolvedBase) {
                            const resolved = resolveImportPath(resolvedBase);
                            if (resolved) {
                                graph.addEdge(file, resolved, ['*']);
                            }
                        }
                    }
                }
            }));
        }

        // 3. Demote entry nodes that have incoming imports (they're barrels, not entry points)
        for (const node of graph.getAllNodes()) {
            if (node.isEntry && node.importedBy.size > 0) {
                node.isEntry = false;
            }
        }

        // 3b. Compute barrel flags for re-export chain resolution
        graph.computeBarrelFlags();

        // 4. Run Rules
        const diagnostics: Diagnostic[] = [];

        const ruleToggles = options?.enabledRules || {
            unusedFiles: true,
            unusedExports: true,
            commentedCode: true,
            unusedImports: true
        };

        for (const rule of this.rules) {
            if (rule.id === 'unused-file' && ruleToggles.unusedFiles === false) continue;
            if (rule.id === 'unused-export' && ruleToggles.unusedExports === false) continue;
            if (rule.id === 'commented-code' && ruleToggles.commentedCode === false) continue;
            if (rule.id === 'unused-import' && ruleToggles.unusedImports === false) continue;

            diagnostics.push(...rule.run(graph));
        }

        // Apply severity overrides
        const overrides = options?.severityOverrides ?? {};
        for (const d of diagnostics) {
            if (d.rule && overrides[d.rule as keyof typeof overrides]) {
                d.severity = overrides[d.rule as keyof typeof overrides]!;
            }
        }

        console.log(`Analysis complete. Found ${diagnostics.length} issues.`);

        return diagnostics;
    }
}
