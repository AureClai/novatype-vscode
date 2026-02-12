import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as https from 'https';

let previewPanel: vscode.WebviewPanel | undefined;
let outputChannel: vscode.OutputChannel;
let currentPreviewPdfPath: string | undefined;
let currentPreviewSourcePath: string | undefined;
let diagnosticCollection: vscode.DiagnosticCollection;
let compilationDiagnostics: vscode.DiagnosticCollection;
let wordCountStatusBar: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('NovaType');
    outputChannel.appendLine('NovaType extension activated');

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('novatype.preview', () => openPreview(context)),
        vscode.commands.registerCommand('novatype.compile', () => compile(false)),
        vscode.commands.registerCommand('novatype.compileAndOpen', () => compile(true)),
        vscode.commands.registerCommand('novatype.configure', () => configureExtension()),
        vscode.commands.registerCommand('novatype.searchBibliography', () => searchBibliography()),
        vscode.commands.registerCommand('novatype.insertDOI', () => insertFromDOI()),
        vscode.commands.registerCommand('novatype.list.indent', () => listIndent()),
        vscode.commands.registerCommand('novatype.list.outdent', () => listOutdent()),
        vscode.commands.registerCommand('novatype.editTable', (uri: vscode.Uri, tableOffset: number) => editTable(context, uri, tableOffset)),
        vscode.commands.registerCommand('novatype.createTable', () => createTable(context))
    );

    // Register completion providers
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            'typst',
            new ReferenceCompletionProvider(),
            '@'
        ),
        vscode.languages.registerCompletionItemProvider(
            'typst',
            new LabelCompletionProvider(),
            '<'
        )
    );

    // Register document symbol provider (Outline), definition, references, folding
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider('typst', new NovaDocumentSymbolProvider()),
        vscode.languages.registerDefinitionProvider('typst', new NovaDefinitionProvider()),
        vscode.languages.registerReferenceProvider('typst', new NovaReferenceProvider()),
        vscode.languages.registerFoldingRangeProvider('typst', new NovaFoldingRangeProvider()),
        vscode.languages.registerCodeLensProvider('typst', new TableCodeLensProvider())
    );

    // Word count status bar
    wordCountStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    wordCountStatusBar.tooltip = 'Word count (Typst document)';
    context.subscriptions.push(wordCountStatusBar);
    updateWordCount(vscode.window.activeTextEditor);
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => updateWordCount(editor)),
        vscode.workspace.onDidChangeTextDocument((e) => {
            if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) {
                updateWordCount(vscode.window.activeTextEditor);
            }
        })
    );

    // Diagnostics for unescaped @ in emails
    diagnosticCollection = vscode.languages.createDiagnosticCollection('novatype');
    context.subscriptions.push(diagnosticCollection);

    compilationDiagnostics = vscode.languages.createDiagnosticCollection('novatype-compilation');
    context.subscriptions.push(compilationDiagnostics);

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider('typst', new EscapeAtCodeActionProvider(), {
            providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
        })
    );

    // Run diagnostics on open and edit
    if (vscode.window.activeTextEditor?.document.languageId === 'typst') {
        updateDiagnostics(vscode.window.activeTextEditor.document);
    }
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.languageId === 'typst') {
                updateDiagnostics(e.document);
            }
        }),
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor && editor.document.languageId === 'typst') {
                updateDiagnostics(editor.document);
            }
        })
    );

    // Auto-refresh on save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (document.languageId === 'typst') {
                const config = vscode.workspace.getConfiguration('novatype');
                if (config.get('preview.autoRefresh') && currentPreviewSourcePath) {
                    const backend = config.get<string>('preview.backend') || 'builtin';
                    if (backend === 'vscode-pdf' && currentPreviewPdfPath) {
                        openPreviewWithVscodePdf(currentPreviewSourcePath);
                    } else if (previewPanel) {
                        refreshPreview(currentPreviewSourcePath, context);
                    }
                }
            }
        })
    );
}

export function deactivate() {
    if (previewPanel) {
        previewPanel.dispose();
    }
    if (tableEditorPanel) {
        tableEditorPanel.dispose();
    }
    if (wordCountStatusBar) {
        wordCountStatusBar.dispose();
    }
}

// ============================================================================
// Diagnostics: unescaped @ detection
// ============================================================================

const DIAGNOSTIC_SOURCE = 'NovaType';

/**
 * Scan a document for unescaped @ that look like emails or typos.
 * A valid Typst reference is @identifier at the start of a word (preceded by whitespace or line start).
 * An unescaped @ preceded by a letter/digit (e.g. user@domain) should be flagged.
 */
