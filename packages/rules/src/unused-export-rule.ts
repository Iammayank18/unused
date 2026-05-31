import { DependencyGraph, GraphNode } from '@unused/graph';
import { Diagnostic, Rule } from './index';

export class UnusedExportRule implements Rule {
    public id = 'unused-export';

    public run(graph: DependencyGraph): Diagnostic[] {
        const diagnostics: Diagnostic[] = [];
        const nodes = graph.getAllNodes();

        for (const node of nodes) {
            // If the file is an entrypoint, its exports might be used externally.
            if (node.isEntry) continue;

            const unusedExports: string[] = [];

            // For each exported symbol
            for (const exportSymbol of node.exportedSymbols) {
                // If it's a wildcard export indicator we added during parsing, skip
                if (exportSymbol === '*') continue;

                // Skip re-exports — symbol is imported AND re-exported by this file,
                // so it's not a local definition that can be "unused"
                let isReExport = false;
                for (const [, symbols] of node.importedSymbols) {
                    if (symbols.has(exportSymbol)) {
                        isReExport = true;
                        break;
                    }
                }
                if (isReExport) continue;

                // Skip symbols consumed by a framework (decorators, convention exports)
                if (node.frameworkConsumedSet.has(exportSymbol)) continue;

                // Skip symbols used within the same file (e.g. interface used as type annotation)
                if (node.usedLocalExports.has(exportSymbol)) continue;

                let isUsed = false;
                
                // Trace through re-export chains to find actual consumers
                if (graph.isSymbolUsedDownstream(exportSymbol, node.path)) {
                    isUsed = true;
                }

                if (!isUsed) {
                    unusedExports.push(exportSymbol);
                }
            }

            if (unusedExports.length > 0) {
                const first = unusedExports[0];
                const line = node.exportLocations.get(first) ?? node.exportLocations.get('default') ?? 0;
                const hasRuntimeKind = unusedExports.some(
                    name => !['interface', 'type'].includes(node.exportKinds.get(name) ?? '')
                );
                diagnostics.push({
                    filePath: node.path,
                    message: `Unused exports: ${unusedExports.join(', ')}`,
                    severity: hasRuntimeKind ? 'warning' : 'info',
                    line,
                    rule: this.id
                });
            }
        }

        return diagnostics;
    }
}
