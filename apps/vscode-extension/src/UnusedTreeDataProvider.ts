import * as vscode from 'vscode';
import * as path from 'path';
import { Diagnostic } from '@unused/rules';

// Unique marker — safe across esbuild minification (string comparison, no instanceof)
const FOLDER_CONTEXT = 'unused-folder';

export class UnusedTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    // Diagnostics grouped by relative folder path
    private folderKeys: string[] = [];
    private folderMap = new Map<string, Diagnostic[]>();

    setDiagnostics(diagnostics: Diagnostic[]): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const rootPath = workspaceFolders?.[0]?.uri.fsPath ?? '';

        this.folderMap = new Map();

        for (const diag of diagnostics) {
            let dir = path.dirname(diag.filePath);
            if (rootPath && dir.startsWith(rootPath)) {
                dir = dir.slice(rootPath.length);
                if (dir.startsWith('/') || dir.startsWith('\\')) {
                    dir = dir.slice(1);
                }
            }
            if (!dir) dir = '.';

            if (!this.folderMap.has(dir)) {
                this.folderMap.set(dir, []);
            }
            this.folderMap.get(dir)!.push(diag);
        }

        this.folderKeys = Array.from(this.folderMap.keys()).sort();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        // Root: return folder nodes
        if (!element) {
            const folders = this.folderKeys.map(key => {
                const count = this.folderMap.get(key)!.length;
                const item = new vscode.TreeItem(key, vscode.TreeItemCollapsibleState.Expanded);
                item.id = `folder:${key}`;
                item.contextValue = FOLDER_CONTEXT;
                item.iconPath = new vscode.ThemeIcon('folder');
                item.tooltip = key;
                item.description = `${count}`;
                return item;
            });
            return Promise.resolve(folders);
        }

        // Folder node: recover the key from the label (no id parsing needed)
        if (element.contextValue === FOLDER_CONTEXT) {
            const key = typeof element.label === 'string'
                ? element.label
                : (element.label as vscode.TreeItemLabel)?.label ?? '';
            const diags = this.folderMap.get(key) ?? [];
            return Promise.resolve(diags.map(d => makeDiagnosticItem(d)));
        }

        return Promise.resolve([]);
    }
}

function makeDiagnosticItem(diag: Diagnostic): vscode.TreeItem {
    // Use a string label so a bad path never throws and crashes the whole folder render.
    // resourceUri is set separately to get the file icon — it doesn't affect the label.
    const item = new vscode.TreeItem(
        path.basename(diag.filePath),
        vscode.TreeItemCollapsibleState.None
    );

    item.id = `diag:${diag.filePath}:${diag.message}`;
    item.resourceUri = vscode.Uri.file(diag.filePath);
    item.description = diag.message;
    item.tooltip = `${diag.filePath}\n${diag.message}`;

    const line = diag.line ? diag.line - 1 : 0;

    item.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [
            vscode.Uri.file(diag.filePath),
            { selection: new vscode.Range(line, 0, line, 0) }
        ]
    };

    return item;
}
