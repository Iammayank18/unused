import * as vscode from 'vscode';
import * as path from 'path';
import glob from 'fast-glob';
import { CoreEngine } from '@unused/core-engine';
import { UnusedTreeDataProvider } from './UnusedTreeDataProvider';
import { UnusedCodeActionProvider } from './UnusedCodeActionProvider';

export function activate(context: vscode.ExtensionContext) {
    const output = vscode.window.createOutputChannel('Unused', { log: true });
    context.subscriptions.push(output);
    output.info('Extension activated');

    const engine = new CoreEngine();
    const treeDataProvider = new UnusedTreeDataProvider();
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('unused');

    const treeView = vscode.window.createTreeView('unused.unusedFiles', {
        treeDataProvider
    });
    treeView.badge = { value: 0, tooltip: 'Run analysis for unused code' };
    context.subscriptions.push(treeView);
    context.subscriptions.push(diagnosticCollection);

    // Status bar: shows issue count after each analysis
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'unused.refresh';
    statusBarItem.text = '$(check) Unused';
    statusBarItem.tooltip = 'Click to scan for unused code';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Register code action provider for TypeScript/JavaScript files
    const codeActionSelector: vscode.DocumentSelector = [
        { scheme: 'file', language: 'typescript' },
        { scheme: 'file', language: 'typescriptreact' },
        { scheme: 'file', language: 'javascript' },
        { scheme: 'file', language: 'javascriptreact' }
    ];
    const codeActionProvider = vscode.languages.registerCodeActionsProvider(
        codeActionSelector,
        new UnusedCodeActionProvider(),
        { providedCodeActionKinds: UnusedCodeActionProvider.providedCodeActionKinds }
    );
    context.subscriptions.push(codeActionProvider);

    const runAnalysis = async (targetPath: string) => {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Unused",
            cancellable: false
        }, async (progress) => {
            progress.report({ message: `Analyzing ${targetPath} for dead code...` });

            const config = vscode.workspace.getConfiguration('unused');
            const options = {
                includePatterns: config.get<string[]>('includePatterns'),
                ignorePatterns: config.get<string[]>('ignorePatterns'),
                enabledRules: {
                    unusedFiles: config.get<boolean>('rules.unusedFiles', true),
                    unusedExports: config.get<boolean>('rules.unusedExports', true),
                    commentedCode: config.get<boolean>('rules.commentedCode', true),
                    unusedImports: config.get<boolean>('rules.unusedImports', true)
                },
                severityOverrides: {
                    unusedFiles: config.get<'error' | 'warning' | 'info'>('rules.unusedFiles.severity', 'warning'),
                    unusedExports: config.get<'error' | 'warning' | 'info'>('rules.unusedExports.severity', 'info'),
                    commentedCode: config.get<'error' | 'warning' | 'info'>('rules.commentedCode.severity', 'info'),
                    unusedImports: config.get<'error' | 'warning' | 'info'>('rules.unusedImports.severity', 'warning')
                },
                includeEntryFiles: config.get<boolean>('includeEntryFiles', false),
                includeTestFiles: config.get<boolean>('includeTestFiles', false),
                fileSizeLimit: config.get<number>('fileSizeLimit', 0)
            };

            try {
                const diagnostics = await engine.analyze(targetPath, options);
                output.info(`Analysis found ${diagnostics.length} issues`);

                treeDataProvider.setDiagnostics(diagnostics);

                if (diagnostics.length > 0) {
                    statusBarItem.text = `$(warning) Unused: ${diagnostics.length} issue${diagnostics.length === 1 ? '' : 's'}`;
                    statusBarItem.tooltip = `${diagnostics.length} issues found — click to re-scan`;
                    treeView.badge = { value: diagnostics.length, tooltip: `${diagnostics.length} issues found` };
                } else {
                    statusBarItem.text = '$(check) Unused: clean';
                    statusBarItem.tooltip = 'No issues found — click to re-scan';
                    treeView.badge = undefined;
                }

                const showProblems = config.get<boolean>('showProblemsPanel', true);
                if (showProblems) {
                    const diagnosticMap = new Map<string, vscode.Diagnostic[]>();
                    for (const d of diagnostics) {
                        const vsDiag = new vscode.Diagnostic(
                            new vscode.Range(
                                Math.max(0, (d.line ?? 1) - 1), 0,
                                Math.max(0, (d.line ?? 1) - 1), 0
                            ),
                            d.message,
                            d.severity === 'error'
                                ? vscode.DiagnosticSeverity.Error
                                : d.severity === 'warning'
                                    ? vscode.DiagnosticSeverity.Warning
                                    : vscode.DiagnosticSeverity.Information
                        );
                        vsDiag.source = 'unused.' + (d.rule ?? d.severity);
                        if (!diagnosticMap.has(d.filePath)) {
                            diagnosticMap.set(d.filePath, []);
                        }
                        diagnosticMap.get(d.filePath)!.push(vsDiag);
                    }
                    diagnosticCollection.clear();
                    for (const [filePath, diags] of diagnosticMap) {
                        diagnosticCollection.set(vscode.Uri.file(filePath), diags);
                    }
                }

                treeView.description = diagnostics.length > 0 ? `${diagnostics.length} issues` : '';

                const showNotifications = config.get<boolean>('showNotifications', true);
                if (showNotifications) {
                    if (diagnostics.length === 0) {
                        vscode.window.showInformationMessage('No issues found — your code looks clean!');
                    } else {
                        vscode.window.showInformationMessage(`Analysis complete. Found ${diagnostics.length} issues.`);
                    }
                }
            } catch (error: any) {
                output.error(`Analysis failed: ${error.message}`);
                vscode.window.showErrorMessage(`Unused Analysis failed: ${error.message}`);
            }
        });
    };

    let refreshDisposable = vscode.commands.registerCommand('unused.refresh', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage("Unused: No workspace folder open.");
            return;
        }

        const choice = await vscode.window.showQuickPick([
            { label: '$(home) Analyze Entire Workspace', target: workspaceFolders[0].uri.fsPath },
            { label: '$(folder) Choose Specific Folder...', target: 'PICK' }
        ], { placeHolder: 'Select analysis scope' });

        if (!choice) return;

        if (choice.target === 'PICK') {
            const workspacePath = workspaceFolders[0].uri.fsPath;
            
            const scanConfig = vscode.workspace.getConfiguration('unused');
            const maxDepth = scanConfig.get<number>('maxScanDepth', 8);
            const folders = await glob(['**'], {
                cwd: workspacePath,
                onlyDirectories: true,
                ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/out/**', '**/build/**', '**/.turbo/**'],
                deep: maxDepth
            });

            // Sort folders alphabetically
            folders.sort();

            const folderChoices = folders.map(f => ({
                label: `$(folder) ${f}`,
                target: path.join(workspacePath, f)
            }));

            const folderChoice = await vscode.window.showQuickPick(folderChoices, { 
                placeHolder: 'Select a workspace folder to analyze' 
            });

            if (folderChoice) {
                runAnalysis(folderChoice.target);
            }
        } else {
            runAnalysis(choice.target);
        }
    });

    let analyzeFolderDisposable = vscode.commands.registerCommand('unused.analyzeFolder', async (uri: vscode.Uri) => {
        if (uri && uri.fsPath) {
            runAnalysis(uri.fsPath);
        } else {
            vscode.window.showErrorMessage("Unused: Invalid folder selected.");
        }
    });

    context.subscriptions.push(refreshDisposable);
    context.subscriptions.push(analyzeFolderDisposable);

    let openSettingsDisposable = vscode.commands.registerCommand('unused.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', '@unused');
    });
    context.subscriptions.push(openSettingsDisposable);

    // Show details command — provides context about a diagnostic
    const showDetailsDisposable = vscode.commands.registerCommand('unused.showDetails', async (item: any) => {
        if (item?.command?.arguments) {
            const args = item.command.arguments;
            if (args.length >= 2 && args[1]?.selection) {
                const uri = args[0] as vscode.Uri;
                const line = (args[1] as any).selection.start.line;
                const doc = await vscode.workspace.openTextDocument(uri);
                const lineText = doc.lineAt(line).text;
                output.info(`Details for ${uri.fsPath}:${line + 1}`);
                output.info(`  Code: ${lineText.trim()}`);
                output.info(`  Use Problems panel or hover for full diagnostic message.`);
                output.show();
            }
        } else if (item?.filePath) {
            output.info(`Details for: ${item.filePath}`);
            output.info(`  Message: ${item.message || 'N/A'}`);
            output.show();
        }
    });
    context.subscriptions.push(showDetailsDisposable);
}

export function deactivate() {}
