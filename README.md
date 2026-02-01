# NovaType for VSCode

Official VSCode extension for [NovaType](https://github.com/AureClai/novatype) - a modern document composition system built on Typst.

## Features

- **Syntax Highlighting** - Full Typst syntax support
- **Live Preview** - Side-by-side preview that updates on save
- **Compile to PDF** - One-click compilation
- **Keyboard Shortcuts** - Fast workflow

## Requirements

Install NovaType CLI:

```bash
cargo install novatype-cli
```

Or download from [releases](https://github.com/AureClai/novatype/releases).

## Usage

### Preview

- Open a `.typ` file
- Press `Ctrl+Shift+V` (or `Cmd+Shift+V` on Mac)
- Or click the preview icon in the editor title bar

### Compile

- Press `Ctrl+Shift+B` (or `Cmd+Shift+B` on Mac)
- Or use Command Palette: `NovaType: Compile to PDF`

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `novatype.binaryPath` | `""` | Path to local nova binary (for development) |
| `novatype.preview.autoRefresh` | `true` | Refresh preview on save |
| `novatype.preview.refreshDelay` | `300` | Delay before refresh (ms) |
| `novatype.compile.outputFormat` | `"pdf"` | Output format (pdf, svg) |
| `novatype.compile.openAfterCompile` | `true` | Open PDF after compile |

### Development Mode

To use a local build of NovaType instead of the installed version:

```json
{
  "novatype.binaryPath": "/path/to/novatype/target/release/nova"
}
```

## Keyboard Shortcuts

| Command | Windows/Linux | Mac |
|---------|---------------|-----|
| Open Preview | `Ctrl+Shift+V` | `Cmd+Shift+V` |
| Compile | `Ctrl+Shift+B` | `Cmd+Shift+B` |

## License

MIT
