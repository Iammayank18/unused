import { DependencyGraph, GraphNode } from '@unused/graph';
import { Diagnostic, Rule } from './index';

export class CommentedCodeRule implements Rule {
    public id = 'commented-code';

    public run(graph: DependencyGraph): Diagnostic[] {
        const diagnostics: Diagnostic[] = [];
        const nodes = graph.getAllNodes();

        for (const node of nodes) {
            if (node.comments && node.comments.length > 0) {
                for (const comment of node.comments) {
                    diagnostics.push({
                        filePath: node.path,
                        message: 'Potential commented-out code found',
                        severity: 'info',
                        line: comment.line,
                        rule: this.id
                    });
                }
            }
        }

        return diagnostics;
    }
}
