import { DependencyGraph } from '@unused/graph';
import { Diagnostic, Rule } from './index';

export class UnusedImportRule implements Rule {
    public id = 'unused-import';

    public run(graph: DependencyGraph): Diagnostic[] {
        const diagnostics: Diagnostic[] = [];

        for (const node of graph.getAllNodes()) {
            const unusedBySource: { source: string; names: string[] }[] = [];

            for (const [sourcePath, localNames] of node.importedLocalNames.entries()) {
                const unused: string[] = [];
                for (const name of localNames) {
                    if (!node.usedImportedNames.has(name) && name !== 'default') {
                        unused.push(name);
                    }
                }
                if (unused.length > 0) {
                    unusedBySource.push({ source: sourcePath, names: unused });
                }
            }

            if (unusedBySource.length > 0) {
                for (const { source, names } of unusedBySource) {
                    diagnostics.push({
                        filePath: node.path,
                        message: `Unused import from ${source}: ${names.join(', ')}`,
                        severity: 'warning',
                        line: 0,
                        rule: this.id
                    });
                }
            }
        }

        return diagnostics;
    }
}
