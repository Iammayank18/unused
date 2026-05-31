import { DependencyGraph, GraphNode } from '@unused/graph';

export interface Diagnostic {
    filePath: string;
    message: string;
    severity: 'error' | 'warning' | 'info';
    line?: number;
    rule?: string;
}

export interface Rule {
    id: string;
    run(graph: DependencyGraph): Diagnostic[];
}

export class UnusedFileRule implements Rule {
    public id = 'unused-file';

    public run(graph: DependencyGraph): Diagnostic[] {
        const diagnostics: Diagnostic[] = [];
        const unusedNodes = graph.getUnusedFiles();

        for (const node of unusedNodes) {
            diagnostics.push({
                filePath: node.path,
                message: 'This file is never imported by any other file in the project.',
                severity: 'warning',
                rule: this.id
            });
        }

        return diagnostics;
    }
}

export * from './unused-export-rule';
export * from './commented-code-rule';
export * from './unused-import-rule';
