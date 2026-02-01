import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as https from 'https';

let previewPanel: vscode.WebviewPanel | undefined;
let outputChannel: vscode.OutputChannel;
let currentPreviewPdfPath: string | undefined;

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
        vscode.commands.registerCommand('novatype.insertDOI', () => insertFromDOI())
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

    // Auto-refresh on save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (document.languageId === 'typst') {
                const config = vscode.workspace.getConfiguration('novatype');
                if (config.get('preview.autoRefresh')) {
                    const backend = config.get<string>('preview.backend') || 'builtin';
                    if (backend === 'vscode-pdf' && currentPreviewPdfPath) {
                        // Recompile PDF for vscode-pdf
                        openPreviewWithVscodePdf(document);
                    } else if (previewPanel) {
                        refreshPreview(document, context);
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

            const entry: BibEntry = {
                key,
                type: entryType,
                file: filePath
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

    if (backend === 'vscode-pdf') {
        await openPreviewWithVscodePdf(editor.document);
    } else {
        await openPreviewBuiltin(editor.document, context);
    }
}

/**
 * Open preview using vscode-pdf extension.
 */
async function openPreviewWithVscodePdf(document: vscode.TextDocument) {
    const novaBinary = getNovaBinaryPath();
    const filePath = document.uri.fsPath;
    const previewPdfPath = filePath.replace(/\.typ$/, '.preview.pdf');

    try {
        await new Promise<void>((resolve, reject) => {
            const args = ['compile', filePath, '--format', 'pdf', '--output', previewPdfPath];
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

        currentPreviewPdfPath = previewPdfPath;

        // Open the PDF file - vscode-pdf will handle it if installed
        const pdfUri = vscode.Uri.file(previewPdfPath);
        await vscode.commands.executeCommand('vscode.open', pdfUri, vscode.ViewColumn.Beside);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`Compilation error: ${errorMessage}`);
        vscode.window.showErrorMessage(`NovaType compilation failed: ${errorMessage}`);
    }
}

/**
 * Open preview using built-in PDF.js viewer.
 */
async function openPreviewBuiltin(document: vscode.TextDocument, context: vscode.ExtensionContext) {
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
                    vscode.Uri.file(path.dirname(document.uri.fsPath))
                ]
            }
        );

        previewPanel.onDidDispose(() => {
            previewPanel = undefined;
        });
    }

    await refreshPreview(document, context);
}

/**
 * Refresh the preview with the current document.
 */
async function refreshPreview(document: vscode.TextDocument, context: vscode.ExtensionContext) {
    if (!previewPanel) {
        return;
    }

    const novaBinary = getNovaBinaryPath();
    const filePath = document.uri.fsPath;
    const tempPdfPath = filePath.replace(/\.typ$/, '.preview.pdf');

    try {
        // Compile to PDF
        await new Promise<void>((resolve, reject) => {
            const args = ['compile', filePath, '--format', 'pdf', '--output', tempPdfPath];
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
