import * as ts from 'typescript';

export interface ImportDetails {
    path: string;
    symbols: string[];
    localNames?: string[];
    typeOnly?: string[];
}

export interface ExportInfo {
    name: string;
    line: number;
    kind: string;
}

export interface UsageInfo {
    symbol: string;
    line: number;
    kind: 'runtime' | 'type-only' | 'jsx';
}

export interface FrameworkUsage {
    exportName: string;
    kind: 'decorator' | 'convention-export';
    framework?: string;
}

export interface DynamicImport {
    path: string;
    line: number;
}

export interface ParsedFile {
    filePath: string;
    imports: ImportDetails[];
    exports: ExportInfo[];
    comments?: { text: string, line: number }[];
    usages?: UsageInfo[];
    frameworkUsages?: FrameworkUsage[];
    dynamicImports?: DynamicImport[];
    usedLocalExports?: string[];
}

// Framework decorator names (Angular, NestJS, TypeORM, etc.)
const FRAMEWORK_DECORATORS = new Set([
    'Component', 'Directive', 'Pipe', 'NgModule', 'Injectable',
    'Input', 'Output', 'HostListener', 'HostBinding',
    'ViewChild', 'ViewChildren', 'ContentChild', 'ContentChildren',
    'Controller', 'Module', 'Service', 'Repository',
    'Middleware', 'Guard', 'Interceptor', 'ExceptionFilter',
    'Get', 'Post', 'Put', 'Delete', 'Patch', 'Options', 'Head',
    'Entity', 'Column', 'OneToMany', 'ManyToOne', 'JoinColumn',
    'PrimaryGeneratedColumn', 'PrimaryColumn', 'ManyToMany',
    'OneToOne', 'JoinTable', 'Index', 'Unique',
]);

// Convention export names consumed by frameworks without explicit import
const NEXTJS_CONVENTION_EXPORTS = new Set([
    'metadata', 'generateMetadata', 'generateStaticParams', 'generateViewport',
    'dynamic', 'runtime', 'revalidate', 'preferredRegion',
    'getServerSideProps', 'getStaticProps', 'getStaticPaths',
    'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD',
]);

function getDecoratorName(d: ts.Decorator): string | undefined {
    const expr = d.expression;
    if (ts.isIdentifier(expr)) return expr.text;
    if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) return expr.expression.text;
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) return expr.name.text;
    return undefined;
}

// Edge 10: Recursively extract identifier names from destructuring binding patterns
function extractBindingNames(pattern: ts.BindingPattern): string[] {
    const names: string[] = [];
    for (const element of pattern.elements) {
        if (ts.isOmittedExpression(element)) continue;
        if (ts.isBindingElement(element)) {
            if (ts.isIdentifier(element.name)) {
                names.push(element.name.text);
            } else if (ts.isObjectBindingPattern(element.name) || ts.isArrayBindingPattern(element.name)) {
                names.push(...extractBindingNames(element.name));
            }
        }
    }
    return names;
}

