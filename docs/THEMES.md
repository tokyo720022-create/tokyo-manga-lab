# Themes

Pick a theme in **Settings > Appearance**, or tap the moon button at the top to cycle through them. The choice is saved on the device (and included in backups).

| Theme | Mood | Mode |
| --- | --- | --- |
| Sakura Night (default) | pink on dark | dark |
| Midnight Blue | cool blue | dark |
| Sakura Flowers | soft cherry petals | light |
| One Piece | deep-sea navy, straw hat gold, wave lines | dark |
| Naruto | ninja orange, headband blue, swirl rings | dark |
| Gintama (special) | silver and strawberry milk, Edo wave pattern, gradient buttons | dark |
| Dragon Ball | gi orange, ki yellow, aura rays | dark |
| Bleach | black and bone white, orange spark, slash lines | dark |
| Rent-a-Girlfriend | sky blue and a touch of pink, dotted sky | light |
| Attack on Titan | Survey Corps green, wall stone grid | dark |

The themes use colours and simple CSS patterns only. They contain no artwork, logos or characters from the series.

## Adding a theme

1. Add an entry to `THEMES` in `src/features/theme/themes.js` (id, name, note, scheme, bar colour = the theme's `--bg`, three swatch colours).
2. Add a `:root[data-theme="<id>"]` block to `css/theme.css`. Copy a similar theme; every variable in the other blocks must be set. `--pattern` and `--pattern-size` draw the faint backdrop.
3. Run `npm test`. `tests/themes.test.mjs` checks that every theme has all variables and that text, muted text, buttons and accents stay readable (contrast ratios).
4. The picker, quick button, browser bar colour and settings validation pick the new theme up from the list automatically.

The reader keeps its own dark look in every theme, so pages are never tinted.
