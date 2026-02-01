<p align="center">
  <img src="https://raw.githubusercontent.com/AureClai/novatype/main/docs/static/img/logo.svg" alt="NovaType Logo" width="120" height="120">
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
  <a href="#-features">Features</a> •
  <a href="#-installation">Installation</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-intellisense">IntelliSense</a> •
  <a href="#-bibliography">Bibliography</a> •
  <a href="#%EF%B8%8F-configuration">Configuration</a>
</p>

---

## Overview

**NovaType for VS Code** is the official extension for [NovaType](https://github.com/AureClai/novatype), a modern document composition system built on [Typst](https://typst.app). Write beautiful scientific documents, papers, and reports with real-time preview, intelligent autocompletion, and integrated bibliography management.

<p align="center">
  <img src="https://raw.githubusercontent.com/AureClai/novatype-vscode/master/assets/demo.gif" alt="NovaType Demo" width="800">
</p>

## Features

### Live Preview
Real-time PDF preview that updates as you type. Choose between the built-in viewer or leverage the powerful [vscode-pdf](https://marketplace.visualstudio.com/items?itemName=tomoki1207.pdf) extension for advanced navigation.

### Smart IntelliSense
- **Reference Completion** — Type `@` to see all labels and citations
- **Label Snippets** — Type `<` to insert structured labels (`eq:`, `fig:`, `tbl:`, etc.)
- **Bibliography Integration** — Automatic parsing of `.bib` files referenced in your document

### Bibliography Management
- **CrossRef Search** — Search millions of academic papers directly from VS Code
- **DOI Import** — Paste any DOI to instantly fetch and insert BibTeX entries
- **Smart .bib Handling** — Automatic file creation and duplicate detection

### Developer Experience
- Full Typst syntax highlighting
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
code --install-extension novatype-0.1.0.vsix
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

References are grouped by type with rich metadata including line numbers, authors, and publication details.

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

The extension intelligently manages your bibliography files:

- **Auto-detection** — Finds `.bib` files referenced via `#bibliography("file.bib")`
- **Auto-creation** — Offers to create a new `.bib` file if none exists
- **Duplicate prevention** — Checks for existing DOIs before inserting
- **Multi-file support** — Works with multiple bibliography files

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

---

## Commands

| Command | Description |
|---------|-------------|
| `NovaType: Open Preview` | Open live PDF preview |
| `NovaType: Compile to PDF` | Compile document to PDF |
| `NovaType: Compile and Open PDF` | Compile and open in default viewer |
| `NovaType: Search Bibliography (CrossRef)` | Search for academic papers |
| `NovaType: Insert BibTeX from DOI` | Import citation from DOI |
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
  Made with ❤️ by <a href="https://github.com/AureClai">AureClai</a>
</p>
