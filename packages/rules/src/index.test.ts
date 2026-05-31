import { describe, it, expect, beforeEach } from 'vitest';
import { DependencyGraph } from '@unused/graph';
import { UnusedFileRule, UnusedExportRule, CommentedCodeRule, UnusedImportRule } from './index';

function makeGraph(): DependencyGraph {
    return new DependencyGraph();
}

describe('UnusedFileRule', () => {
    let graph: DependencyGraph;

    beforeEach(() => {
        graph = makeGraph();
    });

    it('flags files with no imports', () => {
        graph.addNode('/unused.ts');
        const rule = new UnusedFileRule();
        const diags = rule.run(graph);
        expect(diags).toHaveLength(1);
        expect(diags[0].filePath).toBe('/unused.ts');
    });

    it('skips entry files', () => {
        graph.addNode('/entry.ts', true);
        const rule = new UnusedFileRule();
        expect(rule.run(graph)).toHaveLength(0);
    });

    it('skips imported files', () => {
        graph.addNode('/a.ts');
        graph.addNode('/b.ts');
        graph.addNode('/entry.ts', true);
        graph.addEdge('/entry.ts', '/b.ts');
        graph.addEdge('/b.ts', '/a.ts');
        const rule = new UnusedFileRule();
        expect(rule.run(graph)).toHaveLength(0);
    });

    it('skips barrel files', () => {
        graph.addNode('/barrel.ts');
        graph.setExportedSymbols('/barrel.ts', [{ name: '*', line: 0, kind: 'named' }]);
        graph.computeBarrelFlags();
        const rule = new UnusedFileRule();
        expect(rule.run(graph)).toHaveLength(0);
    });
});

describe('UnusedExportRule', () => {
    let graph: DependencyGraph;

    beforeEach(() => {
        graph = makeGraph();
    });

    it('flags unused local export', () => {
        graph.setExportedSymbols('/mod.ts', [{ name: 'foo', line: 5, kind: 'function' }]);
        const rule = new UnusedExportRule();
        const diags = rule.run(graph);
        expect(diags).toHaveLength(1);
        expect(diags[0].message).toContain('foo');
    });

    it('skips re-exports', () => {
        graph.addEdge('/index.ts', '/source.ts', ['foo']);
        graph.setExportedSymbols('/index.ts', [{ name: 'foo', line: 1, kind: 'named' }]);
        const rule = new UnusedExportRule();
        expect(rule.run(graph)).toHaveLength(0);
    });

    it('skips used exports', () => {
        graph.setExportedSymbols('/source.ts', [{ name: 'foo', line: 5, kind: 'function' }]);
        graph.addEdge('/consumer.ts', '/source.ts', ['foo']);
        const rule = new UnusedExportRule();
        expect(rule.run(graph)).toHaveLength(0);
    });

    it('skips framework-consumed exports', () => {
        graph.setExportedSymbols('/mod.ts', [{ name: 'AppComponent', line: 5, kind: 'class' }]);
        graph.setFrameworkConsumed('/mod.ts', ['AppComponent']);
        const rule = new UnusedExportRule();
        expect(rule.run(graph)).toHaveLength(0);
    });

    it('skips exports used within the same file', () => {
        graph.setExportedSymbols('/mod.ts', [
            { name: 'Props', line: 1, kind: 'interface' },
            { name: 'Component', line: 5, kind: 'function' }
        ]);
        graph.setUsedLocalExports('/mod.ts', ['Props', 'Component']);
        const rule = new UnusedExportRule();
        expect(rule.run(graph)).toHaveLength(0);
    });

    it('only skips locally-used exports, not unused ones', () => {
        graph.setExportedSymbols('/mod.ts', [
            { name: 'myUsed', line: 1, kind: 'function' },
            { name: 'myUnused', line: 5, kind: 'function' }
        ]);
        graph.setUsedLocalExports('/mod.ts', ['myUsed']);
        const rule = new UnusedExportRule();
        const diags = rule.run(graph);
        expect(diags).toHaveLength(1);
        expect(diags[0].message).toContain('myUnused');
        expect(diags[0].message).not.toContain('myUsed');
    });

    it('skips entry point exports', () => {
        graph.setExportedSymbols('/entry.ts', [{ name: 'foo', line: 5, kind: 'function' }]);
        graph.addNode('/entry.ts', true);
        const rule = new UnusedExportRule();
        expect(rule.run(graph)).toHaveLength(0);
    });

    it('does not flag wildcard export indicator', () => {
        graph.setExportedSymbols('/barrel.ts', [{ name: '*', line: 0, kind: 'named' }]);
        const rule = new UnusedExportRule();
        expect(rule.run(graph)).toHaveLength(0);
    });
});

describe('UnusedImportRule', () => {
    let graph: DependencyGraph;

    beforeEach(() => {
        graph = makeGraph();
    });

    it('flags unused import', () => {
        graph.addEdge('/consumer.ts', '/source.ts', ['foo'], [], ['foo']);
        const rule = new UnusedImportRule();
        const diags = rule.run(graph);
        expect(diags).toHaveLength(1);
        expect(diags[0].message).toContain('foo');
    });

    it('skips used import', () => {
        graph.addEdge('/consumer.ts', '/source.ts', ['foo'], [], ['foo']);
        graph.setUsedImportedNames('/consumer.ts', ['foo']);
        const rule = new UnusedImportRule();
        expect(rule.run(graph)).toHaveLength(0);
    });

    it('skips default import', () => {
        graph.addEdge('/consumer.ts', '/source.ts', ['default'], [], ['default']);
        const rule = new UnusedImportRule();
        expect(rule.run(graph)).toHaveLength(0); // default is excluded from unused checks
    });
});

describe('CommentedCodeRule', () => {
    let graph: DependencyGraph;

    beforeEach(() => {
        graph = makeGraph();
    });

    it('flags files with commented code', () => {
        graph.setComments('/mod.ts', [{ text: '// const x = 1;', line: 3 }]);
        const rule = new CommentedCodeRule();
        const diags = rule.run(graph);
        expect(diags).toHaveLength(1);
        expect(diags[0].filePath).toBe('/mod.ts');
    });

    it('skips files without comments', () => {
        graph.addNode('/clean.ts');
        const rule = new CommentedCodeRule();
        expect(rule.run(graph)).toHaveLength(0);
    });
});
