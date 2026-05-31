import { UnusedTreeDataProvider } from './apps/vscode-extension/src/UnusedTreeDataProvider';
import * as vscode from 'vscode';
import { Diagnostic } from '@unused/rules';

const provider = new UnusedTreeDataProvider();
const mockDiagnostics: Diagnostic[] = [
    { filePath: '/mock/root/src/App.tsx', message: 'Unused file', severity: 'warning' },
    { filePath: '/mock/root/src/components/Button.tsx', message: 'Unused file', severity: 'warning' }
];

// Mock vscode.workspace.workspaceFolders
(vscode as any).workspace = {
    workspaceFolders: [{ uri: { fsPath: '/mock/root' } }]
};

provider.setDiagnostics(mockDiagnostics);

async function test() {
    const rootNodes = await provider.getChildren();
    console.log('Root nodes:', rootNodes.length);
    for (const node of rootNodes) {
        console.log(' - Label:', node.label, 'ID:', node.id);
        const children = await provider.getChildren(node);
        console.log('   Children:', children.length);
        for (const child of children) {
            console.log('     - Child Label:', child.label, 'ID:', child.id);
        }
    }
}

test().catch(console.error);
