import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';

let previewPanel: vscode.WebviewPanel | undefined;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('NovaType');
    outputChannel.appendLine('NovaType extension activated');

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('novatype.preview', () => openPreview(context)),
        vscode.commands.registerCommand('novatype.compile', () => compile(false)),
        vscode.commands.registerCommand('novatype.compileAndOpen', () => compile(true))
    );

    // Auto-refresh on save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (document.languageId === 'typst' && previewPanel) {
                const config = vscode.workspace.getConfiguration('novatype');
                if (config.get('preview.autoRefresh')) {
                    refreshPreview(document);
                }
            }
        })
    );
}

export function deactivate() {
    if (previewPanel) {
        previewPanel.dispose();
    }
}

/**
 * Get the path to the nova binary.
 * Uses custom path from settings, or falls back to 'nova' in PATH.
 */
function getNovaBinaryPath(): string {
    const config = vscode.workspace.getConfiguration('novatype');
    const customPath = config.get<string>('binaryPath');

    if (customPath && customPath.trim() !== '') {
        outputChannel.appendLine(`Using custom binary path: ${customPath}`);
        return customPath;
    }

    // Use 'nova' from PATH
    return 'nova';
}

/**
 * Open the live preview panel.
 */
async function openPreview(context: vscode.ExtensionContext) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'typst') {
        vscode.window.showWarningMessage('Open a .typ file to preview');
        return;
    }

    if (previewPanel) {
        previewPanel.reveal(vscode.ViewColumn.Beside);
    } else {
        previewPanel = vscode.window.createWebviewPanel(
            'novatypePreview',
            'NovaType Preview',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        previewPanel.onDidDispose(() => {
            previewPanel = undefined;
        });
    }

    await refreshPreview(editor.document);
}

/**
 * Refresh the preview with the current document.
 */
async function refreshPreview(document: vscode.TextDocument) {
    if (!previewPanel) {
        return;
    }

    const novaBinary = getNovaBinaryPath();
    const filePath = document.uri.fsPath;
    const tempSvgPath = filePath.replace(/\.typ$/, '.preview.svg');

    try {
        // Compile to SVG
        await new Promise<void>((resolve, reject) => {
            const args = ['compile', filePath, '--format', 'svg', '--output', tempSvgPath];
            outputChannel.appendLine(`Running: ${novaBinary} ${args.join(' ')}`);

            const process = cp.spawn(novaBinary, args, {
                cwd: path.dirname(filePath)
            });

            let stderr = '';
            process.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(stderr || `Exit code: ${code}`));
                }
            });

            process.on('error', (err) => {
                reject(err);
            });
        });

        // Read SVG and display
        const svgContent = await vscode.workspace.fs.readFile(vscode.Uri.file(tempSvgPath));
        const svgString = Buffer.from(svgContent).toString('utf-8');

        previewPanel.webview.html = getPreviewHtml(svgString);

        // Clean up temp file
        try {
            await vscode.workspace.fs.delete(vscode.Uri.file(tempSvgPath));
        } catch {
            // Ignore cleanup errors
        }

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`Compilation error: ${errorMessage}`);
        previewPanel.webview.html = getErrorHtml(errorMessage);
    }
}

/**
 * Compile the current document.
 */
async function compile(openAfter: boolean) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'typst') {
        vscode.window.showWarningMessage('Open a .typ file to compile');
        return;
    }

    // Save the document first
    await editor.document.save();

    const novaBinary = getNovaBinaryPath();
    const filePath = editor.document.uri.fsPath;
    const config = vscode.workspace.getConfiguration('novatype');
    const format = config.get<string>('compile.outputFormat') || 'pdf';
    const outputPath = filePath.replace(/\.typ$/, `.${format}`);

    const args = ['compile', filePath, '--format', format, '--output', outputPath];
    if (openAfter || config.get('compile.openAfterCompile')) {
        args.push('--open');
    }

    outputChannel.appendLine(`Running: ${novaBinary} ${args.join(' ')}`);
    outputChannel.show();

    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Compiling document...',
                cancellable: false
            },
            async () => {
                return new Promise<void>((resolve, reject) => {
                    const process = cp.spawn(novaBinary, args, {
                        cwd: path.dirname(filePath)
                    });

                    process.stdout.on('data', (data) => {
                        outputChannel.appendLine(data.toString());
                    });

                    process.stderr.on('data', (data) => {
                        outputChannel.appendLine(data.toString());
                    });

                    process.on('close', (code) => {
                        if (code === 0) {
                            resolve();
                        } else {
                            reject(new Error(`Compilation failed with exit code ${code}`));
                        }
                    });

                    process.on('error', (err) => {
                        reject(err);
                    });
                });
            }
        );

        vscode.window.showInformationMessage(`Compiled: ${path.basename(outputPath)}`);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Compilation failed: ${errorMessage}`);
        outputChannel.appendLine(`Error: ${errorMessage}`);
    }
}

/**
 * Generate HTML for the preview panel.
 */
function getPreviewHtml(svgContent: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NovaType Preview</title>
    <style>
        body {
            margin: 0;
            padding: 20px;
            background: #1e1e1e;
            display: flex;
            justify-content: center;
            overflow: auto;
        }
        .page {
            background: white;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            margin-bottom: 20px;
        }
        .page svg {
            display: block;
            max-width: 100%;
            height: auto;
        }
    </style>
</head>
<body>
    <div class="page">
        ${svgContent}
    </div>
</body>
</html>`;
}

/**
 * Generate HTML for error display.
 */
function getErrorHtml(error: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NovaType Error</title>
    <style>
        body {
            margin: 0;
            padding: 40px;
            background: #1e1e1e;
            color: #f48771;
            font-family: 'Consolas', 'Monaco', monospace;
        }
        h2 {
            color: #f48771;
            margin-bottom: 20px;
        }
        pre {
            background: #2d2d2d;
            padding: 20px;
            border-radius: 8px;
            overflow: auto;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
    </style>
</head>
<body>
    <h2>Compilation Error</h2>
    <pre>${escapeHtml(error)}</pre>
</body>
</html>`;
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