function updateDiagnostics(document: vscode.TextDocument) {
    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();
    // Match @ preceded by a word character (email pattern: user@domain)
    const emailAtRegex = /[a-zA-Z0-9]@[a-zA-Z0-9]/g;
    let match;

    while ((match = emailAtRegex.exec(text)) !== null) {
        const atIndex = match.index + 1; // position of the @
        // Check it's not inside a raw block, comment, or already escaped
        const lineNum = document.positionAt(atIndex).line;
        const line = document.lineAt(lineNum).text;
        const col = document.positionAt(atIndex).character;

        // Skip if in a comment
        if (line.trimStart().startsWith('//')) {
            continue;
        }

        // Skip if preceded by backslash (already escaped)
        if (col > 0 && line[col - 1] === '\\') {
            continue;
        }

        // Skip if inside a raw block (backticks)
        const beforeAt = line.substring(0, col);
        const backtickCount = (beforeAt.match(/`/g) || []).length;
        if (backtickCount % 2 !== 0) {
            continue;
        }

        // Skip if inside a string (double quotes)
        const quoteCount = (beforeAt.match(/(?<!\\)"/g) || []).length;
        if (quoteCount % 2 !== 0) {
            continue;
        }

        const range = new vscode.Range(
            document.positionAt(atIndex),
            document.positionAt(atIndex + 1)
        );

        const diag = new vscode.Diagnostic(
            range,
            'Unescaped @ — use \\@ in emails to avoid a reference lookup',
            vscode.DiagnosticSeverity.Warning
        );
        diag.source = DIAGNOSTIC_SOURCE;
        diag.code = 'unescaped-at';
        diagnostics.push(diag);
    }

    diagnosticCollection.set(document.uri, diagnostics);
}

/**
 * Code action provider: quick fix to escape @ → \@
 */
class EscapeAtCodeActionProvider implements vscode.CodeActionProvider {
    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range,
        context: vscode.CodeActionContext
    ): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];

        for (const diag of context.diagnostics) {
            if (diag.source !== DIAGNOSTIC_SOURCE || diag.code !== 'unescaped-at') {
                continue;
            }

            const fix = new vscode.CodeAction(
                'Escape as \\@',
                vscode.CodeActionKind.QuickFix
            );
            fix.edit = new vscode.WorkspaceEdit();
            fix.edit.replace(document.uri, diag.range, '\\@');
            fix.isPreferred = true;
            fix.diagnostics = [diag];
            actions.push(fix);
        }

        // If there are multiple unescaped @, offer a "fix all" action
        const allDiags = diagnosticCollection.get(document.uri);
        const atDiags = allDiags?.filter(d => d.code === 'unescaped-at') || [];
        if (atDiags.length > 1 && context.diagnostics.some(d => d.code === 'unescaped-at')) {
            const fixAll = new vscode.CodeAction(
                `Escape all ${atDiags.length} unescaped @`,
                vscode.CodeActionKind.QuickFix
            );
            fixAll.edit = new vscode.WorkspaceEdit();
            // Apply from end to start to preserve positions
            const sorted = [...atDiags].sort((a, b) => b.range.start.compareTo(a.range.start));
            for (const d of sorted) {
                fixAll.edit.replace(document.uri, d.range, '\\@');
            }
            fixAll.diagnostics = [...atDiags];
            actions.push(fixAll);
        }

        return actions;
    }
}

// ============================================================================
// Compilation error diagnostics
// ============================================================================

/**
 * Parse compilation errors/warnings from Nova/Typst stderr output.
 */
function parseCompilationErrors(
    stderr: string,
    documentPath: string
): Map<string, vscode.Diagnostic[]> {
    const diagnosticsMap = new Map<string, vscode.Diagnostic[]>();
    const docDir = path.dirname(documentPath);

    // Typst error format:
    // error: message
    //   ┌─ file.typ:line:column
    const errorRegex = /(error|warning):\s*(.+?)(?:\r?\n)\s*┌─\s*(.+?):(\d+):(\d+)/g;
    let match;

    while ((match = errorRegex.exec(stderr)) !== null) {
        const severity = match[1] === 'error'
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning;
        const message = match[2].trim();
        const filePart = match[3].trim();
        const lineNum = parseInt(match[4], 10) - 1;
        const colNum = parseInt(match[5], 10) - 1;

        // Skip package references
        if (filePart.startsWith('@')) {
            continue;
        }

        const filePath = path.isAbsolute(filePart)
            ? filePart
            : path.join(docDir, filePart);

        const fileUri = vscode.Uri.file(filePath).toString();
        const range = new vscode.Range(
            Math.max(0, lineNum), Math.max(0, colNum),
            Math.max(0, lineNum), Math.max(0, colNum) + 1
        );

        const diagnostic = new vscode.Diagnostic(range, message, severity);
        diagnostic.source = 'NovaType';

        if (!diagnosticsMap.has(fileUri)) {
            diagnosticsMap.set(fileUri, []);
        }
        diagnosticsMap.get(fileUri)!.push(diagnostic);
    }

    return diagnosticsMap;
}

function setCompilationDiagnostics(stderr: string, documentPath: string): void {
    compilationDiagnostics.clear();
    const diagnosticsMap = parseCompilationErrors(stderr, documentPath);
    for (const [fileUri, diagnostics] of diagnosticsMap) {
        compilationDiagnostics.set(vscode.Uri.parse(fileUri), diagnostics);
    }
}

function clearCompilationDiagnostics(): void {
    compilationDiagnostics.clear();
}

// ============================================================================
// Word count
// ============================================================================

function updateWordCount(editor: vscode.TextEditor | undefined): void {
    if (!editor || editor.document.languageId !== 'typst') {
        wordCountStatusBar.hide();
        return;
    }

    const text = editor.document.getText();
    // Strip comments, code expressions, and markup syntax for accurate count
    const cleaned = text
        .replace(/\/\/.*$/gm, '')           // line comments
        .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
        .replace(/```[\s\S]*?```/g, '')     // raw blocks
        .replace(/#[a-zA-Z_][a-zA-Z0-9_.-]*(?:\([^)]*\))?/g, '') // code expressions
        .replace(/<[a-zA-Z_][a-zA-Z0-9_:-]*>/g, '') // labels
        .replace(/^\s*=+\s*/gm, '')         // heading markers
        .replace(/^\s*[-+]\s+/gm, '')       // list markers
        .replace(/\$[^$]*\$/g, '')          // math
        .replace(/---[\s\S]*?---/g, '');    // front matter

    const words = cleaned.match(/\S+/g);
    const count = words ? words.length : 0;

    wordCountStatusBar.text = `$(book) ${count} words`;
    wordCountStatusBar.show();
}

// ============================================================================
// Folding (by headings)
// ============================================================================

class NovaFoldingRangeProvider implements vscode.FoldingRangeProvider {
    provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
        const ranges: vscode.FoldingRange[] = [];
        const lines = document.getText().split('\n');
        const headingRegex = /^\s*(=+)\s+/;

        interface HeadingEntry {
            level: number;
            line: number;
        }

        const headings: HeadingEntry[] = [];

        // Also track comment blocks and raw blocks for folding
        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(headingRegex);
            if (match) {
                headings.push({ level: match[1].length, line: i });
            }
        }

        // Create folding ranges: each heading folds to the line before the next
        // heading of equal or lesser level, or end of document
        for (let i = 0; i < headings.length; i++) {
            const h = headings[i];
            let endLine = lines.length - 1;

            for (let j = i + 1; j < headings.length; j++) {
                if (headings[j].level <= h.level) {
                    endLine = headings[j].line - 1;
                    break;
                }
            }

            // Skip empty trailing lines
            while (endLine > h.line && lines[endLine].trim() === '') {
                endLine--;
            }

            if (endLine > h.line) {
                ranges.push(new vscode.FoldingRange(
                    h.line,
                    endLine,
                    vscode.FoldingRangeKind.Region
                ));
            }
        }

        // Fold raw blocks (``` ... ```)
        let rawStart = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim().startsWith('```') || lines[i].trim() === '```') {
                if (rawStart === -1) {
                    rawStart = i;
                } else {
                    if (i > rawStart) {
                        ranges.push(new vscode.FoldingRange(rawStart, i));
                    }
                    rawStart = -1;
                }
            }
        }

        // Fold block comments (/* ... */)
        let commentStart = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('/*') && commentStart === -1) {
                commentStart = i;
            }
            if (lines[i].includes('*/') && commentStart !== -1) {
                if (i > commentStart) {
                    ranges.push(new vscode.FoldingRange(
                        commentStart,
                        i,
                        vscode.FoldingRangeKind.Comment
                    ));
                }
                commentStart = -1;
            }
        }

        return ranges;
    }
}

// ============================================================================
// List indentation commands
// ============================================================================

const LIST_MARKER_REGEX = /^(\s*)([-+]|\d+\.)\s/;

/**
 * Indent list items on the current line(s) by adding 2 spaces.
 * Falls back to default Tab behavior if not on a list line.
 */
async function listIndent() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        await vscode.commands.executeCommand('tab');
        return;
    }

    const document = editor.document;
    const selections = editor.selections;
    let allOnListLines = true;

    for (const sel of selections) {
        for (let line = sel.start.line; line <= sel.end.line; line++) {
            if (!LIST_MARKER_REGEX.test(document.lineAt(line).text)) {
                allOnListLines = false;
                break;
            }
        }
        if (!allOnListLines) { break; }
    }

    if (!allOnListLines) {
        await vscode.commands.executeCommand('tab');
        return;
    }

    await editor.edit((editBuilder) => {
        const processedLines = new Set<number>();
        for (const sel of selections) {
            for (let line = sel.start.line; line <= sel.end.line; line++) {
                if (!processedLines.has(line)) {
                    processedLines.add(line);
                    editBuilder.insert(new vscode.Position(line, 0), '  ');
                }
            }
        }
    });
}

/**
 * Outdent list items on the current line(s) by removing up to 2 spaces.
 * Falls back to default Shift+Tab behavior if not on a list line.
 */
async function listOutdent() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        await vscode.commands.executeCommand('outdent');
        return;
    }

    const document = editor.document;
    const selections = editor.selections;
    let allOnListLines = true;

    for (const sel of selections) {
        for (let line = sel.start.line; line <= sel.end.line; line++) {
            if (!LIST_MARKER_REGEX.test(document.lineAt(line).text)) {
                allOnListLines = false;
                break;
            }
        }
        if (!allOnListLines) { break; }
    }

    if (!allOnListLines) {
        await vscode.commands.executeCommand('outdent');
        return;
    }

    await editor.edit((editBuilder) => {
        const processedLines = new Set<number>();
        for (const sel of selections) {
            for (let line = sel.start.line; line <= sel.end.line; line++) {
                if (processedLines.has(line)) { continue; }
                processedLines.add(line);
                const lineText = document.lineAt(line).text;
                const leadingSpaces = lineText.match(/^(\s*)/)?.[1].length || 0;
                const removeCount = Math.min(2, leadingSpaces);
                if (removeCount > 0) {
                    editBuilder.delete(new vscode.Range(
                        new vscode.Position(line, 0),
                        new vscode.Position(line, removeCount)
                    ));
                }
            }
        }
    });
}

/**
 * Label types with their descriptions and icons.
 */
const LABEL_TYPES = [
    { prefix: 'eq:', description: 'Equation label', icon: vscode.CompletionItemKind.Value, detail: 'Mathematical equation' },
    { prefix: 'fig:', description: 'Figure label', icon: vscode.CompletionItemKind.File, detail: 'Image or diagram' },
    { prefix: 'tbl:', description: 'Table label', icon: vscode.CompletionItemKind.Struct, detail: 'Data table' },
    { prefix: 'sec:', description: 'Section label', icon: vscode.CompletionItemKind.Module, detail: 'Document section' },
    { prefix: 'lst:', description: 'Listing label', icon: vscode.CompletionItemKind.Snippet, detail: 'Code listing' },
    { prefix: 'def:', description: 'Definition label', icon: vscode.CompletionItemKind.Reference, detail: 'Term definition' },
    { prefix: 'thm:', description: 'Theorem label', icon: vscode.CompletionItemKind.Class, detail: 'Theorem or proof' },
    { prefix: 'lem:', description: 'Lemma label', icon: vscode.CompletionItemKind.Class, detail: 'Mathematical lemma' },
    { prefix: 'cor:', description: 'Corollary label', icon: vscode.CompletionItemKind.Class, detail: 'Corollary statement' },
    { prefix: 'prop:', description: 'Proposition label', icon: vscode.CompletionItemKind.Class, detail: 'Proposition' },
    { prefix: 'ex:', description: 'Example label', icon: vscode.CompletionItemKind.Event, detail: 'Example reference' },
    { prefix: 'rem:', description: 'Remark label', icon: vscode.CompletionItemKind.Text, detail: 'Remark or note' },
    { prefix: 'alg:', description: 'Algorithm label', icon: vscode.CompletionItemKind.Function, detail: 'Algorithm reference' },
];

/**
 * Parse all labels from a document.
 * Labels are defined as <label-name> in Typst.
 */
function parseLabelsFromDocument(document: vscode.TextDocument): { label: string; line: number; type: string }[] {
    const labels: { label: string; line: number; type: string }[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    // Match labels like <eq:einstein>, <fig:diagram>, etc.
    const labelRegex = /<([a-zA-Z_][a-zA-Z0-9_:-]*)>/g;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        let match;
        while ((match = labelRegex.exec(line)) !== null) {
            const labelName = match[1];
            // Determine label type from prefix
            let labelType = 'unknown';
            for (const lt of LABEL_TYPES) {
                if (labelName.startsWith(lt.prefix)) {
                    labelType = lt.prefix.replace(':', '');
                    break;
                }
            }
            labels.push({
                label: labelName,
                line: lineNum,
                type: labelType
            });
        }
    }

    return labels;
}

/**
 * Parse all #let bindings from text content.
 */
function parseLetBindings(text: string): { name: string; line: number; column: number }[] {
    const bindings: { name: string; line: number; column: number }[] = [];
    const lines = text.split('\n');
    const letRegex = /#let\s+([a-zA-Z_][a-zA-Z0-9_-]*)/g;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        let match;
        while ((match = letRegex.exec(line)) !== null) {
            bindings.push({
                name: match[1],
                line: lineNum,
                column: match.index + match[0].indexOf(match[1])
            });
        }
    }

    return bindings;
}

/**
 * Parse #import statements with their named imports.
 * E.g. #import "lib.typ": template, theorem-box
 */
function parseImports(document: vscode.TextDocument): { filePath: string; names: string[]; line: number }[] {
    const imports: { filePath: string; names: string[]; line: number }[] = [];
    const text = document.getText();
    const lines = text.split('\n');
    const docDir = path.dirname(document.uri.fsPath);
    const importRegex = /^#import\s+"([^"]+)"(?:\s*:\s*(.+))?/;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const match = lines[lineNum].match(importRegex);
        if (match) {
            const importPath = match[1];
            const fullPath = path.isAbsolute(importPath)
                ? importPath
                : path.join(docDir, importPath);
            const names = match[2]
                ? match[2].split(',').map(n => n.trim()).filter(n => n.length > 0)
                : [];
            imports.push({ filePath: fullPath, names, line: lineNum });
        }
    }

    return imports;
}

/**
 * Find all occurrences of an identifier in text (word-boundary match).
 * Returns line/column pairs.
 */
function findIdentifierOccurrences(text: string, name: string): { line: number; column: number }[] {
    const occurrences: { line: number; column: number }[] = [];
    const lines = text.split('\n');
    // Escape hyphens for regex, match word boundaries (Typst identifiers can contain hyphens)
    const escaped = name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(?<![a-zA-Z0-9_-])${escaped}(?![a-zA-Z0-9_-])`, 'g');

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        let match;
        while ((match = regex.exec(line)) !== null) {
            occurrences.push({ line: lineNum, column: match.index });
        }
    }

    return occurrences;
}

/**
 * Bibliography entry parsed from .bib file.
 */
interface BibEntry {
    key: string;
    type: string;
    title?: string;
    author?: string;
    year?: string;
    journal?: string;
    booktitle?: string;
    file: string;
    line: number;
}

/**
 * Find bibliography files referenced in the document.
 * Looks for #bibliography("file.bib") patterns.
 */
function findBibliographyFiles(document: vscode.TextDocument): string[] {
    const text = document.getText();
    const docDir = path.dirname(document.uri.fsPath);
    const bibFiles: string[] = [];

    // Match #bibliography("path.bib") or #bibliography("path1.bib", "path2.bib")
    const bibRegex = /#bibliography\s*\(\s*([^)]+)\s*\)/g;
    let match;

    while ((match = bibRegex.exec(text)) !== null) {
        const args = match[1];
        // Extract quoted strings
        const pathRegex = /"([^"]+\.bib)"/g;
        let pathMatch;
        while ((pathMatch = pathRegex.exec(args)) !== null) {
            const bibPath = pathMatch[1];
            const fullPath = path.isAbsolute(bibPath)
                ? bibPath
                : path.join(docDir, bibPath);
            if (fs.existsSync(fullPath)) {
                bibFiles.push(fullPath);
            }
        }
    }

    return bibFiles;
}

/**
 * Parse a .bib file and extract all entries.
 */
