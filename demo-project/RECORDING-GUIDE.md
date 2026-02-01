# Demo Recording Guide

## Setup

1. Open VS Code with dark theme
2. Open `main.typ` from this folder
3. Hide sidebar (`Ctrl+B`) for cleaner view
4. Set font size to 14-16px for readability
5. Position VS Code window at 1280x720 or 1920x1080

## Recording Sequence (~20 seconds)

### Scene 1: Reference Autocomplete (4s)
1. Place cursor after "see" on line with `@devlin2019bert`
2. Delete the reference
3. Type `@` → show autocomplete menu with labels AND bibliography
4. Select `devlin2019bert`

### Scene 2: CrossRef Search (6s)
1. Press `Ctrl+Shift+R`
2. Type: `GPT-4 technical report`
3. Wait for results
4. Select first result
5. Show "Added to bibliography" notification

### Scene 3: Live Preview (5s)
1. Press `Ctrl+Shift+V` to open preview
2. Scroll to equation
3. Change `sqrt(d_k)` to `sqrt(d_"model")`
4. Save (`Ctrl+S`)
5. Show preview updating

### Scene 4: Label Snippet (3s)
1. Go to end of Results section
2. Type `<fig:`
3. Show snippet completing to `<fig:name>`
4. Type `architecture`

## Tips

- Use ScreenToGif or LICEcap
- Record at 15-20 FPS
- Pause briefly between actions
- Keep final GIF under 5MB
- Crop to editor area only

## Post-processing

1. Trim any mistakes
2. Add subtle fade between scenes (optional)
3. Optimize with `gifsicle -O3 demo.gif -o demo-optimized.gif`
