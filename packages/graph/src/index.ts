export interface GraphNode {
    path: string;
    imports: Set<string>;
    importedBy: Set<string>;
    isEntry: boolean;
    isBarrel: boolean;

    // V2: Unused Code tracking
    exportedSymbols: Set<string>;
    exportLocations: Map<string, number>;
    exportKinds: Map<string, string>;
    importedSymbols: Map<string, Set<string>>;
    importedBySymbols: Map<string, Set<string>>;
    typeOnlyImporters: Map<string, Set<string>>;

    // V2.5: Intra-file usage tracking
    importedLocalNames: Map<string, Set<string>>;
    usedImportedNames: Set<string>;

    // V3: Commented Code
    comments: { text: string, line: number }[];

    // V4: Framework consumption
    frameworkConsumedSet: Set<string>;

    // V5: Intra-file export usage
    usedLocalExports: Set<string>;
}

export class DependencyGraph {
    private nodes = new Map<string, GraphNode>();

    public addNode(path: string, isEntry: boolean = false): GraphNode {
        if (!this.nodes.has(path)) {
            this.nodes.set(path, {
                path,
                imports: new Set(),
                importedBy: new Set(),
                isEntry,
                isBarrel: false,
                exportedSymbols: new Set(),
                exportLocations: new Map(),
                exportKinds: new Map(),
                importedSymbols: new Map(),
                importedBySymbols: new Map(),
                typeOnlyImporters: new Map(),
                importedLocalNames: new Map(),
                usedImportedNames: new Set(),
                comments: [],
                frameworkConsumedSet: new Set(),
                usedLocalExports: new Set()
            });
        }
        const node = this.nodes.get(path)!;
        if (isEntry) node.isEntry = true; // promote to entry, never demote
        return node;
    }

    public getNode(path: string): GraphNode | undefined {
        return this.nodes.get(path);
    }

    public addEdge(fromPath: string, toPath: string, symbols: string[] = ['*'], typeOnly: string[] = [], localNames: string[] = []) {
        const fromNode = this.addNode(fromPath);
        const toNode = this.addNode(toPath);

        fromNode.imports.add(toPath);
        toNode.importedBy.add(fromPath);

        // Track symbols imported from 'toPath' into 'fromPath'
        if (!fromNode.importedSymbols.has(toPath)) {
            fromNode.importedSymbols.set(toPath, new Set());
        }
        symbols.forEach(s => fromNode.importedSymbols.get(toPath)!.add(s));

        // Track symbols 'fromPath' imports from 'toPath'
        if (!toNode.importedBySymbols.has(fromPath)) {
            toNode.importedBySymbols.set(fromPath, new Set());
        }
        symbols.forEach(s => toNode.importedBySymbols.get(fromPath)!.add(s));

        // Track which symbols were imported as type-only
        if (typeOnly.length > 0) {
            if (!toNode.typeOnlyImporters.has(fromPath)) {
                toNode.typeOnlyImporters.set(fromPath, new Set());
            }
            typeOnly.forEach(s => toNode.typeOnlyImporters.get(fromPath)!.add(s));
        }

        // Track local names for unused-import detection
        if (localNames.length > 0) {
            if (!fromNode.importedLocalNames.has(toPath)) {
                fromNode.importedLocalNames.set(toPath, new Set());
            }
            localNames.forEach(n => fromNode.importedLocalNames.get(toPath)!.add(n));
        }
    }

    public setExportedSymbols(path: string, symbols: { name: string; line: number; kind?: string }[]) {
        const node = this.addNode(path);
        for (const s of symbols) {
            node.exportedSymbols.add(s.name);
            if (s.line > 0) {
                node.exportLocations.set(s.name, s.line);
            }
            if (s.kind) {
                node.exportKinds.set(s.name, s.kind);
            }
        }
    }

    public setComments(path: string, comments: { text: string, line: number }[]) {
        const node = this.addNode(path);
        node.comments = comments;
    }

    public setUsedImportedNames(path: string, names: string[]) {
        const node = this.addNode(path);
        node.usedImportedNames = new Set(names);
    }

    public setFrameworkConsumed(path: string, symbols: string[]) {
        const node = this.addNode(path);
        for (const s of symbols) {
            node.frameworkConsumedSet.add(s);
        }
    }

    public setUsedLocalExports(path: string, names: string[]) {
        const node = this.addNode(path);
        node.usedLocalExports = new Set(names);
    }

    public getAllNodes(): GraphNode[] {
        return Array.from(this.nodes.values());
    }

    public getUnusedFiles(): GraphNode[] {
        return this.getAllNodes().filter(node => 
            !node.isEntry && !node.isBarrel && node.importedBy.size === 0
        );
    }

    public computeBarrelFlags() {
        for (const node of this.getAllNodes()) {
            if (node.exportedSymbols.size === 0) continue;
            if (node.exportedSymbols.has('*')) {
                node.isBarrel = true;
                continue;
            }
            let allReExported = true;
            for (const sym of node.exportedSymbols) {
                let found = false;
                for (const [, symbols] of node.importedSymbols) {
                    if (symbols.has(sym)) { found = true; break; }
                }
                if (!found) { allReExported = false; break; }
            }
            node.isBarrel = allReExported;
        }
    }

    public isSymbolUsedDownstream(symbol: string, sourcePath: string, visited: Set<string> = new Set()): boolean {
        if (visited.has(sourcePath)) return false;
        visited.add(sourcePath);

        const node = this.getNode(sourcePath);
        if (!node) return false;

        for (const [importerPath, importedSymbols] of node.importedBySymbols.entries()) {
            if (visited.has(importerPath)) continue;
            if (!importedSymbols.has(symbol) && !importedSymbols.has('*')) continue;

            const importerNode = this.getNode(importerPath);
            if (!importerNode) continue;

            const isPassThrough =
                importerNode.isBarrel ||
                importerNode.exportedSymbols.has(symbol) ||
                importerNode.exportedSymbols.has('*');

            if (isPassThrough) {
                if (this.isSymbolUsedDownstream(symbol, importerPath, visited)) {
                    return true;
                }
            } else {
                return true;
            }
        }

        return false;
    }
}