function parseBibFile(filePath: string): BibEntry[] {
    const entries: BibEntry[] = [];

    try {
        const content = fs.readFileSync(filePath, 'utf-8');

        // Match BibTeX entries: @type{key, ... }
        // This regex handles nested braces
        const entryRegex = /@(\w+)\s*\{\s*([^,\s]+)\s*,([^@]*?)(?=\n\s*@|\n*$)/gs;
        let match;

        while ((match = entryRegex.exec(content)) !== null) {
            const entryType = match[1].toLowerCase();
            const key = match[2].trim();
            const body = match[3];

            // Skip comments and strings
            if (entryType === 'comment' || entryType === 'string' || entryType === 'preamble') {
                continue;
            }

            const lineNumber = content.substring(0, match.index).split('\n').length - 1;

            const entry: BibEntry = {
                key,
                type: entryType,
                file: filePath,
                line: lineNumber
            };

            // Extract common fields
            const titleMatch = body.match(/title\s*=\s*[{"](.+?)[}"]/is);
            if (titleMatch) {
                entry.title = titleMatch[1].replace(/[{}]/g, '').trim();
            }

            const authorMatch = body.match(/author\s*=\s*[{"](.+?)[}"]/is);
            if (authorMatch) {
                entry.author = authorMatch[1].replace(/[{}]/g, '').replace(/\s+and\s+/g, ', ').trim();
            }

            const yearMatch = body.match(/year\s*=\s*[{"]?(\d{4})[}"]?/i);
            if (yearMatch) {
                entry.year = yearMatch[1];
            }

            const journalMatch = body.match(/journal\s*=\s*[{"](.+?)[}"]/is);
            if (journalMatch) {
                entry.journal = journalMatch[1].replace(/[{}]/g, '').trim();
            }

            const booktitleMatch = body.match(/booktitle\s*=\s*[{"](.+?)[}"]/is);
            if (booktitleMatch) {
                entry.booktitle = booktitleMatch[1].replace(/[{}]/g, '').trim();
            }

            entries.push(entry);
        }
    } catch (error) {
        // Ignore errors reading bib file
    }

    return entries;
}

/**
 * Get all bibliography entries from files referenced in the document.
 */
function getBibliographyEntries(document: vscode.TextDocument): BibEntry[] {
    const bibFiles = findBibliographyFiles(document);
    const allEntries: BibEntry[] = [];

    for (const bibFile of bibFiles) {
        const entries = parseBibFile(bibFile);
        allEntries.push(...entries);
    }

    return allEntries;
}

/**
 * Get icon for bibliography entry type.
 */
function getBibEntryIcon(type: string): vscode.CompletionItemKind {
    switch (type) {
        case 'article':
            return vscode.CompletionItemKind.File;
        case 'book':
        case 'inbook':
            return vscode.CompletionItemKind.Module;
        case 'inproceedings':
        case 'conference':
            return vscode.CompletionItemKind.Event;
        case 'phdthesis':
        case 'mastersthesis':
            return vscode.CompletionItemKind.Class;
        case 'techreport':
            return vscode.CompletionItemKind.Interface;
        case 'misc':
        case 'online':
            return vscode.CompletionItemKind.Reference;
        default:
            return vscode.CompletionItemKind.Text;
    }
}

/**
 * Get completion item kind based on label type.
 */
function getCompletionKindForLabel(label: string): vscode.CompletionItemKind {
    for (const lt of LABEL_TYPES) {
        if (label.startsWith(lt.prefix)) {
            return lt.icon;
        }
    }
    return vscode.CompletionItemKind.Reference;
}

/**
 * Completion provider for references (@).
 * Shows all labels defined in the current document and bibliography entries.
 */
class ReferenceCompletionProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.CompletionItem[] {
        const completionItems: vscode.CompletionItem[] = [];

        // Add document labels
        const labels = parseLabelsFromDocument(document);
        for (const labelInfo of labels) {
            const item = new vscode.CompletionItem(
                labelInfo.label,
                getCompletionKindForLabel(labelInfo.label)
            );

            // Determine type description
            let typeDesc = 'Reference';
            for (const lt of LABEL_TYPES) {
                if (labelInfo.label.startsWith(lt.prefix)) {
                    typeDesc = lt.detail;
                    break;
                }
            }

            item.detail = `${typeDesc} (line ${labelInfo.line + 1})`;
            item.documentation = new vscode.MarkdownString(
                `Reference to \`<${labelInfo.label}>\` defined on line ${labelInfo.line + 1}`
            );

            // Insert the label name after @
            item.insertText = labelInfo.label;

            // Sort labels first (0_), then by type, then alphabetically
            item.sortText = `0_${labelInfo.type}_${labelInfo.label}`;

            completionItems.push(item);
        }

        // Add bibliography entries
        const bibEntries = getBibliographyEntries(document);
        for (const entry of bibEntries) {
            const item = new vscode.CompletionItem(
                entry.key,
                getBibEntryIcon(entry.type)
            );

            // Build detail string
            const details: string[] = [];
            if (entry.author) {
                // Shorten author list
                const authors = entry.author.split(',').slice(0, 2).join(',');
                details.push(authors + (entry.author.split(',').length > 2 ? ' et al.' : ''));
            }
            if (entry.year) {
                details.push(entry.year);
            }
            item.detail = `[${entry.type}] ${details.join(', ')}`;

            // Build documentation
            const docParts: string[] = [];
            if (entry.title) {
                docParts.push(`**${entry.title}**`);
            }
            if (entry.author) {
                docParts.push(`*${entry.author}*`);
            }
            if (entry.journal) {
                docParts.push(`${entry.journal}${entry.year ? ` (${entry.year})` : ''}`);
            } else if (entry.booktitle) {
                docParts.push(`In: ${entry.booktitle}${entry.year ? ` (${entry.year})` : ''}`);
            } else if (entry.year) {
                docParts.push(entry.year);
            }
            docParts.push(`\n\n*Source: ${path.basename(entry.file)}*`);

            item.documentation = new vscode.MarkdownString(docParts.join('\n\n'));

            // Insert the citation key after @
            item.insertText = entry.key;

            // Sort bibliography entries after labels (1_)
            item.sortText = `1_bib_${entry.key}`;

            completionItems.push(item);
        }

        return completionItems;
    }
}

/**
 * Completion provider for label types (<).
 * Shows available label type prefixes.
 */
class LabelCompletionProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.CompletionItem[] {
        const completionItems: vscode.CompletionItem[] = [];

        for (const labelType of LABEL_TYPES) {
            const item = new vscode.CompletionItem(
                labelType.prefix,
                labelType.icon
            );

            item.detail = labelType.description;
            item.documentation = new vscode.MarkdownString(
                `Insert a ${labelType.detail.toLowerCase()} label.\n\n` +
                `Example: \`<${labelType.prefix}my-label>\``
            );

            // Insert prefix and position cursor for label name
            item.insertText = new vscode.SnippetString(`${labelType.prefix}\${1:name}>`);

            // Higher priority for common types
            const priority = ['eq:', 'fig:', 'tbl:', 'sec:'].includes(labelType.prefix) ? '0' : '1';
            item.sortText = `${priority}_${labelType.prefix}`;

            completionItems.push(item);
        }

        // Also add option for custom label without prefix
        const customItem = new vscode.CompletionItem(
            'custom label',
            vscode.CompletionItemKind.Text
        );
        customItem.detail = 'Custom label without prefix';
        customItem.documentation = new vscode.MarkdownString(
            'Insert a custom label without a type prefix.\n\n' +
            'Example: `<my-custom-label>`'
        );
        customItem.insertText = new vscode.SnippetString('${1:label-name}>');
        customItem.sortText = '2_custom';
        completionItems.push(customItem);

        return completionItems;
    }
}

// ============================================================================
// Document Outline (DocumentSymbolProvider)
// ============================================================================

class NovaDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    provideDocumentSymbols(
        document: vscode.TextDocument
    ): vscode.DocumentSymbol[] {
        const symbols: vscode.DocumentSymbol[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        const headingRegex = /^\s*(=+)\s+(.*)$/;
        const importRegex = /^#import\s+"([^"]+)"/;
        const labelRegex = /<([a-zA-Z_][a-zA-Z0-9_:-]*)>/g;

        interface HeadingInfo {
            level: number;
            name: string;
            line: number;
            symbol?: vscode.DocumentSymbol;
        }

        const headings: HeadingInfo[] = [];
        const imports: { path: string; line: number }[] = [];
        const labels: { label: string; line: number; type: string }[] = [];

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];

            const headingMatch = line.match(headingRegex);
            if (headingMatch) {
                headings.push({
                    level: headingMatch[1].length,
                    name: headingMatch[2].replace(/<[^>]+>/g, '').trim(),
                    line: lineNum
                });
                continue;
            }

            const importMatch = line.match(importRegex);
            if (importMatch) {
                imports.push({ path: importMatch[1], line: lineNum });
                continue;
            }

            let labelMatch;
            while ((labelMatch = labelRegex.exec(line)) !== null) {
                const labelName = labelMatch[1];
                let labelType = 'unknown';
                for (const lt of LABEL_TYPES) {
                    if (labelName.startsWith(lt.prefix)) {
                        labelType = lt.prefix.replace(':', '');
                        break;
                    }
                }
                labels.push({ label: labelName, line: lineNum, type: labelType });
            }
        }

        // Import symbols (top-level)
        for (const imp of imports) {
            const range = new vscode.Range(imp.line, 0, imp.line, lines[imp.line].length);
            symbols.push(new vscode.DocumentSymbol(
                imp.path,
                'import',
                vscode.SymbolKind.Package,
                range,
                range
            ));
        }

        // Build heading hierarchy
        for (let i = 0; i < headings.length; i++) {
            const h = headings[i];
            let endLine = lines.length - 1;
            for (let j = i + 1; j < headings.length; j++) {
                if (headings[j].level <= h.level) {
                    endLine = headings[j].line - 1;
                    break;
                }
            }

            const selectionRange = new vscode.Range(h.line, 0, h.line, lines[h.line].length);
            const fullRange = new vscode.Range(h.line, 0, endLine, lines[endLine].length);

            h.symbol = new vscode.DocumentSymbol(
                h.name,
                '='.repeat(h.level),
                this.getSymbolKindForLevel(h.level),
                fullRange,
                selectionRange
            );
        }

        // Nest headings
        const headingStack: HeadingInfo[] = [];
        const rootHeadings: vscode.DocumentSymbol[] = [];

        for (const h of headings) {
            if (!h.symbol) { continue; }

            while (headingStack.length > 0 &&
                   headingStack[headingStack.length - 1].level >= h.level) {
                headingStack.pop();
            }

            if (headingStack.length === 0) {
                rootHeadings.push(h.symbol);
            } else {
                headingStack[headingStack.length - 1].symbol!.children.push(h.symbol);
            }
            headingStack.push(h);
        }

        // Attach labels to their innermost parent heading
        for (const lbl of labels) {
            const labelKind = this.getLabelSymbolKind(lbl.type);
            const range = new vscode.Range(lbl.line, 0, lbl.line, lines[lbl.line].length);
            const labelSymbol = new vscode.DocumentSymbol(
                `<${lbl.label}>`,
                lbl.type !== 'unknown' ? lbl.type : 'label',
                labelKind,
                range,
                range
            );

            let parentFound = false;
            for (let i = headings.length - 1; i >= 0; i--) {
                const h = headings[i];
                if (h.symbol && h.line <= lbl.line && h.symbol.range.end.line >= lbl.line) {
                    h.symbol.children.push(labelSymbol);
                    parentFound = true;
                    break;
                }
            }
            if (!parentFound) {
                symbols.push(labelSymbol);
            }
        }

        symbols.push(...rootHeadings);
        return symbols;
    }

    private getSymbolKindForLevel(level: number): vscode.SymbolKind {
        switch (level) {
            case 1: return vscode.SymbolKind.Module;
            case 2: return vscode.SymbolKind.Function;
            case 3: return vscode.SymbolKind.Method;
            case 4: return vscode.SymbolKind.Property;
            default: return vscode.SymbolKind.Field;
        }
    }

    private getLabelSymbolKind(type: string): vscode.SymbolKind {
        switch (type) {
            case 'eq': return vscode.SymbolKind.Constant;
            case 'fig': return vscode.SymbolKind.File;
            case 'tbl': return vscode.SymbolKind.Struct;
            case 'sec': return vscode.SymbolKind.Namespace;
            default: return vscode.SymbolKind.Key;
        }
    }
}

// ============================================================================
// Go to Definition (DefinitionProvider)
// ============================================================================

class NovaDefinitionProvider implements vscode.DefinitionProvider {
    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.Definition | undefined {
        const line = document.lineAt(position.line).text;

        // Case 1: Reference like @eq:einstein or @citation-key
        const wordRange = document.getWordRangeAtPosition(position, /@[a-zA-Z_][a-zA-Z0-9_:.-]*/);
        if (wordRange) {
            const refName = document.getText(wordRange).substring(1);

            // Try document labels first
            const labels = parseLabelsFromDocument(document);
            const matchedLabel = labels.find(l => l.label === refName);
            if (matchedLabel) {
                return new vscode.Location(
                    document.uri,
                    new vscode.Position(matchedLabel.line, 0)
                );
            }

            // Try bibliography entries
            const bibEntries = getBibliographyEntries(document);
            const matchedBib = bibEntries.find(e => e.key === refName);
            if (matchedBib) {
                return new vscode.Location(
                    vscode.Uri.file(matchedBib.file),
                    new vscode.Position(matchedBib.line, 0)
                );
            }

            return undefined;
        }

        // Case 2: #import "file.typ" — click on path opens file, click on imported name jumps to #let
        const importMatch = line.match(/#import\s+"([^"]+)"(?:\s*:\s*(.+))?/);
        if (importMatch) {
            const importPath = importMatch[1];
            const docDir = path.dirname(document.uri.fsPath);
            const fullPath = path.isAbsolute(importPath)
                ? importPath
                : path.join(docDir, importPath);

            if (fs.existsSync(fullPath)) {
                // Check if cursor is on an imported name (after the colon)
                if (importMatch[2]) {
                    const identRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_-]*/);
                    if (identRange) {
                        const identName = document.getText(identRange);
                        const names = importMatch[2].split(',').map(n => n.trim());
                        if (names.includes(identName)) {
                            const fileContent = fs.readFileSync(fullPath, 'utf-8');
                            const bindings = parseLetBindings(fileContent);
                            const match = bindings.find(b => b.name === identName);
                            if (match) {
                                return new vscode.Location(
                                    vscode.Uri.file(fullPath),
                                    new vscode.Position(match.line, match.column)
                                );
                            }
                        }
                    }
                }

                // Otherwise, click on the path itself opens the file
                const pathStart = line.indexOf('"') + 1;
                const pathEnd = line.indexOf('"', pathStart);
                if (position.character >= pathStart && position.character <= pathEnd) {
                    return new vscode.Location(
                        vscode.Uri.file(fullPath),
                        new vscode.Position(0, 0)
                    );
                }
            }
        }

        // Case 3: Identifier — check if it's a #let from imports or local
        const identRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_-]*/);
        if (identRange) {
            const identName = document.getText(identRange);

            // Check imported #let bindings
            const imports = parseImports(document);
            for (const imp of imports) {
                if (imp.names.includes(identName) && fs.existsSync(imp.filePath)) {
                    const fileContent = fs.readFileSync(imp.filePath, 'utf-8');
                    const bindings = parseLetBindings(fileContent);
                    const matched = bindings.find(b => b.name === identName);
                    if (matched) {
                        return new vscode.Location(
                            vscode.Uri.file(imp.filePath),
                            new vscode.Position(matched.line, matched.column)
                        );
                    }
                }
            }

            // Check local #let bindings
            const localBindings = parseLetBindings(document.getText());
            const localMatch = localBindings.find(b => b.name === identName);
            if (localMatch) {
                return new vscode.Location(
                    document.uri,
                    new vscode.Position(localMatch.line, localMatch.column)
                );
            }
        }

        return undefined;
    }
}

