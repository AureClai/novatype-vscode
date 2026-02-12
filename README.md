<p align="center">
  <img src="https://raw.githubusercontent.com/AureClai/novatype-vscode/master/assets/logo.png" alt="NovaType Logo" width="120" height="120">
</p>

<h1 align="center">NovaType for Visual Studio Code</h1>

<p align="center">
  <strong>The ultimate Typst editing experience for VS Code</strong>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=aureclai.novatype">
    <img src="https://img.shields.io/visual-studio-marketplace/v/aureclai.novatype?style=flat-square&label=VS%20Marketplace&logo=visual-studio-code" alt="VS Marketplace Version">
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=aureclai.novatype">
    <img src="https://img.shields.io/visual-studio-marketplace/d/aureclai.novatype?style=flat-square&label=Downloads&logo=visual-studio-code" alt="VS Marketplace Downloads">
  </a>
  <a href="https://github.com/AureClai/novatype-vscode/blob/master/LICENSE">
    <img src="https://img.shields.io/github/license/AureClai/novatype-vscode?style=flat-square" alt="License">
  </a>
  <a href="https://github.com/AureClai/novatype">
    <img src="https://img.shields.io/badge/NovaType-Core-blue?style=flat-square&logo=rust" alt="NovaType Core">
  </a>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#code-intelligence">Code Intelligence</a> •
  <a href="#bibliography">Bibliography</a> •
  <a href="#visual-table-editor">Table Editor</a> •
  <a href="#configuration">Configuration</a>
</p>

---

## Overview

