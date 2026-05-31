import { describe, it, expect, beforeEach } from 'vitest';
import { DependencyGraph } from './index';

describe('DependencyGraph', () => {
    let graph: DependencyGraph;

    beforeEach(() => {
        graph = new DependencyGraph();
    });

    describe('node management', () => {
        it('adds and retrieves nodes', () => {
            graph.addNode('/a.ts');
            expect(graph.getNode('/a.ts')).toBeDefined();
            expect(graph.getNode('/a.ts')!.path).toBe('/a.ts');
        });

        it('marks entry nodes', () => {
            graph.addNode('/a.ts', true);
            expect(graph.getNode('/a.ts')!.isEntry).toBe(true);
        });

        it('promotes to entry never demotes', () => {
            graph.addNode('/a.ts');
            graph.addNode('/a.ts', true);
            expect(graph.getNode('/a.ts')!.isEntry).toBe(true);
        });
    });

    describe('edges', () => {
        it('adds edges between files', () => {
            graph.addEdge('/a.ts', '/b.ts');
            const a = graph.getNode('/a.ts')!;
            const b = graph.getNode('/b.ts')!;
            expect(a.imports.has('/b.ts')).toBe(true);
            expect(b.importedBy.has('/a.ts')).toBe(true);
        });

        it('tracks imported symbols', () => {
            graph.addEdge('/a.ts', '/b.ts', ['foo', 'bar']);
            expect(graph.getNode('/a.ts')!.importedSymbols.get('/b.ts')).toEqual(new Set(['foo', 'bar']));
            expect(graph.getNode('/b.ts')!.importedBySymbols.get('/a.ts')).toEqual(new Set(['foo', 'bar']));
        });

        it('tracks type-only imports', () => {
            graph.addEdge('/a.ts', '/b.ts', ['Foo'], ['Foo']);
            expect(graph.getNode('/b.ts')!.typeOnlyImporters.get('/a.ts')).toEqual(new Set(['Foo']));
        });

        it('tracks local names', () => {
            graph.addEdge('/a.ts', '/b.ts', ['*'], [], ['ns']);
            expect(graph.getNode('/a.ts')!.importedLocalNames.get('/b.ts')).toEqual(new Set(['ns']));
        });
    });

    describe('exported symbols', () => {
        it('sets exported symbols with metadata', () => {
            graph.setExportedSymbols('/a.ts', [
                { name: 'foo', line: 10, kind: 'function' },
                { name: 'bar', line: 20, kind: 'const' }
            ]);
            const node = graph.getNode('/a.ts')!;
            expect(node.exportedSymbols).toEqual(new Set(['foo', 'bar']));
            expect(node.exportLocations.get('foo')).toBe(10);
            expect(node.exportKinds.get('bar')).toBe('const');
        });
    });

    describe('barrel detection', () => {
        it('detects wildcard barrel', () => {
            graph.setExportedSymbols('/barrel.ts', [{ name: '*', line: 0, kind: 'named' }]);
            graph.computeBarrelFlags();
            expect(graph.getNode('/barrel.ts')!.isBarrel).toBe(true);
        });

        it('detects re-export barrel', () => {
            graph.setExportedSymbols('/index.ts', [
                { name: 'foo', line: 1, kind: 'named' },
                { name: 'bar', line: 2, kind: 'named' }
            ]);
            graph.addEdge('/index.ts', '/foo.ts', ['foo']);
            graph.addEdge('/index.ts', '/bar.ts', ['bar']);
            graph.computeBarrelFlags();
            expect(graph.getNode('/index.ts')!.isBarrel).toBe(true);
        });

        it('does not flag non-barrel', () => {
            graph.setExportedSymbols('/mod.ts', [{ name: 'foo', line: 1, kind: 'function' }]);
            // foo is a local definition, not a re-export
            graph.computeBarrelFlags();
            expect(graph.getNode('/mod.ts')!.isBarrel).toBe(false);
        });
    });

    describe('unused files', () => {
        it('finds unused file', () => {
            graph.addNode('/unused.ts');
            expect(graph.getUnusedFiles()).toHaveLength(1);
        });

        it('excludes entry files', () => {
            graph.addNode('/entry.ts', true);
            expect(graph.getUnusedFiles()).toHaveLength(0);
        });

        it('excludes barrels', () => {
            graph.addNode('/index.ts');
            graph.setExportedSymbols('/index.ts', [{ name: '*', line: 0, kind: 'named' }]);
            graph.computeBarrelFlags();
            expect(graph.getUnusedFiles()).toHaveLength(0);
        });

        it('excludes imported files', () => {
            graph.addNode('/a.ts');
            graph.addNode('/b.ts');
            graph.addNode('/entry.ts', true);
            graph.addEdge('/entry.ts', '/b.ts');
            graph.addEdge('/b.ts', '/a.ts');
            expect(graph.getUnusedFiles()).toHaveLength(0);
        });
    });

    describe('isSymbolUsedDownstream', () => {
        it('returns false for symbol with no importers', () => {
            graph.setExportedSymbols('/source.ts', [{ name: 'foo', line: 1, kind: 'function' }]);
            expect(graph.isSymbolUsedDownstream('foo', '/source.ts')).toBe(false);
        });

        it('returns true for directly consumed symbol', () => {
            graph.setExportedSymbols('/source.ts', [{ name: 'foo', line: 1, kind: 'function' }]);
            graph.addEdge('/consumer.ts', '/source.ts', ['foo']);
            expect(graph.isSymbolUsedDownstream('foo', '/source.ts')).toBe(true);
        });

        it('returns true through barrel chain', () => {
            graph.setExportedSymbols('/source.ts', [{ name: 'foo', line: 1, kind: 'function' }]);
            graph.setExportedSymbols('/barrel.ts', [{ name: 'foo', line: 1, kind: 'named' }]);
            graph.addEdge('/barrel.ts', '/source.ts', ['foo']);
            graph.addEdge('/consumer.ts', '/barrel.ts', ['foo']);
            graph.computeBarrelFlags();
            expect(graph.isSymbolUsedDownstream('foo', '/source.ts')).toBe(true);
        });

        it('returns false for barrel with no consumers', () => {
            graph.setExportedSymbols('/source.ts', [{ name: 'foo', line: 1, kind: 'function' }]);
            graph.setExportedSymbols('/barrel.ts', [{ name: 'foo', line: 1, kind: 'named' }]);
            graph.addEdge('/barrel.ts', '/source.ts', ['foo']);
            graph.computeBarrelFlags();
            expect(graph.isSymbolUsedDownstream('foo', '/source.ts')).toBe(false);
        });

        it('returns true for wildcard import', () => {
            graph.setExportedSymbols('/source.ts', [{ name: 'foo', line: 1, kind: 'function' }]);
            graph.addEdge('/consumer.ts', '/source.ts', ['*']);
            expect(graph.isSymbolUsedDownstream('foo', '/source.ts')).toBe(true);
        });
    });

    describe('framework consumption', () => {
        it('tracks framework consumed symbols', () => {
            graph.setFrameworkConsumed('/a.ts', ['AppComponent', 'metadata']);
            const node = graph.getNode('/a.ts')!;
            expect(node.frameworkConsumedSet.has('AppComponent')).toBe(true);
            expect(node.frameworkConsumedSet.has('metadata')).toBe(true);
            expect(node.frameworkConsumedSet.has('other')).toBe(false);
        });
    });

    describe('used imported names', () => {
        it('tracks used imported names', () => {
            graph.setUsedImportedNames('/a.ts', ['foo', 'bar']);
            expect(graph.getNode('/a.ts')!.usedImportedNames).toEqual(new Set(['foo', 'bar']));
        });
    });

    describe('used local exports', () => {
        it('tracks used local exports', () => {
            graph.setUsedLocalExports('/a.ts', ['Foo', 'Bar']);
            expect(graph.getNode('/a.ts')!.usedLocalExports).toEqual(new Set(['Foo', 'Bar']));
        });
    });
});