// ============================================================================
// Find All References (ReferenceProvider)
// ============================================================================

class NovaReferenceProvider implements vscode.ReferenceProvider {
    provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext
    ): vscode.Location[] {
        const locations: vscode.Location[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        // Case A: Cursor on a <label> definition
        const labelDefRange = document.getWordRangeAtPosition(position, /<[a-zA-Z_][a-zA-Z0-9_:-]*>/);
        if (labelDefRange) {
            const labelFull = document.getText(labelDefRange);
            const labelName = labelFull.slice(1, -1); // strip < >

            if (context.includeDeclaration) {
                locations.push(new vscode.Location(document.uri, labelDefRange));
            }

            // Find all @labelName references in document
            const refRegex = new RegExp(`@${labelName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?![a-zA-Z0-9_:-])`, 'g');
            for (let lineNum = 0; lineNum < lines.length; lineNum++) {
                let match;
                while ((match = refRegex.exec(lines[lineNum])) !== null) {
                    locations.push(new vscode.Location(
                        document.uri,
                        new vscode.Range(lineNum, match.index, lineNum, match.index + match[0].length)
                    ));
                }
            }

            return locations;
        }

        // Case B: Cursor on a @reference
        const refRange = document.getWordRangeAtPosition(position, /@[a-zA-Z_][a-zA-Z0-9_:.-]*/);
        if (refRange) {
            const refName = document.getText(refRange).substring(1);

            // Include declaration: find the <label> definition
            if (context.includeDeclaration) {
                const labels = parseLabelsFromDocument(document);
                const def = labels.find(l => l.label === refName);
                if (def) {
                    const defLine = lines[def.line];
                    const defCol = defLine.indexOf(`<${refName}>`);
                    locations.push(new vscode.Location(
                        document.uri,
                        new vscode.Range(def.line, defCol, def.line, defCol + refName.length + 2)
                    ));
                }
            }

            // Find all @refName usages
            const refRegex = new RegExp(`@${refName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?![a-zA-Z0-9_:-])`, 'g');
            for (let lineNum = 0; lineNum < lines.length; lineNum++) {
                let match;
                while ((match = refRegex.exec(lines[lineNum])) !== null) {
                    locations.push(new vscode.Location(
                        document.uri,
                        new vscode.Range(lineNum, match.index, lineNum, match.index + match[0].length)
                    ));
                }
            }

            return locations;
        }

        // Case C: Cursor on a #let identifier (definition or usage)
        const identRange = document.getWordRangeAtPosition(position, /[a-zA-Z_][a-zA-Z0-9_-]*/);
        if (identRange) {
            const identName = document.getText(identRange);

            // Determine where the #let definition lives
            let defUri: vscode.Uri | undefined;
            let defLine = -1;
            let defColumn = -1;

            // Check local bindings
            const localBindings = parseLetBindings(text);
            const localMatch = localBindings.find(b => b.name === identName);
            if (localMatch) {
                defUri = document.uri;
                defLine = localMatch.line;
                defColumn = localMatch.column;
            }

            // Check imported bindings
            const imports = parseImports(document);
            let sourceFilePath: string | undefined;
            for (const imp of imports) {
                if (imp.names.includes(identName) && fs.existsSync(imp.filePath)) {
                    sourceFilePath = imp.filePath;
                    const fileContent = fs.readFileSync(imp.filePath, 'utf-8');
                    const bindings = parseLetBindings(fileContent);
                    const matched = bindings.find(b => b.name === identName);
                    if (matched) {
                        defUri = vscode.Uri.file(imp.filePath);
                        defLine = matched.line;
                        defColumn = matched.column;
                    }
                    break;
                }
            }

            if (!defUri) {
                return locations;
            }

            // Include declaration
            if (context.includeDeclaration && defLine >= 0) {
                locations.push(new vscode.Location(
                    defUri,
                    new vscode.Range(defLine, defColumn, defLine, defColumn + identName.length)
                ));
            }

            // Find usages in current document
            const occurrences = findIdentifierOccurrences(text, identName);
            for (const occ of occurrences) {
                // Skip the #let definition line itself
                if (defUri.fsPath === document.uri.fsPath && occ.line === defLine && occ.column === defColumn) {
                    continue;
                }
                locations.push(new vscode.Location(
                    document.uri,
                    new vscode.Range(occ.line, occ.column, occ.line, occ.column + identName.length)
                ));
            }

            // If the definition is in an imported file, also scan all .typ files
            // in the workspace that import this file and this name
            if (sourceFilePath) {
                this.findReferencesInWorkspace(identName, sourceFilePath, document.uri, locations);
            }

            return locations;
        }

        return locations;
    }

    /**
     * Scan workspace .typ files for imports of a given source file + name.
     */
    private findReferencesInWorkspace(
        identName: string,
        sourceFilePath: string,
        excludeUri: vscode.Uri,
        locations: vscode.Location[]
    ): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) { return; }

        for (const folder of workspaceFolders) {
            const folderPath = folder.uri.fsPath;
            this.scanDirectoryForReferences(folderPath, identName, sourceFilePath, excludeUri, locations);
        }
    }

    private scanDirectoryForReferences(
        dirPath: string,
        identName: string,
        sourceFilePath: string,
        excludeUri: vscode.Uri,
        locations: vscode.Location[]
    ): void {
        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.')) { continue; }
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    this.scanDirectoryForReferences(fullPath, identName, sourceFilePath, excludeUri, locations);
                } else if (entry.name.endsWith('.typ') && fullPath !== excludeUri.fsPath) {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    // Check if this file imports the source file and the identifier
                    const importRegex = /#import\s+"([^"]+)"(?:\s*:\s*(.+))?/g;
                    let match;
                    while ((match = importRegex.exec(content)) !== null) {
                        const importedPath = path.resolve(dirPath, match[1]);
                        if (importedPath === sourceFilePath && match[2]) {
                            const names = match[2].split(',').map(n => n.trim());
                            if (names.includes(identName)) {
                                // This file imports the identifier — find all usages
                                const occurrences = findIdentifierOccurrences(content, identName);
                                const fileUri = vscode.Uri.file(fullPath);
                                for (const occ of occurrences) {
                                    locations.push(new vscode.Location(
                                        fileUri,
                                        new vscode.Range(occ.line, occ.column, occ.line, occ.column + identName.length)
                                    ));
                                }
                                break;
                            }
                        }
                    }
                }
            }
        } catch {
            // Ignore directory read errors
        }
    }
}

/**
 * Open configuration menu for the extension.
 */
async function configureExtension() {
    const config = vscode.workspace.getConfiguration('novatype');

    const options: vscode.QuickPickItem[] = [
        {
            label: '$(file-binary) Nova Binary Path',
            description: config.get<string>('binaryPath') || '(uses PATH)',
            detail: 'Set custom path to nova binary (for development)'
        },
        {
            label: '$(preview) PDF Preview Backend',
            description: config.get<string>('preview.backend') || 'builtin',
            detail: 'Choose between built-in viewer or vscode-pdf extension'
        },
        {
            label: '$(refresh) Auto Refresh',
            description: config.get<boolean>('preview.autoRefresh') ? 'Enabled' : 'Disabled',
            detail: 'Automatically refresh preview on save'
        },
        {
            label: '$(settings-gear) Open All Settings',
            description: '',
            detail: 'Open VS Code settings filtered to NovaType'
        }
    ];

    const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Configure NovaType Extension',
        title: 'NovaType Settings'
    });

    if (!selected) {
        return;
    }

    if (selected.label.includes('Nova Binary Path')) {
        await configureBinaryPath(config);
    } else if (selected.label.includes('PDF Preview Backend')) {
        await configurePreviewBackend(config);
    } else if (selected.label.includes('Auto Refresh')) {
        await configureAutoRefresh(config);
    } else if (selected.label.includes('Open All Settings')) {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'novatype');
    }
}

/**
 * Configure the nova binary path.
 */
async function configureBinaryPath(config: vscode.WorkspaceConfiguration) {
    const currentPath = config.get<string>('binaryPath') || '';

    const options: vscode.QuickPickItem[] = [
        {
            label: '$(check) Use system PATH',
            description: 'nova',
            detail: 'Use nova binary from system PATH (default)'
        },
        {
            label: '$(folder) Browse for binary...',
            description: '',
            detail: 'Select a custom nova binary location'
        }
    ];

    if (currentPath) {
        options.unshift({
            label: '$(file-binary) Current: ' + currentPath,
            description: '(keep current)',
            detail: 'Keep using the current custom path'
        });
    }

    const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Select nova binary location',
        title: 'Nova Binary Path'
    });

    if (!selected) {
        return;
    }

    if (selected.label.includes('Use system PATH')) {
        await config.update('binaryPath', '', vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('NovaType: Using nova from system PATH');
    } else if (selected.label.includes('Browse for binary')) {
        const fileUri = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            title: 'Select nova binary',
            filters: process.platform === 'win32'
                ? { 'Executable': ['exe'], 'All files': ['*'] }
                : { 'All files': ['*'] }
        });

        if (fileUri && fileUri[0]) {
            const binaryPath = fileUri[0].fsPath;
            await config.update('binaryPath', binaryPath, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`NovaType: Binary path set to ${binaryPath}`);
        }
    }
}

/**
 * Configure the PDF preview backend.
 */
async function configurePreviewBackend(config: vscode.WorkspaceConfiguration) {
    const currentBackend = config.get<string>('preview.backend') || 'builtin';

    const options: vscode.QuickPickItem[] = [
        {
            label: currentBackend === 'builtin' ? '$(check) Built-in PDF.js Viewer' : '$(preview) Built-in PDF.js Viewer',
            description: currentBackend === 'builtin' ? '(current)' : '',
            detail: 'Embedded PDF viewer with zoom controls'
        },
        {
            label: currentBackend === 'vscode-pdf' ? '$(check) vscode-pdf Extension' : '$(extensions) vscode-pdf Extension',
            description: currentBackend === 'vscode-pdf' ? '(current)' : '',
            detail: 'Better navigation, bookmarks, outline support (requires vscode-pdf)'
        }
    ];

    const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Select PDF preview backend',
        title: 'PDF Preview Backend'
    });

    if (!selected) {
        return;
    }

    let newBackend: string;
    if (selected.label.includes('Built-in')) {
        newBackend = 'builtin';
    } else {
        newBackend = 'vscode-pdf';
    }

    if (newBackend !== currentBackend) {
        await config.update('preview.backend', newBackend, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`NovaType: Preview backend set to ${newBackend}`);
    }
}