**NovaType for VS Code** is the official extension for [NovaType](https://github.com/AureClai/novatype), a modern document composition system built on [Typst](https://typst.app). Write beautiful scientific documents, papers, and reports with real-time preview, intelligent autocompletion, and integrated bibliography management.

<p align="center">
  <img src="https://raw.githubusercontent.com/AureClai/novatype-vscode/master/assets/demo.gif" alt="NovaType Demo" width="800">
</p>

## Features

### Live Preview
Real-time PDF preview that updates on save. The preview compiles the project's main file (detected via `nova.toml`), so editing any file in the project triggers a correct compilation. Choose between the built-in viewer or the [vscode-pdf](https://marketplace.visualstudio.com/items?itemName=tomoki1207.pdf) extension.

### Code Intelligence
- **Document Outline** — Hierarchical view of headings, labels, and imports in the Explorer sidebar
- **Go to Definition** (`Ctrl+Click`) — Jump to `<label>` definitions, `#let` bindings, `#import` sources, and `.bib` entries
- **Find All References** (`Shift+F12`) — Find every usage of a label, reference, or `#let` identifier across all project files
- **Inline Diagnostics** — Compilation errors and warnings displayed directly in the editor
- **Unescaped `@` Detection** — Warns about unescaped `@` in emails with one-click quick fix
- **Code Folding** — Fold headings, raw blocks, and block comments

### Smart IntelliSense
- **Reference Completion** — Type `@` to see all labels and citations
- **Label Snippets** — Type `<` to insert structured labels (`eq:`, `fig:`, `tbl:`, etc.)
- **Bibliography Integration** — Automatic parsing of `.bib` files referenced in your document

### Snippets

Quickly insert common Typst structures:

| Prefix | Description |
|--------|-------------|
| `` ``` ``, `raw`, `code` | Raw block with language |
| `eq`, `equation` | Inline equation with label |
| `eqb` | Block equation with label |
| `fig` | Figure with caption and label |
| `tbl` | Table figure with caption and label |
| `mail`, `email` | Email address with escaped `\@` |
| `url`, `link` | Hyperlink with `#link()` |

### Bibliography Management
- **CrossRef Search** (`Ctrl+Shift+R`) — Search millions of academic papers directly from VS Code
- **DOI Import** (`Ctrl+Shift+D`) — Paste any DOI to instantly fetch and insert BibTeX entries
- **Smart .bib Handling** — Automatic file creation and duplicate detection

### Visual Table Editor
- **Edit Table** — Click the "Edit Table" CodeLens above any `table()` to open a spreadsheet-like visual editor
- **Create Table** — Create a table from scratch via the Command Palette
- **Import from Excel** — Paste tab-separated data directly from Excel or Google Sheets
- **Import CSV** — Load data from `.csv` or `.tsv` files
- **Cell Editing** — Tab/Enter navigation, bold toggle, per-column alignment control, add/remove rows and columns

### Editing Enhancements
- **Word Wrap** — Enabled by default for `.typ` files
- **Word Count** — Live word count displayed in the status bar
- **List Indentation** — `Tab`/`Shift+Tab` to indent/outdent list items (`-`, `+`, `1.`)
- **List Continuation** — `Enter` automatically continues list markers

### Developer Experience
- Full Typst syntax highlighting (improved in 0.2.0)
- Configurable nova binary path for local development
- Detailed output logging for debugging

---

## Installation

### Prerequisites

Install the NovaType CLI:

```bash
# Via Cargo (recommended)
cargo install novatype-cli

# Or download pre-built binaries
# https://github.com/AureClai/novatype/releases
```

### Extension Installation

**From VS Code Marketplace:**

1. Open VS Code
2. Press `Ctrl+P` / `Cmd+P`
3. Type `ext install aureclai.novatype`

**From VSIX:**

```bash
code --install-extension novatype-0.2.0.vsix
```

---

## Quick Start

### 1. Create a Document

```typst
#set math.equation(numbering: "(1)")

= Introduction

The famous equation by Einstein:

$ E = m c^2 $ <eq:einstein>

As shown in @eq:einstein, energy and mass are equivalent.

#bibliography("references.bib")
```

### 2. Open Preview

Press `Ctrl+Shift+V` (or `Cmd+Shift+V` on Mac) to open the live preview panel.

### 3. Compile to PDF

Press `Ctrl+Shift+B` (or `Cmd+Shift+B` on Mac) to compile your document.

---

## Code Intelligence

### Document Outline

The Explorer sidebar shows a structured outline of your document:
- Headings are nested hierarchically by level (`=`, `==`, `===`, ...)
- Labels appear as children of their enclosing heading
- `#import` statements are shown at the top level

### Go to Definition (`Ctrl+Click` / `F12`)

Jump to the definition of:
- **`@ref`** — Jump to the corresponding `<label>` or `.bib` entry
- **`#import "file.typ": name`** — Jump to the file or to the `#let` binding inside it
- **`#let` identifiers** — Jump to the binding, even if defined in an imported file

### Find All References (`Shift+F12`)

Right-click any label, reference, or identifier and select "Find All References":
- On a `<label>` — find all `@label` usages
- On a `@ref` — find the declaration and all other usages
- On a `#let` name — find the definition and all usages across the project

### Inline Diagnostics

Compilation errors and warnings from Typst are shown as squiggly underlines directly in the editor, with messages in the Problems panel. Diagnostics update each time you save.

---

## IntelliSense

### Reference Completion (`@`)

Type `@` anywhere in your document to see a list of all available references:

| Type | Example | Description |
|------|---------|-------------|
| Equation | `@eq:einstein` | Mathematical equations |
| Figure | `@fig:results` | Images and diagrams |
| Table | `@tbl:data` | Data tables |
| Section | `@sec:intro` | Document sections |
| Citation | `@vaswani2017attention` | Bibliography entries |

### Label Snippets (`<`)

Type `<` to insert a new label with the appropriate prefix:

| Prefix | Use Case | Example |
|--------|----------|---------|
| `eq:` | Equations | `<eq:maxwell>` |
| `fig:` | Figures | `<fig:architecture>` |
| `tbl:` | Tables | `<tbl:results>` |
| `sec:` | Sections | `<sec:methods>` |
| `lst:` | Code listings | `<lst:algorithm>` |
| `def:` | Definitions | `<def:entropy>` |
| `thm:` | Theorems | `<thm:main>` |
| `lem:` | Lemmas | `<lem:auxiliary>` |
| `cor:` | Corollaries | `<cor:consequence>` |
| `prop:` | Propositions | `<prop:existence>` |
| `alg:` | Algorithms | `<alg:dijkstra>` |

---

## Bibliography

### Search Papers (`Ctrl+Shift+R`)

Search the [CrossRef](https://www.crossref.org/) database containing over 130 million academic works:

1. Press `Ctrl+Shift+R` (or `Cmd+Shift+R`)
2. Enter search terms (title, author, keywords)
3. Select a paper from the results
4. BibTeX is automatically added to your `.bib` file

### Import from DOI (`Ctrl+Shift+D`)

Have a DOI? Import it directly:

1. Press `Ctrl+Shift+D` (or `Cmd+Shift+D`)
2. Paste the DOI (any format accepted):
   - `10.48550/arXiv.1706.03762`
   - `https://doi.org/10.48550/arXiv.1706.03762`
   - `doi:10.48550/arXiv.1706.03762`
3. BibTeX is fetched and inserted automatically

### .bib File Management

- **Auto-detection** — Finds `.bib` files referenced via `#bibliography("file.bib")`
- **Auto-creation** — Offers to create a new `.bib` file if none exists
- **Duplicate prevention** — Checks for existing DOIs before inserting
- **Multi-file support** — Works with multiple bibliography files

---

## Visual Table Editor

### Edit an Existing Table

A **"Edit Table"** CodeLens appears above every `table()` call in your document. Click it to open a spreadsheet-like editor where you can:
- Edit cell contents by clicking
- Navigate with `Tab`, `Shift+Tab`, and `Enter`
- Toggle bold on cells
- Change column alignment (left / center / right)
- Add or remove rows and columns

Click **Apply** to replace the table source code, or **Cancel** to discard changes.

### Create a New Table

Open the Command Palette (`Ctrl+Shift+P`) and run **"NovaType: Create Table"** to start with an empty 3x3 grid. Edit it in the visual editor, then Apply to insert a `#figure(table(...))` block at your cursor position.

### Import from Excel or CSV

In the table editor:
- **Paste from Excel** — Copy cells in Excel or Google Sheets, then click "Paste from Excel" (or press `Ctrl+V` in the editor)
- **Import CSV** — Click "Import CSV" to load a `.csv` or `.tsv` file from disk

---

## Configuration

### Interactive Settings

Run `NovaType: Configure Extension` from the Command Palette for an interactive configuration experience.

### Available Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `novatype.binaryPath` | `""` | Custom path to nova binary |
| `novatype.preview.backend` | `"builtin"` | Preview backend (`builtin` or `vscode-pdf`) |
| `novatype.preview.autoRefresh` | `true` | Auto-refresh preview on save |
| `novatype.preview.refreshDelay` | `300` | Refresh delay in milliseconds |
| `novatype.compile.outputFormat` | `"pdf"` | Output format (`pdf` or `svg`) |
| `novatype.compile.openAfterCompile` | `true` | Open file after compilation |

### Preview Backends

| Backend | Description |
|---------|-------------|
| `builtin` | Integrated PDF.js viewer with zoom controls |
| `vscode-pdf` | Uses vscode-pdf extension (better navigation, bookmarks, outline) |

### Development Mode

For NovaType contributors, point to your local build:

```json
{
  "novatype.binaryPath": "C:/path/to/novatype/target/release/nova.exe"
}
```

---

## Keyboard Shortcuts

| Command | Windows / Linux | macOS |
|---------|-----------------|-------|
| Open Preview | `Ctrl+Shift+V` | `Cmd+Shift+V` |
| Compile to PDF | `Ctrl+Shift+B` | `Cmd+Shift+B` |
| Search Bibliography | `Ctrl+Shift+R` | `Cmd+Shift+R` |
| Insert from DOI | `Ctrl+Shift+D` | `Cmd+Shift+D` |
| Indent list item | `Tab` | `Tab` |
| Outdent list item | `Shift+Tab` | `Shift+Tab` |

---

## Commands

| Command | Description |
|---------|-------------|
| `NovaType: Open Preview` | Open live PDF preview |
| `NovaType: Compile to PDF` | Compile document to PDF |
| `NovaType: Compile and Open PDF` | Compile and open in default viewer |
| `NovaType: Search Bibliography (CrossRef)` | Search for academic papers |
| `NovaType: Insert BibTeX from DOI` | Import citation from DOI |
| `NovaType: Edit Table` | Open visual editor for a table |
| `NovaType: Create Table` | Create a new table from scratch |
| `NovaType: Configure Extension` | Open settings menu |

---

## Troubleshooting

### "nova" command not found

Ensure NovaType CLI is installed and in your PATH:

```bash
cargo install novatype-cli
nova --version
```

Or set a custom binary path in settings.

### Preview not updating

1. Check that `novatype.preview.autoRefresh` is enabled
2. Ensure the document compiles without errors (check Output panel)
3. Try reloading VS Code

### Preview compiles the wrong file

NovaType reads `nova.toml` to find the project's main file. Make sure your project has a `nova.toml` with:

```toml
[document]
main = "main.typ"
```

### Bibliography not showing in autocomplete

Ensure your document includes a bibliography reference:

```typst
#bibliography("references.bib")
```

---

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## Related Projects

- [NovaType](https://github.com/AureClai/novatype) — The core document composition system
- [Typst](https://typst.app) — The underlying typesetting system
- [novatype-wasm](https://www.npmjs.com/package/novatype-wasm) — WebAssembly bindings for browser usage

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Made with &#10084; by <a href="https://github.com/AureClai">AureClai</a>
</p>
