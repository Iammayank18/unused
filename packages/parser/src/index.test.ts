import { describe, it, expect } from 'vitest';
import { AstParser } from './index';

function parse(code: string, ext = '.ts') {
    const parser = new AstParser();
    return parser.parseFile(`/test${ext}`, code);
}

describe('AstParser', () => {
    describe('static imports', () => {
        it('parses default import', () => {
            const r = parse(`import foo from './bar';`);
            expect(r.imports).toHaveLength(1);
            expect(r.imports[0]).toMatchObject({ path: './bar', symbols: ['default'] });
        });

        it('parses named imports', () => {
            const r = parse(`import { a, b } from './bar';`);
            expect(r.imports[0].symbols).toEqual(['a', 'b']);
        });

        it('parses namespace import', () => {
            const r = parse(`import * as ns from './bar';`);
            expect(r.imports[0].symbols).toContain('*');
        });

        it('parses type-only imports', () => {
            const r = parse(`import type { A } from './types';`);
            expect(r.imports[0].typeOnly).toEqual(['A']);
        });

        it('parses side-effect import', () => {
            const r = parse(`import './style.css';`);
            expect(r.imports[0].symbols).toEqual(['*']);
        });

        it('handles re-exports', () => {
            const r = parse(`export { a, b } from './bar';`);
            const imp = r.imports.find(i => i.path === './bar');
            expect(imp).toBeDefined();
            expect(imp!.symbols).toEqual(['a', 'b']);
            const exp = r.exports.find(e => e.name === 'a');
            expect(exp).toBeDefined();
        });

        it('handles export * from', () => {
            const r = parse(`export * from './bar';`);
            expect(r.imports[0].symbols).toEqual(['*']);
            expect(r.exports).toContainEqual(expect.objectContaining({ name: '*' }));
        });
    });

    describe('inline exports', () => {
        it('parses export const', () => {
            const r = parse(`export const foo = 1;`);
            expect(r.exports).toContainEqual(expect.objectContaining({ name: 'foo', kind: 'const' }));
        });

        it('parses export function', () => {
            const r = parse(`export function bar() {}`);
            expect(r.exports).toContainEqual(expect.objectContaining({ name: 'bar', kind: 'function' }));
        });

        it('parses export class', () => {
            const r = parse(`export class MyClass {}`);
            expect(r.exports).toContainEqual(expect.objectContaining({ name: 'MyClass', kind: 'class' }));
        });

        it('parses export interface', () => {
            const r = parse(`export interface Foo {}`);
            expect(r.exports).toContainEqual(expect.objectContaining({ name: 'Foo', kind: 'interface' }));
        });

        it('parses export default', () => {
            const r = parse(`export default class {}`);
            expect(r.exports).toContainEqual(expect.objectContaining({ name: 'default' }));
        });

        it('parses export default assignment', () => {
            const r = parse(`export default 42;`);
            expect(r.exports).toContainEqual(expect.objectContaining({ name: 'default' }));
        });
    });

    describe('local exports', () => {
        it('parses export { a, b }', () => {
            const r = parse(`const a = 1; const b = 2; export { a, b };`);
            expect(r.exports).toContainEqual(expect.objectContaining({ name: 'a', kind: 'named' }));
            expect(r.exports).toContainEqual(expect.objectContaining({ name: 'b', kind: 'named' }));
        });
    });

    describe('dynamic imports', () => {
        it('parses import() expression', () => {
            const r = parse(`const m = import('./foo');`);
            expect(r.dynamicImports).toBeDefined();
            expect(r.dynamicImports).toHaveLength(1);
            expect(r.dynamicImports![0].path).toBe('./foo');
        });

        it('parses require() call', () => {
            const r = parse(`const m = require('./foo');`);
            expect(r.dynamicImports).toBeDefined();
            expect(r.dynamicImports![0].path).toBe('./foo');
        });
    });

    describe('framework detection', () => {
        it('detects Angular @Component decorator', () => {
            const r = parse(`
                import { Component } from '@angular/core';
                @Component({ selector: 'app-root' })
                export class AppComponent {}
            `);
            expect(r.frameworkUsages).toBeDefined();
            expect(r.frameworkUsages![0]).toMatchObject({ exportName: 'AppComponent', kind: 'decorator' });
        });

        it('detects NestJS @Controller decorator', () => {
            const r = parse(`
                @Controller('cats')
                export class CatsController {}
            `);
            expect(r.frameworkUsages).toHaveLength(1);
            expect(r.frameworkUsages![0].exportName).toBe('CatsController');
        });

        it('detects Next.js metadata convention export', () => {
            const r = parse(`export const metadata = { title: 'Home' };`);
            expect(r.frameworkUsages).toHaveLength(1);
            expect(r.frameworkUsages![0]).toMatchObject({ exportName: 'metadata', kind: 'convention-export', framework: 'nextjs' });
        });

        it('detects Next.js route handler convention', () => {
            const r = parse(`export async function GET(req) {}`);
            expect(r.frameworkUsages).toHaveLength(1);
            expect(r.frameworkUsages![0].exportName).toBe('GET');
        });

        it('detects decorator on default export', () => {
            const r = parse(`
                @Injectable()
                export default class MyService {}
            `);
            expect(r.frameworkUsages).toHaveLength(1);
            expect(r.frameworkUsages![0].exportName).toBe('default');
        });
    });

    describe('local export usage tracking', () => {
        it('tracks interface used as type annotation in same file', () => {
            const r = parse(`
                export interface PerformanceInsightsProps {
                    schoolAverage: number;
                }
                export const PerformanceInsights = (props: PerformanceInsightsProps) => {};
            `);
            expect(r.usedLocalExports).toBeDefined();
            expect(r.usedLocalExports).toContain('PerformanceInsightsProps');
            // PerformanceInsights is declared but not referenced; only Props is used
            expect(r.usedLocalExports).not.toContain('PerformanceInsights');
        });

        it('tracks enum used in same file', () => {
            const r = parse(`
                export enum Status { Active, Inactive }
                const x: Status = Status.Active;
            `);
            expect(r.usedLocalExports).toBeDefined();
            expect(r.usedLocalExports).toContain('Status');
        });

        it('tracks type alias used in same file', () => {
            const r = parse(`
                export type Options = { a: string };
                const x: Options = { a: 'hello' };
            `);
            expect(r.usedLocalExports).toContain('Options');
        });

        it('does not track re-exported names', () => {
            const r = parse(`export { foo } from './bar';`);
            expect(r.usedLocalExports).toBeUndefined();
        });

        it('tracks function used locally', () => {
            const r = parse(`
                export function helper() { return 42; }
                const result = helper();
            `);
            expect(r.usedLocalExports).toContain('helper');
        });

        it('does not track unused local exports', () => {
            const r = parse(`
                export const unused = 1;
                export const used = 2;
                console.log(used);
            `);
            expect(r.usedLocalExports).toEqual(['used']);
        });
    });

    describe('intra-file usage detection', () => {
        it('detects runtime usage', () => {
            const r = parse(`
                import { foo } from './bar';
                console.log(foo);
            `);
            expect(r.usages).toHaveLength(1);
            expect(r.usages![0]).toMatchObject({ symbol: 'foo', kind: 'runtime' });
        });

        it('detects type-only usage', () => {
            const r = parse(`
                import { Foo } from './bar';
                const x: Foo = 1;
            `);
            expect(r.usages).toHaveLength(1);
            expect(r.usages![0]).toMatchObject({ symbol: 'Foo', kind: 'type-only' });
        });

        it('detects JSX usage', () => {
            const r = parse(`
                import { Button } from './ui';
                const el = <Button />;
            `, '.tsx');
            expect(r.usages).toHaveLength(1);
            expect(r.usages![0]).toMatchObject({ symbol: 'Button', kind: 'jsx' });
        });

        it('does not flag declaration names', () => {
            const r = parse(`
                import { foo } from './bar';
                const foo = 1;
            `);
            // `foo` on the const declaration is a declaration name, not a usage of the imported foo
            const usages = r.usages?.filter(u => u.symbol === 'foo') ?? [];
            expect(usages).toHaveLength(0);
        });
    });

    describe('comments extraction', () => {
        it('extracts commented code', () => {
            const r = parse(`
                // const x = 1;
                // function old() { return 42; }
            `);
            expect(r.comments).toBeDefined();
            expect(r.comments!.length).toBeGreaterThanOrEqual(2);
        });
    });
});