/**
 * Configure auto refresh setting.
 */
async function configureAutoRefresh(config: vscode.WorkspaceConfiguration) {
    const currentValue = config.get<boolean>('preview.autoRefresh') ?? true;

    const options: vscode.QuickPickItem[] = [
        {
            label: currentValue ? '$(check) Enabled' : '$(circle-large-outline) Enabled',
            description: currentValue ? '(current)' : '',
            detail: 'Automatically refresh preview when file is saved'
        },
        {
            label: !currentValue ? '$(check) Disabled' : '$(circle-large-outline) Disabled',
            description: !currentValue ? '(current)' : '',
            detail: 'Only refresh preview manually'
        }
    ];

    const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Configure auto refresh',
        title: 'Auto Refresh Preview'
    });

    if (!selected) {
        return;
    }

    const newValue = selected.label.includes('Enabled');
    if (newValue !== currentValue) {
        await config.update('preview.autoRefresh', newValue, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`NovaType: Auto refresh ${newValue ? 'enabled' : 'disabled'}`);
    }
}

// ============================================================================
// Bibliography Functions
// ============================================================================

interface CrossRefWork {
    DOI: string;
    title: string[];
    author?: { given?: string; family?: string }[];
    'container-title'?: string[];
    published?: { 'date-parts'?: number[][] };
    type: string;
    publisher?: string;
}

interface CrossRefResponse {
    message: {
        items: CrossRefWork[];
    };
}

/**
 * Make an HTTPS GET request.
 */
function httpsGet(url: string, headers: Record<string, string> = {}): Promise<string> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            headers: {
                'User-Agent': 'NovaType-VSCode/0.1.0 (https://github.com/AureClai/novatype-vscode)',
                ...headers
            }
        };

        https.get(options, (res) => {
            // Handle redirects
            if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) {
                const redirectUrl = res.headers.location;
                if (redirectUrl) {
                    httpsGet(redirectUrl, headers).then(resolve).catch(reject);
                    return;
                }
            }

            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                return;
            }

            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

/**
 * Search for papers using CrossRef API.
 */
async function searchBibliography() {
    const query = await vscode.window.showInputBox({
        prompt: 'Search for papers (title, author, keywords)',
        placeHolder: 'e.g., attention is all you need',
        title: 'CrossRef Bibliography Search'
    });

    if (!query || query.trim() === '') {
        return;
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Searching CrossRef...',
            cancellable: false
        },
        async () => {
            try {
                const encodedQuery = encodeURIComponent(query);
                const url = `https://api.crossref.org/works?query=${encodedQuery}&rows=15&select=DOI,title,author,container-title,published,type,publisher`;

                const response = await httpsGet(url);
                const data: CrossRefResponse = JSON.parse(response);

                if (!data.message.items || data.message.items.length === 0) {
                    vscode.window.showInformationMessage('No results found.');
                    return;
                }

                const items: vscode.QuickPickItem[] = data.message.items.map((work) => {
                    const title = work.title?.[0] || 'Untitled';
                    const authors = work.author
                        ?.slice(0, 3)
                        .map(a => a.family || a.given || 'Unknown')
                        .join(', ') || 'Unknown author';
                    const year = work.published?.['date-parts']?.[0]?.[0] || '';
                    const journal = work['container-title']?.[0] || work.publisher || '';

                    return {
                        label: title.length > 80 ? title.substring(0, 77) + '...' : title,
                        description: `${authors}${year ? ` (${year})` : ''}`,
                        detail: `${journal} | DOI: ${work.DOI}`,
                        doi: work.DOI
                    } as vscode.QuickPickItem & { doi: string };
                });

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select a paper to add to bibliography',
                    title: `Search Results for "${query}"`,
                    matchOnDescription: true,
                    matchOnDetail: true
                }) as (vscode.QuickPickItem & { doi: string }) | undefined;

                if (selected && selected.doi) {
                    await fetchAndInsertBibtex(selected.doi);
                }

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Search failed: ${errorMessage}`);
                outputChannel.appendLine(`CrossRef search error: ${errorMessage}`);
            }
        }
    );
}

/**
 * Insert BibTeX from a DOI entered by the user.
 */
async function insertFromDOI() {
    const doi = await vscode.window.showInputBox({
        prompt: 'Enter DOI (with or without https://doi.org/)',
        placeHolder: 'e.g., 10.48550/arXiv.1706.03762',
        title: 'Insert BibTeX from DOI',
        validateInput: (value) => {
            if (!value || value.trim() === '') {
                return 'Please enter a DOI';
            }
            return null;
        }
    });

    if (!doi) {
        return;
    }

    // Clean up DOI - remove URL prefix if present
    let cleanDoi = doi.trim();
    cleanDoi = cleanDoi.replace(/^https?:\/\/doi\.org\//i, '');
    cleanDoi = cleanDoi.replace(/^doi:/i, '');

    await fetchAndInsertBibtex(cleanDoi);
}

/**
 * Fetch BibTeX from DOI.org and insert into .bib file.
 */
async function fetchAndInsertBibtex(doi: string) {
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Fetching BibTeX...',
            cancellable: false
        },
        async () => {
            try {
                const url = `https://doi.org/${doi}`;
                const bibtex = await httpsGet(url, {
                    'Accept': 'application/x-bibtex'
                });

                if (!bibtex || !bibtex.includes('@')) {
                    throw new Error('Invalid BibTeX response');
                }

                // Format the BibTeX nicely
                const formattedBibtex = formatBibtex(bibtex);

                // Get or create .bib file
                const bibFile = await getOrCreateBibFile();
                if (!bibFile) {
                    // User cancelled
                    return;
                }

                // Check if DOI already exists in bib file
                const existingContent = fs.existsSync(bibFile)
                    ? fs.readFileSync(bibFile, 'utf-8')
                    : '';

                if (existingContent.toLowerCase().includes(doi.toLowerCase())) {
                    vscode.window.showWarningMessage(`DOI ${doi} already exists in bibliography.`);
                    return;
                }

                // Append to .bib file
                const newContent = existingContent.trim()
                    ? existingContent.trim() + '\n\n' + formattedBibtex
                    : formattedBibtex;

                fs.writeFileSync(bibFile, newContent, 'utf-8');

                // Extract citation key for user
                const keyMatch = formattedBibtex.match(/@\w+\{([^,]+),/);
                const citationKey = keyMatch ? keyMatch[1] : doi;

                vscode.window.showInformationMessage(
                    `Added to bibliography: ${citationKey}`,
                    'Open .bib file'
                ).then(async (selection) => {
                    if (selection === 'Open .bib file') {
                        const doc = await vscode.workspace.openTextDocument(bibFile);
                        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                    }
                });

                outputChannel.appendLine(`Added BibTeX for DOI: ${doi}`);
                outputChannel.appendLine(formattedBibtex);

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to fetch BibTeX: ${errorMessage}`);
                outputChannel.appendLine(`BibTeX fetch error: ${errorMessage}`);
            }
        }
    );
}

/**
 * Format BibTeX entry with consistent indentation.
 */
function formatBibtex(bibtex: string): string {
    // Basic formatting - ensure consistent indentation
    const lines = bibtex.trim().split('\n');
    const formatted: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('@') || trimmed === '}') {
            formatted.push(trimmed);
        } else if (trimmed) {
            formatted.push('  ' + trimmed);
        }
    }

    return formatted.join('\n');
}

/**
 * Get the .bib file associated with the current document, or create one.
 */
async function getOrCreateBibFile(): Promise<string | undefined> {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return undefined;
    }

    const currentFile = editor.document.uri.fsPath;
    const currentDir = path.dirname(currentFile);
    const baseName = path.basename(currentFile, '.typ');

    // Look for existing .bib files in the same directory
    const files = fs.readdirSync(currentDir);
    const bibFiles = files.filter(f => f.endsWith('.bib'));

    if (bibFiles.length === 0) {
        // No .bib file exists, propose to create one
        const defaultName = `${baseName}.bib`;
        const options: vscode.QuickPickItem[] = [
            {
                label: `$(new-file) Create ${defaultName}`,
                description: 'Create new bibliography file',
                detail: path.join(currentDir, defaultName)
            },
            {
                label: '$(folder-opened) Choose location...',
                description: 'Select or create a .bib file',
                detail: 'Browse for file'
            }
        ];

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: 'No .bib file found. Create one?',
            title: 'Bibliography File'
        });

        if (!selected) {
            return undefined;
        }

        if (selected.label.includes('Create')) {
            const newBibPath = path.join(currentDir, defaultName);
            fs.writeFileSync(newBibPath, '% Bibliography file for ' + baseName + '.typ\n\n', 'utf-8');
            return newBibPath;
        } else {
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(path.join(currentDir, defaultName)),
                filters: { 'BibTeX': ['bib'] },
                title: 'Create Bibliography File'
            });
            if (uri) {
                if (!fs.existsSync(uri.fsPath)) {
                    fs.writeFileSync(uri.fsPath, '% Bibliography file\n\n', 'utf-8');
                }
                return uri.fsPath;
            }
            return undefined;
        }
    } else if (bibFiles.length === 1) {
        // One .bib file, use it
        return path.join(currentDir, bibFiles[0]);
    } else {
        // Multiple .bib files, let user choose
        const items: vscode.QuickPickItem[] = bibFiles.map(f => ({
            label: f,
            description: path.join(currentDir, f)
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Multiple .bib files found. Select one:',
            title: 'Select Bibliography File'
        });

        if (selected) {
            return path.join(currentDir, selected.label);
        }
        return undefined;
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
 * Find the main .typ file for a project by looking for nova.toml.
 * Walks up directories from the given file looking for nova.toml,
 * reads the [document] main field, and resolves it relative to nova.toml's directory.
 * Falls back to the given file path if no nova.toml is found.
 */
function findMainFile(typFilePath: string): string {
    let dir = path.dirname(typFilePath);
    const root = path.parse(dir).root;

    while (true) {
        const novaTomlPath = path.join(dir, 'nova.toml');
        if (fs.existsSync(novaTomlPath)) {
            try {
                const content = fs.readFileSync(novaTomlPath, 'utf-8');
                const mainMatch = content.match(/\[document\][^[]*?main\s*=\s*"([^"]+)"/s);
                if (mainMatch) {
                    const mainFile = path.resolve(dir, mainMatch[1]);
                    if (fs.existsSync(mainFile)) {
                        outputChannel.appendLine(`Found nova.toml, main file: ${mainFile}`);
                        return mainFile;
                    } else {
                        outputChannel.appendLine(`nova.toml main file not found: ${mainFile}, using original`);
                    }
                }
            } catch (err) {
                outputChannel.appendLine(`Error reading nova.toml: ${err}`);
            }
        }

        const parentDir = path.dirname(dir);
        if (parentDir === dir || dir === root) {
            break;
        }
        dir = parentDir;
    }

    return typFilePath;
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

    const config = vscode.workspace.getConfiguration('novatype');
    const backend = config.get<string>('preview.backend') || 'builtin';

    const mainFilePath = findMainFile(editor.document.uri.fsPath);
    currentPreviewSourcePath = mainFilePath;

    if (backend === 'vscode-pdf') {
        await openPreviewWithVscodePdf(mainFilePath);
    } else {
        await openPreviewBuiltin(mainFilePath, context);
    }
}

/**
 * Open preview using vscode-pdf extension.
 */
async function openPreviewWithVscodePdf(filePath: string) {
    const novaBinary = getNovaBinaryPath();
    const previewPdfPath = filePath.replace(/\.typ$/, '.preview.pdf');

    try {
        const compileStderr = await new Promise<string>((resolve, reject) => {
            const args = ['compile', filePath, '--format', 'pdf', '--output', previewPdfPath];
            outputChannel.appendLine(`Running: ${novaBinary} ${args.join(' ')}`);

            const proc = cp.spawn(novaBinary, args, {
                cwd: path.dirname(filePath)
            });

            let stderr = '';
            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve(stderr);
                } else {
                    reject(new Error(stderr || `Exit code: ${code}`));
                }
            });

            proc.on('error', (err) => {
                reject(err);
            });
        });

        if (compileStderr.trim()) {
            setCompilationDiagnostics(compileStderr, filePath);
        } else {
            clearCompilationDiagnostics();
        }

        currentPreviewPdfPath = previewPdfPath;

        // Open the PDF file - vscode-pdf will handle it if installed
        const pdfUri = vscode.Uri.file(previewPdfPath);
        await vscode.commands.executeCommand('vscode.open', pdfUri, vscode.ViewColumn.Beside);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`Compilation error: ${errorMessage}`);
        vscode.window.showErrorMessage(`NovaType compilation failed: ${errorMessage}`);
        setCompilationDiagnostics(errorMessage, filePath);
    }
}

/**
 * Open preview using built-in PDF.js viewer.
 */
async function openPreviewBuiltin(filePath: string, context: vscode.ExtensionContext) {
    if (previewPanel) {
        previewPanel.reveal(vscode.ViewColumn.Beside);
    } else {
        previewPanel = vscode.window.createWebviewPanel(
            'novatypePreview',
            'NovaType Preview',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.dirname(filePath))
                ]
            }
        );

        previewPanel.onDidDispose(() => {
            previewPanel = undefined;
            currentPreviewSourcePath = undefined;
        });
    }

    await refreshPreview(filePath, context);
}

/**
 * Refresh the preview with the current document.
 */
async function refreshPreview(filePath: string, context: vscode.ExtensionContext) {
    if (!previewPanel) {
        return;
    }

    const novaBinary = getNovaBinaryPath();
    const tempPdfPath = filePath.replace(/\.typ$/, '.preview.pdf');

    try {
        // Compile to PDF
        const compileStderr = await new Promise<string>((resolve, reject) => {
            const args = ['compile', filePath, '--format', 'pdf', '--output', tempPdfPath];
            outputChannel.appendLine(`Running: ${novaBinary} ${args.join(' ')}`);

            const proc = cp.spawn(novaBinary, args, {
                cwd: path.dirname(filePath)
            });

            let stderr = '';
            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve(stderr);
                } else {
                    reject(new Error(stderr || `Exit code: ${code}`));
                }
            });

            proc.on('error', (err) => {
                reject(err);
            });
        });

        // Show warnings from successful compilation
        if (compileStderr.trim()) {
            setCompilationDiagnostics(compileStderr, filePath);
        } else {
            clearCompilationDiagnostics();
        }

        // Read PDF as base64
        const pdfBuffer = fs.readFileSync(tempPdfPath);
        const pdfBase64 = pdfBuffer.toString('base64');

        previewPanel.webview.html = getPdfPreviewHtml(pdfBase64);

        // Clean up temp file
        try {
            fs.unlinkSync(tempPdfPath);
        } catch {
            // Ignore cleanup errors
        }

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`Compilation error: ${errorMessage}`);
        previewPanel.webview.html = getErrorHtml(errorMessage);
        setCompilationDiagnostics(errorMessage, filePath);
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
        const compileStderr = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Compiling document...',
                cancellable: false
            },
            async () => {
                return new Promise<string>((resolve, reject) => {
                    const proc = cp.spawn(novaBinary, args, {
                        cwd: path.dirname(filePath)
                    });

                    let stderr = '';
                    proc.stdout.on('data', (data) => {
                        outputChannel.appendLine(data.toString());
                    });

                    proc.stderr.on('data', (data) => {
                        const chunk = data.toString();
                        stderr += chunk;
                        outputChannel.appendLine(chunk);
                    });

                    proc.on('close', (code) => {
                        if (code === 0) {
                            resolve(stderr);
                        } else {
                            reject(new Error(stderr || `Compilation failed with exit code ${code}`));
                        }
                    });

                    proc.on('error', (err) => {
                        reject(err);
                    });
                });
            }
        );

        if (compileStderr.trim()) {
            setCompilationDiagnostics(compileStderr, filePath);
        } else {
            clearCompilationDiagnostics();
        }

        vscode.window.showInformationMessage(`Compiled: ${path.basename(outputPath)}`);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Compilation failed: ${errorMessage}`);
        outputChannel.appendLine(`Error: ${errorMessage}`);
        setCompilationDiagnostics(errorMessage, filePath);
    }
}

