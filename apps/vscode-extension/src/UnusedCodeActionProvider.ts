import * as vscode from 'vscode';

const UNUSED_IMPORT_PREFIX = 'Unused import from ';
const UNUSED_EXPORT_PREFIX = 'Unused exports: ';

interface ImportDecl {
    fullRange: vscode.Range;
    bracesRange?: vscode.Range;
    sourcePath: string;
    allSpecifiers: string[];
    isMultiLine: boolean;
}

export class UnusedCodeActionProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix
    ];

    provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range,
        context: vscode.CodeActionContext,
        _token: vscode.CancellationToken
    ): vscode.CodeAction[] | undefined {
        const actions: vscode.CodeAction[] = [];

        for (const diag of context.diagnostics) {
            if (!diag.source?.startsWith('unused.')) continue;

            if (diag.message.startsWith(UNUSED_IMPORT_PREFIX)) {
                const fix = this.createRemoveImportAction(document, diag);
                if (fix) actions.push(fix);
            } else if (diag.message.startsWith(UNUSED_EXPORT_PREFIX)) {
                const fix = this.createRemoveExportAction(document, diag);
                if (fix) actions.push(fix);
            }
        }

        return actions.length > 0 ? actions : undefined;
    }

    private parseImportMessage(msg: string): { sourcePath: string; symbols: string[] } | undefined {
        const rest = msg.slice(UNUSED_IMPORT_PREFIX.length);
        const colonIdx = rest.indexOf(':');
        if (colonIdx < 0) return undefined;
        return {
            sourcePath: rest.slice(0, colonIdx).trim(),
            symbols: rest.slice(colonIdx + 1).split(',').map(s => s.trim()).filter(Boolean)
        };
    }

    private findImportDecl(document: vscode.TextDocument, sourcePath: string): ImportDecl | undefined {
        const text = document.getText();
        const escaped = sourcePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`import\\s+[\\s\\S]*?from\\s+['"]${escaped}['"]\\s*;?`, 'g');
        let match: RegExpExecArray | null;
        while ((match = re.exec(text)) !== null) {
            const fullStart = match.index;
            const fullEnd = fullStart + match[0].length;
            const fullText = match[0];

            const braceStart = fullText.indexOf('{');
            const braceEnd = fullText.lastIndexOf('}');
            if (braceStart < 0 || braceEnd < 0) return undefined;

            const inner = fullText.slice(braceStart + 1, braceEnd).trim();
            const specifiers = inner.split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);

            const startPos = document.positionAt(fullStart);
            const endPos = document.positionAt(fullEnd);
            const braceStartPos = document.positionAt(fullStart + braceStart);
            const braceEndPos = document.positionAt(fullStart + braceEnd + 1);

            const isMultiLine = braceStartPos.line !== braceEndPos.line;

            return {
                fullRange: new vscode.Range(startPos, endPos),
                bracesRange: new vscode.Range(braceStartPos, braceEndPos),
                sourcePath,
                allSpecifiers: specifiers,
                isMultiLine
            };
        }
        return undefined;
    }

    private createRemoveImportAction(
        document: vscode.TextDocument,
        diag: vscode.Diagnostic
    ): vscode.CodeAction | undefined {
        const parsed = this.parseImportMessage(diag.message);
        if (!parsed) return undefined;

        const imp = this.findImportDecl(document, parsed.sourcePath);
        if (!imp || imp.allSpecifiers.length === 0) return undefined;

        const unusedSet = new Set(parsed.symbols);
        const allUnused = imp.allSpecifiers.every(s => unusedSet.has(s));

        if (allUnused) {
            const action = new vscode.CodeAction(
                'Remove entire unused import',
                vscode.CodeActionKind.QuickFix
            );
            action.edit = new vscode.WorkspaceEdit();
            const line = imp.fullRange.start.line;
            const endLine = imp.fullRange.end.line + (document.lineAt(imp.fullRange.end.line).text.trim() === '' ? 1 : 0);
            action.edit.delete(
                document.uri,
                new vscode.Range(line, 0, endLine, 0)
            );
            action.diagnostics = [diag];
            action.isPreferred = true;
            return action;
        }

        // Partial removal — remove only unused specifiers
        return this.createPartialImportFix(document, diag, imp, unusedSet);
    }

    private createPartialImportFix(
        document: vscode.TextDocument,
        diag: vscode.Diagnostic,
        imp: ImportDecl,
        unusedSet: Set<string>
    ): vscode.CodeAction | undefined {
        const text = document.getText();
        const fullText = text.slice(document.offsetAt(imp.fullRange.start), document.offsetAt(imp.fullRange.end));

        if (imp.isMultiLine) {
            return this.createMultiLinePartialFix(document, diag, imp, fullText, unusedSet);
        }

        return this.createSingleLinePartialFix(document, diag, imp, fullText, unusedSet);
    }

    private createMultiLinePartialFix(
        document: vscode.TextDocument,
        diag: vscode.Diagnostic,
        imp: ImportDecl,
        fullText: string,
        unusedSet: Set<string>
    ): vscode.CodeAction | undefined {
        const lines = fullText.split('\n');
        const result: string[] = [];
        let changed = false;

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed === '{' || trimmed === '}' || trimmed.startsWith('from ') || trimmed.startsWith('import ')) {
                result.push(line);
                continue;
            }
            const name = trimmed.replace(/,?\s*$/, '').split(/\s+as\s+/)[0].trim();
            if (unusedSet.has(name)) {
                changed = true;
                continue;
            }
            result.push(line);
        }

        if (!changed) return undefined;

        const finalSrc = result.join('\n').replace(/,(\s*})/g, '$1').replace(/{(\s*)}/g, '{}');

        const action = new vscode.CodeAction(
            `Remove unused symbols from import`,
            vscode.CodeActionKind.QuickFix
        );
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(document.uri, imp.fullRange, finalSrc);
        action.diagnostics = [diag];
        return action;
    }

    private createSingleLinePartialFix(
        document: vscode.TextDocument,
        diag: vscode.Diagnostic,
        imp: ImportDecl,
        fullText: string,
        unusedSet: Set<string>
    ): vscode.CodeAction | undefined {
        const remaining = imp.allSpecifiers.filter(s => !unusedSet.has(s));
        if (remaining.length === 0) return undefined;

        const braceStart = fullText.indexOf('{');
        const braceEnd = fullText.lastIndexOf('}');
        const before = fullText.slice(0, braceStart);
        const after = fullText.slice(braceEnd + 1);

        const newBlock = `{ ${remaining.join(', ')} }`;
        const finalSrc = before + newBlock + after;

        const action = new vscode.CodeAction(
            `Remove unused symbols from import`,
            vscode.CodeActionKind.QuickFix
        );
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(document.uri, imp.fullRange, finalSrc);
        action.diagnostics = [diag];
        return action;
    }

    private createRemoveExportAction(
        document: vscode.TextDocument,
        diag: vscode.Diagnostic
    ): vscode.CodeAction | undefined {
        if (diag.range.start.line < 0) return undefined;

        const line = document.lineAt(diag.range.start.line);
        const text = line.text;

        const exportMatch = text.match(/^(\s*)export\s+/);
        if (!exportMatch) return undefined;

        const action = new vscode.CodeAction(
            'Remove export keyword',
            vscode.CodeActionKind.QuickFix
        );

        const indent = exportMatch[1];
        const afterExport = text.slice(exportMatch[0].length);
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(
            document.uri,
            new vscode.Range(diag.range.start.line, 0, diag.range.start.line, text.length),
            indent + afterExport
        );
        action.diagnostics = [diag];
        action.isPreferred = true;

        return action;
    }
}
