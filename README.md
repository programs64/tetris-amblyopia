Completely made by claude, and I am very suprised by how well it turned out. Made to try and help with fixing a lazy eye, all you need are some blue-red glasses (or some other color). Adjust the colors until your glasses cancel them out, and then play. There is also a link to this on my website: https://ritchan.moe/tetris-amblyopia


# Dichoptic Drop

A browser-based falling-block puzzle game for **amblyopia (lazy eye) practice**
with red/cyan (anaglyph) or similar filter glasses. Every color is
customizable, so the falling piece can be shown to one eye and the stack of
fallen blocks to the other.

No build step and no dependencies: plain HTML, CSS and JavaScript.

## Running

- Open `index.html` in a browser, **or**
- serve the folder (e.g. `python3 -m http.server`) and visit `http://localhost:8000`, **or**
- enable GitHub Pages for this repository (deploy from the branch root).

## Features

- Standard falling-block gameplay: 10×20 field, the 7 four-cell pieces, 7-bag
  randomizer, SRS rotation with wall kicks, 180° rotation, hold (once per piece),
  up to 6 next-piece previews, ghost piece, soft/hard drop, lock delay with
  move reset, level-based gravity, T-spins, combos, back-to-back and perfect
  clear scoring.
- **Colors** (Settings → Colors) — each can be set with a color picker or by
  typing a hex code (`#ff0000`, `ff0000` or `#f00`):
  - falling piece (also used for the ghost, hold and next previews)
  - fallen blocks (or tick "use the falling piece color" to make them match)
  - game background
  - website background, separately for dark and light mode
  - presets for red/cyan, red/blue and red/green glasses, plus a "swap colors"
    button to switch which eye sees which
- **Dark/light toggle** in the top bar. It only switches the website
  background; game and block colors are untouched. Text color adapts
  automatically so it stays readable.
- **Custom key bindings** (Settings → Controls): two keys per action, saved in
  your browser.
- Handling settings: starting level, DAS, ARR, soft-drop speed, number of next
  previews, ghost piece and grid toggles.

All settings and your best score are saved in `localStorage`.

### Default controls

| Action | Keys |
| --- | --- |
| Move left / right | ← / → |
| Soft drop | ↓ |
| Hard drop | Space |
| Rotate clockwise | ↑, X |
| Rotate counter-clockwise | Z, Left Ctrl |
| Rotate 180° | A |
| Hold | C, Left Shift |
| Pause / resume | Esc, P |
| Restart | R |
| Start / play again | Enter |

## Using it for dichoptic practice

1. Put on your filter glasses and pick the preset that matches them (e.g. red/cyan).
2. Check each eye: close one eye at a time. With a red lens over one eye, red
   blocks should look bright and cyan blocks should nearly disappear, and the
   other way round for the cyan lens. Fine-tune the hex codes until each color
   is visible to only one eye.
3. Usually the **falling piece is shown to the amblyopic (weaker) eye** and the
   fallen blocks to the stronger eye. Use "Swap colors" to switch.
4. A black game background generally gives the cleanest separation.
   Blocks are drawn as flat, solid colors (no highlights or shading) so the
   filters can separate them cleanly.

This is a game, not a medical device. Use it under the guidance of an eye care
professional, who can advise on colors, contrast and session length.

## Project layout

- `index.html` – page structure and settings dialog
- `style.css` – layout and styling
- `js/engine.js` – game rules (no DOM code)
- `js/app.js` – rendering, input, key bindings, settings and persistence