/**
 * Generate HTML for the PDF preview panel using PDF.js.
 */
function getPdfPreviewHtml(pdfBase64: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NovaType Preview</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs" type="module"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            background: #2d2d2d;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 20px;
            gap: 20px;
        }
        .toolbar {
            position: fixed;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            background: #3c3c3c;
            padding: 8px 16px;
            border-radius: 8px;
            display: flex;
            gap: 12px;
            align-items: center;
            z-index: 100;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        }
        .toolbar button {
            background: #0e639c;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .toolbar button:hover {
            background: #1177bb;
        }
        .toolbar span {
            color: #ccc;
            font-family: system-ui, sans-serif;
            font-size: 14px;
        }
        #pages-container {
            margin-top: 60px;
            display: flex;
            flex-direction: column;
            gap: 20px;
            align-items: center;
        }
        .page-wrapper {
            background: white;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        }
        canvas {
            display: block;
        }
        .loading {
            color: #ccc;
            font-family: system-ui, sans-serif;
            font-size: 16px;
            margin-top: 100px;
        }
    </style>
</head>
<body>
    <div class="toolbar">
        <button id="zoom-out">-</button>
        <span id="zoom-level">100%</span>
        <button id="zoom-in">+</button>
        <span>|</span>
        <span id="page-info">Loading...</span>
    </div>
    <div id="pages-container">
        <div class="loading">Loading PDF...</div>
    </div>

    <script type="module">
        const pdfData = atob('${pdfBase64}');
        const pdfArray = new Uint8Array(pdfData.length);
        for (let i = 0; i < pdfData.length; i++) {
            pdfArray[i] = pdfData.charCodeAt(i);
        }

        let currentScale = 1.5;
        let pdfDoc = null;
        let renderedPages = [];

        const pdfjsLib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs');
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';

        async function renderAllPages() {
            const container = document.getElementById('pages-container');
            container.innerHTML = '';
            renderedPages = [];

            for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
                const page = await pdfDoc.getPage(pageNum);
                const viewport = page.getViewport({ scale: currentScale });

                const wrapper = document.createElement('div');
                wrapper.className = 'page-wrapper';

                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                wrapper.appendChild(canvas);
                container.appendChild(wrapper);

                await page.render({
                    canvasContext: context,
                    viewport: viewport
                }).promise;

                renderedPages.push({ page, canvas, context });
            }

            document.getElementById('page-info').textContent = pdfDoc.numPages + ' page(s)';
        }

        async function updateZoom() {
            document.getElementById('zoom-level').textContent = Math.round(currentScale * 100 / 1.5) + '%';
            await renderAllPages();
        }

        document.getElementById('zoom-in').addEventListener('click', async () => {
            currentScale = Math.min(currentScale + 0.25, 4);
            await updateZoom();
        });

        document.getElementById('zoom-out').addEventListener('click', async () => {
            currentScale = Math.max(currentScale - 0.25, 0.5);
            await updateZoom();
        });

        try {
            pdfDoc = await pdfjsLib.getDocument({ data: pdfArray }).promise;
            await renderAllPages();
        } catch (error) {
            document.getElementById('pages-container').innerHTML =
                '<div class="loading" style="color: #f48771;">Error loading PDF: ' + error.message + '</div>';
        }
    </script>
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

// ============================================================================
// Visual Table Editor
// ============================================================================

interface TableData {
    columns: number;
    alignParam: string;     // raw align param text, e.g. "(left, center, center)"
    strokeParam: string;    // raw stroke param text, e.g. "0.5pt"
    insetParam: string;     // raw inset param text, e.g. "8pt"
    cells: string[][];      // rows × cols of cell text (without [ ])
    startOffset: number;    // offset of 'table(' in document
    endOffset: number;      // offset of matching ')' + 1
}

/**
 * Parse a Typst table(...) starting at a given offset in the text.
 * Returns structured table data or undefined if parsing fails.
 */
function parseTypstTable(text: string, tableStartOffset: number): TableData | undefined {
    // Find the opening paren of table(
    const parenStart = text.indexOf('(', tableStartOffset);
    if (parenStart === -1) { return undefined; }

    // Find matching closing ')' using a stack that tracks bracket types
    const stack: string[] = ['('];
    let i = parenStart + 1;
    while (i < text.length && stack.length > 0) {
        const ch = text[i];
        if (ch === '(' || ch === '[' || ch === '{') {
            stack.push(ch);
        } else if (ch === ')') {
            if (stack[stack.length - 1] === '(') { stack.pop(); } else { break; }
        } else if (ch === ']') {
            if (stack[stack.length - 1] === '[') { stack.pop(); } else { break; }
        } else if (ch === '}') {
            if (stack[stack.length - 1] === '{') { stack.pop(); } else { break; }
        } else if (ch === '"') {
            // Skip string
            i++;
            while (i < text.length && text[i] !== '"') {
                if (text[i] === '\\') { i++; }
                i++;
            }
        }
        i++;
    }
    const parenEnd = i; // one past the closing ')'
    const inner = text.substring(parenStart + 1, parenEnd - 1);

    // Extract named parameters and cell contents
    let columns = 0;
    let alignParam = '';
    let strokeParam = '';
    let insetParam = '';
    const cellTexts: string[] = [];

    // Tokenize inner content: find named params and [cell] entries
    let pos = 0;
    while (pos < inner.length) {
        // Skip whitespace and commas
        while (pos < inner.length && /[\s,]/.test(inner[pos])) { pos++; }
        if (pos >= inner.length) { break; }

        if (inner[pos] === '[') {
            // Cell content — find matching ]
            let cellDepth = 1;
            let cellStart = pos + 1;
            pos++;
            while (pos < inner.length && cellDepth > 0) {
                if (inner[pos] === '[') { cellDepth++; }
                else if (inner[pos] === ']') { cellDepth--; }
                pos++;
            }
            cellTexts.push(inner.substring(cellStart, pos - 1));
        } else {
            // Named parameter: name: value
            const paramMatch = inner.substring(pos).match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*/);
            if (paramMatch) {
                const paramName = paramMatch[1];
                pos += paramMatch[0].length;

                // Read the value — could be a number, parenthesized tuple, or identifier
                let value = '';
                if (inner[pos] === '(') {
                    // Parenthesized value — find matching )
                    let pDepth = 1;
                    let vStart = pos;
                    pos++;
                    while (pos < inner.length && pDepth > 0) {
                        if (inner[pos] === '(') { pDepth++; }
                        else if (inner[pos] === ')') { pDepth--; }
                        pos++;
                    }
                    value = inner.substring(vStart, pos);
                } else {
                    // Simple value — read until comma or newline or [
                    let vStart = pos;
                    while (pos < inner.length && inner[pos] !== ',' && inner[pos] !== '\n' && inner[pos] !== '[') {
                        pos++;
                    }
                    value = inner.substring(vStart, pos).trim();
                }

                switch (paramName) {
                    case 'columns':
                        columns = parseInt(value, 10) || 0;
                        break;
                    case 'align':
                        alignParam = value;
                        break;
                    case 'stroke':
                        strokeParam = value;
                        break;
                    case 'inset':
                        insetParam = value;
                        break;
                }
            } else {
                // Unknown token, skip to next comma or whitespace
                while (pos < inner.length && inner[pos] !== ',' && inner[pos] !== '\n') { pos++; }
            }
        }
    }

    if (columns <= 0 || cellTexts.length === 0) {
        return undefined;
    }

    // Group cells into rows
    const cells: string[][] = [];
    for (let r = 0; r < cellTexts.length; r += columns) {
        const row: string[] = [];
        for (let c = 0; c < columns; c++) {
            row.push(r + c < cellTexts.length ? cellTexts[r + c] : '');
        }
        cells.push(row);
    }

    return {
        columns,
        alignParam,
        strokeParam,
        insetParam,
        cells,
        startOffset: tableStartOffset,
        endOffset: parenEnd,
    };
}

