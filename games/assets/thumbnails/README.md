# Game Thumbnails

Each game in the catalog references a thumbnail at `/games/assets/thumbnails/<slug>.svg`.

- Thumbnails are original OmniStore-made SVGs (gradient tile + category icon + game initial), so they carry no third-party copyright.
- To add a game: drop `<slug>.svg` here and reference it from `games/registry.json`. No other UI change is needed — the portal renders rows/cards purely from the registry.
- Recommended canvas: 512×384 (4:3), rounded corners are applied by the portal CSS.
