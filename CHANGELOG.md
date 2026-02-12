# Changelog

All notable changes to the NovaType VS Code extension will be documented in this file.

## [0.2.0] - 2026-02-12

### Added

#### Code Intelligence
- **Document Outline** — Hierarchical view of headings, labels, and `#import` statements in the Explorer sidebar
- **Go to Definition** (`Ctrl+Click` / `F12`) — Navigate to `<label>` definitions, `#let` bindings (local and imported), `#import` source files, and `.bib` entries
- **Find All References** (`Shift+F12`) — Find all usages of labels, `@` references, and `#let` identifiers across the entire project
- **Inline Compilation Errors** — Typst compiler errors and warnings shown as diagnostics directly in the editor
- **Unescaped `@` Detection** — Warns about unescaped `@` in email addresses with quick fix and "fix all" code actions
- **Code Folding** — Fold headings (level-aware), raw blocks, and block comments (`/* */`)

#### Visual Table Editor
- **Edit Table** command with CodeLens — Click "Edit Table" above any `table()` to open a visual spreadsheet editor
- **Create Table** command — Create a new table from an empty grid via the Command Palette
- **Paste from Excel** — Import tab-separated data directly from the clipboard
- **Import CSV/TSV** — Load table data from files with automatic delimiter detection
- Cell navigation (`Tab`, `Shift+Tab`, `Enter`), bold toggle, per-column alignment, add/remove rows and columns

#### Snippets
- Raw block (`` ``` ``, `raw`, `code`)
- Inline equation with label (`eq`)
- Block equation with label (`eqb`)
- Figure with caption and label (`fig`)
- Table figure with caption and label (`tbl`)
- Email with escaped `\@` (`mail`, `email`)
- Hyperlink with `#link()` (`url`, `link`)

#### Editing Enhancements
- **Word Wrap** — Enabled by default for Typst files
- **Word Count** — Live word count in the status bar (strips comments, code blocks, labels, and math)
- **List Indentation** — `Tab` / `Shift+Tab` to indent/outdent list items (`-`, `+`, `1.`)
- **List Continuation** — `Enter` automatically continues list markers and cleans up empty items

### Fixed
- **Preview compiles correct file** — Preview now reads `nova.toml` to find the main file, so saving `lib.typ` no longer creates an unwanted `lib.preview.pdf`
- **Syntax highlighting** — Fixed alternating blue/white colors on normal text caused by an overly broad `variable.other.typst` rule; rewrote TextMate grammar with proper scope restrictions

## [0.1.0] - 2025-01-15

### Added
- Live PDF preview (built-in and vscode-pdf backends)
- Typst syntax highlighting (TextMate grammar)
- Reference completion (`@`) with labels and bibliography entries
- Label completion (`<`) with typed prefixes
- Bibliography management: CrossRef search and DOI import
- Compile to PDF command
- Configurable nova binary path
- Auto-refresh on save