/**
 * Serialize structured table data back to Typst code.
 */
function serializeTypstTable(data: TableData, indent: string = '    '): string {
    const lines: string[] = [];
    lines.push('table(');

    // Named parameters
    lines.push(`${indent}columns: ${data.columns},`);
    if (data.alignParam) {
        lines.push(`${indent}align: ${data.alignParam},`);
    }
    if (data.strokeParam) {
        lines.push(`${indent}stroke: ${data.strokeParam},`);
    }
    if (data.insetParam) {
        lines.push(`${indent}inset: ${data.insetParam},`);
    }

    // Calculate column widths for alignment
    const colWidths: number[] = new Array(data.columns).fill(0);
    for (const row of data.cells) {
        for (let c = 0; c < data.columns; c++) {
            const cellText = `[${row[c] || ''}]`;
            colWidths[c] = Math.max(colWidths[c], cellText.length);
        }
    }

    // Cell rows
    for (const row of data.cells) {
        const parts: string[] = [];
        for (let c = 0; c < data.columns; c++) {
            const cellText = `[${row[c] || ''}]`;
            const padded = c < data.columns - 1 ? cellText.padEnd(colWidths[c]) : cellText;
            parts.push(padded);
        }
        lines.push(`${indent}${parts.join(', ')},`);
    }

    lines.push(')');
    return lines.join('\n');
}

/**
 * CodeLens provider that shows "Edit Table" above table() calls.
 */
class TableCodeLensProvider implements vscode.CodeLensProvider {
    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];
        const text = document.getText();
        // Find all table( occurrences that aren't in comments
        const tableRegex = /\btable\s*\(/g;
        let match;

        while ((match = tableRegex.exec(text)) !== null) {
            const pos = document.positionAt(match.index);
            const line = document.lineAt(pos.line);

            // Skip if in a comment
            const trimmed = line.text.trimStart();
            if (trimmed.startsWith('//')) { continue; }

            const range = new vscode.Range(pos.line, 0, pos.line, 0);
            const lens = new vscode.CodeLens(range, {
                title: '$(table) Edit Table',
                command: 'novatype.editTable',
                arguments: [document.uri, match.index]
            });
            lenses.push(lens);
        }

        return lenses;
    }
}

let tableEditorPanel: vscode.WebviewPanel | undefined;
let tableEditorMessageDisposable: vscode.Disposable | undefined;

/**
 * Command handler: open the visual table editor for the table at the given offset.
 */
function editTable(context: vscode.ExtensionContext, uri: vscode.Uri, tableOffset: number) {
    // Find the document — use active editor since CodeLens is shown in the active document
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
    }
    const document = editor.document;

    const text = document.getText();
    const tableData = parseTypstTable(text, tableOffset);
    if (!tableData) {
        vscode.window.showErrorMessage('Could not parse table at this location');
        return;
    }

    // Dispose previous message listener to avoid duplicates
    if (tableEditorMessageDisposable) {
        tableEditorMessageDisposable.dispose();
        tableEditorMessageDisposable = undefined;
    }

    // If panel already exists, reveal it; otherwise create new
    if (tableEditorPanel) {
        tableEditorPanel.reveal(vscode.ViewColumn.Beside);
    } else {
        tableEditorPanel = vscode.window.createWebviewPanel(
            'novatypeTableEditor',
            'Table Editor',
            vscode.ViewColumn.Beside,
            { enableScripts: true }
        );
        tableEditorPanel.onDidDispose(() => {
            tableEditorPanel = undefined;
            if (tableEditorMessageDisposable) {
                tableEditorMessageDisposable.dispose();
                tableEditorMessageDisposable = undefined;
            }
        });
    }

    tableEditorPanel.webview.html = getTableEditorHtml(tableData);

    // Capture document reference for the message handler
    const targetDocument = document;

    // Handle messages from webview
    tableEditorMessageDisposable = tableEditorPanel.webview.onDidReceiveMessage(async (message) => {
        if (message.type === 'applyTable') {
            const updatedData: TableData = message.data;
            // Determine the indentation of the original table( line
            const tablePos = targetDocument.positionAt(tableData.startOffset);
            const tableLine = targetDocument.lineAt(tablePos.line);
            const lineText = tableLine.text;
            const tableColInLine = lineText.indexOf('table');
            const indent = ' '.repeat(tableColInLine + 2); // indent cells relative to table(

            const newTableCode = serializeTypstTable({
                ...updatedData,
                startOffset: tableData.startOffset,
                endOffset: tableData.endOffset,
            }, indent);

            const edit = new vscode.WorkspaceEdit();
            const startPos = targetDocument.positionAt(tableData.startOffset);
            const endPos = targetDocument.positionAt(tableData.endOffset);
            edit.replace(targetDocument.uri, new vscode.Range(startPos, endPos), newTableCode);
            await vscode.workspace.applyEdit(edit);

            if (tableEditorPanel) {
                tableEditorPanel.dispose();
            }
        } else if (message.type === 'cancel') {
            if (tableEditorPanel) {
                tableEditorPanel.dispose();
            }
        } else if (message.type === 'importCsv') {
            const fileUri = await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters: {
                    'Spreadsheet files': ['csv', 'tsv', 'txt'],
                },
                title: 'Import CSV/TSV file'
            });
            if (fileUri && fileUri.length > 0) {
                const content = fs.readFileSync(fileUri[0].fsPath, 'utf8');
                // Detect delimiter: if tabs are present, use TSV; otherwise CSV
                const delimiter = content.includes('\t') ? '\t' : ',';
                const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
                while (lines.length > 0 && lines[lines.length - 1].trim() === '') { lines.pop(); }
                if (lines.length > 0) {
                    const rows: string[][] = [];
                    let maxCols = 0;
                    for (const line of lines) {
                        let cols: string[];
                        if (delimiter === ',') {
                            // Simple CSV parse (handles quoted fields)
                            cols = parseCsvLine(line);
                        } else {
                            cols = line.split('\t');
                        }
                        if (cols.length > maxCols) { maxCols = cols.length; }
                        rows.push(cols);
                    }
                    // Pad short rows
                    for (const row of rows) {
                        while (row.length < maxCols) { row.push(''); }
                    }
                    tableEditorPanel?.webview.postMessage({
                        type: 'loadCsv',
                        rows,
                        columns: maxCols,
                    });
                }
            }
        }
    });
}

function parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                current += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === ',') {
                result.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
    }
    result.push(current.trim());
    return result;
}

/**
 * Command handler: create a new table from scratch.
 * Opens the table editor with an empty grid; on Apply, inserts the code at cursor.
 */
function createTable(context: vscode.ExtensionContext) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'typst') {
        vscode.window.showErrorMessage('Open a Typst file first');
        return;
    }

    // Start with a small empty 3×3 table
    const emptyData: TableData = {
        columns: 3,
        alignParam: '',
        strokeParam: '0.5pt',
        insetParam: '8pt',
        cells: [
            ['', '', ''],
            ['', '', ''],
            ['', '', ''],
        ],
        startOffset: -1,
        endOffset: -1,
    };

    // Dispose previous message listener
    if (tableEditorMessageDisposable) {
        tableEditorMessageDisposable.dispose();
        tableEditorMessageDisposable = undefined;
    }

    if (tableEditorPanel) {
        tableEditorPanel.reveal(vscode.ViewColumn.Beside);
    } else {
        tableEditorPanel = vscode.window.createWebviewPanel(
            'novatypeTableEditor',
            'Create Table',
            vscode.ViewColumn.Beside,
            { enableScripts: true }
        );
        tableEditorPanel.onDidDispose(() => {
            tableEditorPanel = undefined;
            if (tableEditorMessageDisposable) {
                tableEditorMessageDisposable.dispose();
                tableEditorMessageDisposable = undefined;
            }
        });
    }

    tableEditorPanel.title = 'Create Table';
    tableEditorPanel.webview.html = getTableEditorHtml(emptyData);

    const targetEditor = editor;

    tableEditorMessageDisposable = tableEditorPanel.webview.onDidReceiveMessage(async (message) => {
        if (message.type === 'applyTable') {
            const data: TableData = message.data;
            // Determine indentation from cursor position
            const cursorPos = targetEditor.selection.active;
            const lineText = targetEditor.document.lineAt(cursorPos.line).text;
            const leadingWhitespace = lineText.match(/^(\s*)/)?.[1] || '';
            const indent = leadingWhitespace + '  ';

            const tableCode = serializeTypstTable(data, indent);

            // Wrap in #figure() with caption and label
            const figureCode = `#figure(\n${indent}${tableCode},\n${indent}caption: []\n${leadingWhitespace})`;

            await targetEditor.edit(editBuilder => {
                editBuilder.insert(cursorPos, figureCode);
            });

            if (tableEditorPanel) {
                tableEditorPanel.dispose();
            }
        } else if (message.type === 'cancel') {
            if (tableEditorPanel) {
                tableEditorPanel.dispose();
            }
        } else if (message.type === 'importCsv') {
            const fileUri = await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters: { 'Spreadsheet files': ['csv', 'tsv', 'txt'] },
                title: 'Import CSV/TSV file'
            });
            if (fileUri && fileUri.length > 0) {
                const content = fs.readFileSync(fileUri[0].fsPath, 'utf8');
                const delimiter = content.includes('\t') ? '\t' : ',';
                const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
                while (lines.length > 0 && lines[lines.length - 1].trim() === '') { lines.pop(); }
                if (lines.length > 0) {
                    const rows: string[][] = [];
                    let maxCols = 0;
                    for (const line of lines) {
                        const cols = delimiter === ',' ? parseCsvLine(line) : line.split('\t');
                        if (cols.length > maxCols) { maxCols = cols.length; }
                        rows.push(cols);
                    }
                    for (const row of rows) {
                        while (row.length < maxCols) { row.push(''); }
                    }
                    tableEditorPanel?.webview.postMessage({ type: 'loadCsv', rows, columns: maxCols });
                }
            }
        }
    });
}

/**
 * Generate the HTML for the table editor webview.
 * Uses only addEventListener (no inline handlers) for CSP compatibility.
 */