export class AstParser {
    public parseFile(filePath: string, fileContent: string): ParsedFile {
        const scriptKind = filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
            ? ts.ScriptKind.TSX
            : ts.ScriptKind.TS;
        const sourceFile = ts.createSourceFile(
            filePath,
            fileContent,
            ts.ScriptTarget.Latest,
            true,
            scriptKind
        );

        const imports: ImportDetails[] = [];
        const exports: ExportInfo[] = [];
        const comments: { text: string, line: number }[] = [];
        const frameworkUsages: FrameworkUsage[] = [];
        const dynamicImports: DynamicImport[] = [];

        // --- 1. Extract Comments Using TypeScript Native API ---
        const text = sourceFile.text;
        const commentPositions = new Set<number>();

        const extractComments = (pos: number, isTrailing: boolean = false) => {
            const ranges = isTrailing
                ? ts.getTrailingCommentRanges(text, pos)
                : ts.getLeadingCommentRanges(text, pos);
            if (!ranges) return;

            for (const range of ranges) {
                if (commentPositions.has(range.pos)) continue;
                commentPositions.add(range.pos);

                const commentText = text.substring(range.pos, range.end);
                const line = sourceFile.getLineAndCharacterOfPosition(range.pos).line + 1;

                // Bug 4: Skip JSDoc blocks — they contain { } but are documentation, not dead code
                const isJsDoc = commentText.startsWith('/**');
                // Skip comments that are purely @annotation lines (e.g. // @ts-ignore, // @deprecated)
                const isAnnotationOnly = /^\/[/*]\s*@\w/.test(commentText.trimStart());

                if (isJsDoc || isAnnotationOnly) continue;

                // Edge 7: Expanded heuristic to catch more code patterns
                // Bug 4 (cont): the original regex missed var, class, interface, type, if, return, throw, etc.
                const CODE_HEURISTIC = /(\{|\}|;|\bconst\b|\blet\b|\bvar\b|\bfunction\b|\bclass\b|\binterface\b|\btype\b|\benum\b|\bimport\b|\bexport\b|\bif\b|\breturn\b|\bthrow\b|=>|this\.|new\s+\w)/;

                if (CODE_HEURISTIC.test(commentText)) {
                    comments.push({ text: commentText, line });
                }
            }
        };

        // --- 2. Extract AST Nodes (Imports & Exports) ---
        const visit = (node: ts.Node) => {
            extractComments(node.pos);
            extractComments(node.end, true);

            // Imports
            if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
                const modulePath = node.moduleSpecifier.text;
                const symbols: string[] = [];
                const localNames: string[] = [];
                const typeOnly: string[] = [];
                const isTypeOnlyClause = node.importClause?.isTypeOnly ?? false;

                if (node.importClause) {
                    if (node.importClause.name) {
                        symbols.push('default');
                        localNames.push(node.importClause.name.text);
                        if (isTypeOnlyClause) typeOnly.push('default');
                    }
                    if (node.importClause.namedBindings) {
                        if (ts.isNamedImports(node.importClause.namedBindings)) {
                            node.importClause.namedBindings.elements.forEach(el => {
                                const elIsTypeOnly = isTypeOnlyClause || el.isTypeOnly;
                                symbols.push(el.name.text);
                                localNames.push(el.name.text);
                                if (elIsTypeOnly) typeOnly.push(el.name.text);
                                if (el.propertyName) {
                                    symbols.push(el.propertyName.text);
                                    if (elIsTypeOnly) typeOnly.push(el.propertyName.text);
                                }
                            });
                        } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
                            symbols.push('*');
                            symbols.push(node.importClause.namedBindings.name.text);
                            localNames.push(node.importClause.namedBindings.name.text);
                            if (isTypeOnlyClause) {
                                typeOnly.push('*');
                                typeOnly.push(node.importClause.namedBindings.name.text);
                            }
                        }
                    }
                } else {
                    // import './style.css' — side-effect import
                    symbols.push('*');
                }
                imports.push({ path: modulePath, symbols, localNames, ...(typeOnly.length > 0 && { typeOnly }) });

            } else if (ts.isCallExpression(node)) {
                // Dynamic Imports / Require
                if (
                    node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                    (ts.isIdentifier(node.expression) && node.expression.text === 'require')
                ) {
                    if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
                        const path = (node.arguments[0] as ts.StringLiteral).text;
                        const line = sourceFile.getLineAndCharacterOfPosition(node.arguments[0].pos).line + 1;
                        dynamicImports.push({ path, line });
                    }
                }
            }

            // Exports
            if (ts.isExportDeclaration(node)) {
                if (node.exportClause && ts.isNamedExports(node.exportClause)) {
                    if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
                        // export { a, b } or export { a as b } from './bar' — re-export
                        // Push import edge for the source symbols
                        const symbols = node.exportClause.elements.map(el =>
                            el.propertyName ? el.propertyName.text : el.name.text
                        );
                        imports.push({ path: node.moduleSpecifier.text, symbols });
                        // Also push export names for barrel detection and transitive resolution
                        node.exportClause.elements.forEach(el => {
                            const line = sourceFile.getLineAndCharacterOfPosition(el.name.pos).line + 1;
                            exports.push({ name: el.name.text, line, kind: 'named' });
                        });
                    } else {
                        // export { a, b } or export { a as b } — local export
                        node.exportClause.elements.forEach(el => {
                            const line = sourceFile.getLineAndCharacterOfPosition(el.name.pos).line + 1;
                            exports.push({ name: el.name.text, line, kind: 'named' });
                        });
                    }
                } else if (node.exportClause && ts.isNamespaceExport(node.exportClause)) {
                    // Edge 5: export * as namespace from '...'
                    if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
                        imports.push({ path: node.moduleSpecifier.text, symbols: ['*'] });
                        const line = sourceFile.getLineAndCharacterOfPosition(node.exportClause.name.pos).line + 1;
                        exports.push({ name: node.exportClause.name.text, line, kind: 'named' });
                    }
                } else if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
                    // Bug 3: export * from '...' — add import edge AND mark this file as re-exporting everything
                    imports.push({ path: node.moduleSpecifier.text, symbols: ['*'] });
                    exports.push({ name: '*', line: 0, kind: 'named' }); // signals UnusedExportRule to skip symbol-level checking for this file
                }
            } else if (ts.isExportAssignment(node)) {
                const line = sourceFile.getLineAndCharacterOfPosition(node.pos).line + 1;
                exports.push({ name: 'default', line, kind: 'default' });
            } else if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
                // Inline exports: export const foo = 1; export function bar() {} etc.
                if (ts.isVariableStatement(node)) {
                    node.declarationList.declarations.forEach(decl => {
                        if (ts.isIdentifier(decl.name)) {
                            const name = decl.name.text;
                            const line = sourceFile.getLineAndCharacterOfPosition(decl.name.pos).line + 1;
                            exports.push({ name, line, kind: 'const' });
                            if (NEXTJS_CONVENTION_EXPORTS.has(name)) {
                                frameworkUsages.push({ exportName: name, kind: 'convention-export', framework: 'nextjs' });
                            }
                        } else if (ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name)) {
                            const names = extractBindingNames(decl.name);
                            const line = sourceFile.getLineAndCharacterOfPosition(decl.name.pos).line + 1;
                            names.forEach(name => {
                                exports.push({ name, line, kind: 'const' });
                                if (NEXTJS_CONVENTION_EXPORTS.has(name)) {
                                    frameworkUsages.push({ exportName: name, kind: 'convention-export', framework: 'nextjs' });
                                }
                            });
                        }
                    });
                } else if (
                    ts.isFunctionDeclaration(node) ||
                    ts.isClassDeclaration(node) ||
                    ts.isInterfaceDeclaration(node) ||
                    ts.isTypeAliasDeclaration(node) ||
                    ts.isEnumDeclaration(node)
                ) {
                    let kind: string;
                    if (ts.isFunctionDeclaration(node)) kind = 'function';
                    else if (ts.isClassDeclaration(node)) kind = 'class';
                    else if (ts.isInterfaceDeclaration(node)) kind = 'interface';
                    else if (ts.isTypeAliasDeclaration(node)) kind = 'type';
                    else kind = 'enum';

                    if (ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) {
                        const line = sourceFile.getLineAndCharacterOfPosition(node.pos).line + 1;
                        exports.push({ name: 'default', line, kind: 'default' });
                        const decors = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
                        if (decors?.some(d => FRAMEWORK_DECORATORS.has(getDecoratorName(d) ?? ''))) {
                            frameworkUsages.push({ exportName: 'default', kind: 'decorator' });
                        }
                    } else if (node.name && ts.isIdentifier(node.name)) {
                        const name = node.name.text;
                        const line = sourceFile.getLineAndCharacterOfPosition(node.name.pos).line + 1;
                        exports.push({ name, line, kind });
                        const decors = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
                        if (decors?.some(d => FRAMEWORK_DECORATORS.has(getDecoratorName(d) ?? ''))) {
                            frameworkUsages.push({ exportName: name, kind: 'decorator' });
                        }
                        if (ts.isFunctionDeclaration(node) && NEXTJS_CONVENTION_EXPORTS.has(name)) {
                            frameworkUsages.push({ exportName: name, kind: 'convention-export', framework: 'nextjs' });
                        }
                    }
                }
            }

            ts.forEachChild(node, visit);
        };

        visit(sourceFile);

        // --- 3. Second Pass: Find Identifier References ---
        const importedLocalNameSet = new Set<string>();
        for (const imp of imports) {
            if (imp.localNames) {
                for (const name of imp.localNames) {
                    importedLocalNameSet.add(name);
                }
            }
        }

        // Build set of locally-declared export names (not re-exports)
        const localExportNames = new Set<string>();
        const reExportNames = new Set<string>();
        for (const imp of imports) {
            for (const sym of imp.symbols) {
                reExportNames.add(sym);
            }
        }
        for (const exp of exports) {
            if (exp.name === '*' || exp.name === 'default') continue;
            if (!reExportNames.has(exp.name)) {
                localExportNames.add(exp.name);
            }
        }

        const usages: UsageInfo[] = [];
        const usedLocalExportsSet = new Set<string>();

        const isDeclarationName = (id: ts.Identifier): boolean => {
            const p = id.parent;
            if (!p) return false;
            return (
                (ts.isVariableDeclaration(p) && p.name === id) ||
                (ts.isFunctionDeclaration(p) && p.name === id) ||
                (ts.isClassDeclaration(p) && p.name === id) ||
                (ts.isInterfaceDeclaration(p) && p.name === id) ||
                (ts.isTypeAliasDeclaration(p) && p.name === id) ||
                (ts.isEnumDeclaration(p) && p.name === id) ||
                (ts.isModuleDeclaration(p) && p.name === id) ||
                (ts.isBindingElement(p) && p.name === id) ||
                (ts.isParameter(p) && p.name === id) ||
                (ts.isPropertyDeclaration(p) && p.name === id) ||
                (ts.isMethodDeclaration(p) && p.name === id) ||
                (ts.isGetAccessorDeclaration(p) && p.name === id) ||
                (ts.isSetAccessorDeclaration(p) && p.name === id)
            );
        };

        const classifyUsage = (id: ts.Identifier): 'runtime' | 'type-only' | 'jsx' => {
            const p = id.parent;
            if (!p) return 'runtime';
            if (ts.isJsxOpeningElement(p) || ts.isJsxClosingElement(p) || ts.isJsxSelfClosingElement(p)) return 'jsx';
            let cur: ts.Node = p;
            while (cur && cur.kind !== ts.SyntaxKind.SourceFile) {
                if (
                    ts.isTypeReferenceNode(cur) ||
                    ts.isTypeQueryNode(cur) ||
                    ts.isTypeLiteralNode(cur) ||
                    ts.isTypeOperatorNode(cur) ||
                    ts.isMappedTypeNode(cur) ||
                    ts.isConditionalTypeNode(cur) ||
                    ts.isIndexedAccessTypeNode(cur) ||
                    ts.isArrayTypeNode(cur) ||
                    ts.isTupleTypeNode(cur) ||
                    ts.isUnionTypeNode(cur) ||
                    ts.isIntersectionTypeNode(cur) ||
                    ts.isFunctionTypeNode(cur) ||
                    ts.isConstructorTypeNode(cur) ||
                    ts.isParenthesizedTypeNode(cur)
                ) {
                    return 'type-only';
                }
                cur = cur.parent;
            }
            return 'runtime';
        };

        const findUsages = (node: ts.Node) => {
            if (ts.isImportDeclaration(node)) return;
            if (ts.isExportDeclaration(node) && node.moduleSpecifier) return;

            if (ts.isIdentifier(node) && !isDeclarationName(node)) {
                if (importedLocalNameSet.has(node.text)) {
                    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
                    usages.push({ symbol: node.text, line, kind: classifyUsage(node) });
                }
                if (localExportNames.has(node.text)) {
                    usedLocalExportsSet.add(node.text);
                }
            }

            ts.forEachChild(node, findUsages);
        };
        findUsages(sourceFile);

        const usedLocalExports = usedLocalExportsSet.size > 0 ? Array.from(usedLocalExportsSet) : undefined;

        return {
            filePath,
            imports,
            exports,
            comments,
            usages: usages.length > 0 ? usages : undefined,
            frameworkUsages: frameworkUsages.length > 0 ? frameworkUsages : undefined,
            dynamicImports: dynamicImports.length > 0 ? dynamicImports : undefined,
            usedLocalExports
        };
    }
}