function getTableEditorHtml(tableData: TableData): string {
    const dataJson = JSON.stringify(tableData);
    // Encode as base64 to avoid any escaping issues in the HTML
    const dataBase64 = Buffer.from(dataJson, 'utf8').toString('base64');
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  :root {
    --bg: var(--vscode-editor-background, #1e1e1e);
    --fg: var(--vscode-editor-foreground, #cccccc);
    --border: var(--vscode-panel-border, #444444);
    --input-bg: var(--vscode-input-background, #3c3c3c);
    --input-fg: var(--vscode-input-foreground, #cccccc);
    --btn-bg: var(--vscode-button-background, #0e639c);
    --btn-fg: var(--vscode-button-foreground, #ffffff);
    --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
    --btn-secondary-bg: var(--vscode-button-secondaryBackground, #3a3d41);
    --btn-secondary-fg: var(--vscode-button-secondaryForeground, #cccccc);
    --highlight: var(--vscode-focusBorder, #007fd4);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
    font-size: var(--vscode-font-size, 13px);
    background: var(--bg);
    color: var(--fg);
    padding: 16px;
  }
  h2 { margin-bottom: 12px; font-weight: 500; }
  #errorBox { color: #f44; margin: 8px 0; font-family: monospace; white-space: pre-wrap; }

  .toolbar {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .toolbar button {
    background: var(--btn-secondary-bg);
    color: var(--btn-secondary-fg);
    border: none;
    padding: 4px 10px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 12px;
  }
  .toolbar button:hover { opacity: 0.85; }
  .toolbar-sep {
    width: 1px;
    background: var(--border);
    align-self: stretch;
    margin: 0 4px;
  }

  .table-container {
    overflow: auto;
    max-height: calc(100vh - 160px);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th {
    background: var(--btn-secondary-bg);
    padding: 4px 8px;
    font-size: 11px;
    font-weight: 500;
    text-align: center;
    border: 1px solid var(--border);
    min-width: 40px;
  }
  td {
    border: 1px solid var(--border);
    padding: 0;
    position: relative;
  }
  td input {
    width: 100%;
    background: transparent;
    color: var(--input-fg);
    border: none;
    padding: 6px 8px;
    font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
    font-size: 13px;
    outline: none;
  }
  td input:focus {
    background: var(--input-bg);
    box-shadow: inset 0 0 0 1px var(--highlight);
  }
  td.bold-cell input { font-weight: bold; }

  .row-header {
    background: var(--btn-secondary-bg);
    text-align: center;
    font-size: 11px;
    padding: 4px 6px;
    min-width: 32px;
    cursor: pointer;
    user-select: none;
  }
  .row-header:hover { opacity: 0.7; }

  .align-row select {
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--border);
    padding: 2px 4px;
    font-size: 11px;
    border-radius: 2px;
  }

  .actions {
    display: flex;
    gap: 8px;
    margin-top: 16px;
  }
  .actions button {
    padding: 6px 16px;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    font-size: 13px;
  }
  .btn-apply {
    background: var(--btn-bg);
    color: var(--btn-fg);
  }
  .btn-apply:hover { background: var(--btn-hover); }
  .btn-cancel {
    background: var(--btn-secondary-bg);
    color: var(--btn-secondary-fg);
  }
  .btn-cancel:hover { opacity: 0.85; }
</style>
</head>
<body>
<h2>Table Editor</h2>
<div id="errorBox"></div>

<div class="toolbar">
  <button id="btnAddRow">+ Row</button>
  <button id="btnAddCol">+ Column</button>
  <button id="btnDelRow">- Row</button>
  <button id="btnDelCol">- Column</button>
  <button id="btnBold">Bold Toggle</button>
  <span class="toolbar-sep"></span>
  <button id="btnPaste">Paste from Excel</button>
  <button id="btnImportCsv">Import CSV</button>
</div>

<div class="table-container">
  <table id="editTable"></table>
</div>

<div class="actions">
  <button class="btn-apply" id="btnApply">Apply</button>
  <button class="btn-cancel" id="btnCancel">Cancel</button>
</div>

<script>
(function() {
  var vscode = acquireVsCodeApi();
  var tableData;
  var selectedCell = null;

  try {
    tableData = JSON.parse(atob('${dataBase64}'));
  } catch(e) {
    document.getElementById('errorBox').textContent = 'Failed to parse table data: ' + e.message;
    return;
  }

  function escapeAttr(s) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function parseAligns(alignParam, cols) {
    var result = [];
    for (var i = 0; i < cols; i++) result.push('left');
    if (!alignParam) return result;
    var inner = alignParam.replace(/^\\(/, '').replace(/\\)$/, '');
    var parts = inner.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    for (var i = 0; i < Math.min(parts.length, cols); i++) {
      if (['left', 'center', 'right'].indexOf(parts[i]) !== -1) {
        result[i] = parts[i];
      }
    }
    return result;
  }

  function serializeAligns(aligns) {
    if (aligns.length === 0) return '';
    if (aligns.length === 1) return aligns[0];
    return '(' + aligns.join(', ') + ')';
  }

  function render() {
    try {
      var tableEl = document.getElementById('editTable');
      var aligns = parseAligns(tableData.alignParam, tableData.columns);

      // Build header row with alignment selects
      var headerRow = document.createElement('tr');
      headerRow.className = 'align-row';
      var cornerTh = document.createElement('th');
      headerRow.appendChild(cornerTh);
      for (var c = 0; c < tableData.columns; c++) {
        var th = document.createElement('th');
        var sel = document.createElement('select');
        sel.dataset.col = String(c);
        ['left', 'center', 'right'].forEach(function(a) {
          var opt = document.createElement('option');
          opt.value = a;
          opt.textContent = a;
          if (aligns[c] === a) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.addEventListener('change', function(e) {
          var col = parseInt(e.target.dataset.col);
          var als = parseAligns(tableData.alignParam, tableData.columns);
          als[col] = e.target.value;
          tableData.alignParam = serializeAligns(als);
        });
        th.appendChild(sel);
        headerRow.appendChild(th);
      }

      // Build data rows
      var rows = [headerRow];
      for (var r = 0; r < tableData.cells.length; r++) {
        var tr = document.createElement('tr');
        // Row number header
        var rowHeader = document.createElement('td');
        rowHeader.className = 'row-header';
        rowHeader.textContent = String(r + 1);
        (function(rowIdx) {
          rowHeader.addEventListener('click', function() {
            selectedCell = { row: rowIdx, col: 0 };
          });
        })(r);
        tr.appendChild(rowHeader);

        for (var c2 = 0; c2 < tableData.columns; c2++) {
          var td = document.createElement('td');
          var val = tableData.cells[r][c2] || '';
          var isBold = val.length > 1 && val.charAt(0) === '*' && val.charAt(val.length - 1) === '*';
          if (isBold) td.className = 'bold-cell';

          var input = document.createElement('input');
          input.type = 'text';
          input.value = val;
          input.dataset.row = String(r);
          input.dataset.col = String(c2);

          input.addEventListener('focus', function(e) {
            selectedCell = { row: parseInt(e.target.dataset.row), col: parseInt(e.target.dataset.col) };
          });
          input.addEventListener('input', function(e) {
            var rr = parseInt(e.target.dataset.row);
            var cc = parseInt(e.target.dataset.col);
            tableData.cells[rr][cc] = e.target.value;
            var b = e.target.value.length > 1 && e.target.value.charAt(0) === '*' && e.target.value.charAt(e.target.value.length - 1) === '*';
            e.target.parentElement.className = b ? 'bold-cell' : '';
          });
          input.addEventListener('keydown', function(e) {
            var rr = parseInt(e.target.dataset.row);
            var cc = parseInt(e.target.dataset.col);
            if (e.key === 'Tab') {
              e.preventDefault();
              var nc = e.shiftKey ? cc - 1 : cc + 1;
              var nr = rr;
              if (nc >= tableData.columns) { nr++; nc = 0; }
              if (nc < 0) { nr--; nc = tableData.columns - 1; }
              if (nr >= 0 && nr < tableData.cells.length) {
                var inputs = tableEl.querySelectorAll('input');
                var idx = nr * tableData.columns + nc;
                if (inputs[idx]) inputs[idx].focus();
              }
            } else if (e.key === 'Enter') {
              e.preventDefault();
              var nr2 = rr + 1;
              if (nr2 < tableData.cells.length) {
                var inputs2 = tableEl.querySelectorAll('input');
                var idx2 = nr2 * tableData.columns + cc;
                if (inputs2[idx2]) inputs2[idx2].focus();
              }
            }
          });

          td.appendChild(input);
          tr.appendChild(td);
        }
        rows.push(tr);
      }

      // Clear and rebuild
      tableEl.innerHTML = '';
      for (var ri = 0; ri < rows.length; ri++) {
        tableEl.appendChild(rows[ri]);
      }

      document.getElementById('errorBox').textContent = '';
    } catch(e) {
      document.getElementById('errorBox').textContent = 'Render error: ' + e.message + '\\n' + e.stack;
    }
  }

  // Toolbar buttons
  document.getElementById('btnAddRow').addEventListener('click', function() {
    var newRow = [];
    for (var i = 0; i < tableData.columns; i++) newRow.push('');
    var insertAt = selectedCell ? selectedCell.row + 1 : tableData.cells.length;
    tableData.cells.splice(insertAt, 0, newRow);
    render();
  });

  document.getElementById('btnAddCol').addEventListener('click', function() {
    tableData.columns++;
    for (var i = 0; i < tableData.cells.length; i++) {
      tableData.cells[i].push('');
    }
    var aligns = parseAligns(tableData.alignParam, tableData.columns);
    tableData.alignParam = serializeAligns(aligns);
    render();
  });

  document.getElementById('btnDelRow').addEventListener('click', function() {
    if (tableData.cells.length <= 1) return;
    var delRow = selectedCell ? selectedCell.row : tableData.cells.length - 1;
    tableData.cells.splice(delRow, 1);
    if (selectedCell && selectedCell.row >= tableData.cells.length) {
      selectedCell.row = tableData.cells.length - 1;
    }
    render();
  });

  document.getElementById('btnDelCol').addEventListener('click', function() {
    if (tableData.columns <= 1) return;
    var delCol = selectedCell ? selectedCell.col : tableData.columns - 1;
    tableData.columns--;
    for (var i = 0; i < tableData.cells.length; i++) {
      tableData.cells[i].splice(delCol, 1);
    }
    var aligns = parseAligns(tableData.alignParam, tableData.columns);
    tableData.alignParam = serializeAligns(aligns);
    render();
  });

  document.getElementById('btnBold').addEventListener('click', function() {
    if (!selectedCell) return;
    var r = selectedCell.row, c = selectedCell.col;
    var val = tableData.cells[r][c] || '';
    if (val.length > 1 && val.charAt(0) === '*' && val.charAt(val.length - 1) === '*') {
      val = val.slice(1, -1);
    } else {
      val = '*' + val + '*';
    }
    tableData.cells[r][c] = val;
    render();
    setTimeout(function() {
      var inputs = document.getElementById('editTable').querySelectorAll('input');
      var idx = r * tableData.columns + c;
      if (inputs[idx]) inputs[idx].focus();
    }, 0);
  });

  // --- Paste from Excel (TSV) ---
  function parseTsv(text) {
    var lines = text.replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n').split('\\n');
    // Remove trailing empty line
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    if (lines.length === 0) return null;
    var rows = [];
    var maxCols = 0;
    for (var i = 0; i < lines.length; i++) {
      var cols = lines[i].split('\\t');
      if (cols.length > maxCols) maxCols = cols.length;
      rows.push(cols);
    }
    // Pad short rows
    for (var i = 0; i < rows.length; i++) {
      while (rows[i].length < maxCols) rows[i].push('');
    }
    return { rows: rows, columns: maxCols };
  }

  function importFromText(text) {
    var parsed = parseTsv(text);
    if (!parsed || parsed.columns === 0) {
      document.getElementById('errorBox').textContent = 'Could not parse pasted data. Expected tab-separated values.';
      return;
    }
    tableData.cells = parsed.rows;
    tableData.columns = parsed.columns;
    // Reset alignment for new column count
    var aligns = [];
    for (var i = 0; i < parsed.columns; i++) aligns.push('left');
    tableData.alignParam = serializeAligns(aligns);
    render();
    document.getElementById('errorBox').textContent = '';
  }

  document.getElementById('btnPaste').addEventListener('click', function() {
    navigator.clipboard.readText().then(function(text) {
      importFromText(text);
    }).catch(function(err) {
      document.getElementById('errorBox').textContent = 'Clipboard access denied. Use Ctrl+V instead.';
    });
  });

  // Global paste handler (Ctrl+V when not editing a cell)
  document.addEventListener('paste', function(e) {
    // If focus is on an input, let the normal paste happen
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    e.preventDefault();
    var text = (e.clipboardData || window.clipboardData).getData('text');
    if (text) importFromText(text);
  });

  // --- Import CSV file ---
  document.getElementById('btnImportCsv').addEventListener('click', function() {
    vscode.postMessage({ type: 'importCsv' });
  });

  document.getElementById('btnApply').addEventListener('click', function() {
    vscode.postMessage({ type: 'applyTable', data: tableData });
  });

  document.getElementById('btnCancel').addEventListener('click', function() {
    vscode.postMessage({ type: 'cancel' });
  });

  // Listen for messages from the extension (e.g. CSV import result)
  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (msg.type === 'loadCsv') {
      tableData.cells = msg.rows;
      tableData.columns = msg.columns;
      var aligns = [];
      for (var i = 0; i < msg.columns; i++) aligns.push('left');
      tableData.alignParam = serializeAligns(aligns);
      render();
    }
  });

  render();
})();
</script>
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
