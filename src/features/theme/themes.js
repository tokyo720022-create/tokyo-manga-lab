// Colour themes. The colours themselves live in css/theme.css (one block per theme id, under :root[data-theme="<id>"]).
// This list drives the Settings picker, the quick theme button and the browser bar colour.
//
// The themes borrow each series' mood and colours only. They use no artwork, logos or characters.
//
// To add a theme: add an entry here, add its block to css/theme.css (copy a similar one), run `npm test`.
// The contrast test checks that text, muted text and buttons stay readable on every theme.
export const DEFAULT_THEME = 'sakura';

export const THEMES = Object.freeze([
  { id: 'sakura', name: 'Sakura Night', note: 'Pink on dark. The original look.', scheme: 'dark', bar: '#0a0910', swatch: ['#0a0910', '#f27aae', '#9d8cf7'] },
  { id: 'midnight', name: 'Midnight Blue', note: 'Cool blue on dark.', scheme: 'dark', bar: '#070b13', swatch: ['#070b13', '#6cc8f5', '#8f9cff'] },
  { id: 'sakura-flowers', name: 'Sakura Flowers', note: 'Light, with soft cherry petals.', scheme: 'light', bar: '#fff4f7', swatch: ['#fff4f7', '#d6336c', '#8e6bd8'] },
  { id: 'one-piece', name: 'One Piece', note: 'Deep sea navy, straw hat gold.', scheme: 'dark', bar: '#06121f', swatch: ['#06121f', '#f5c542', '#e8503f'] },
  { id: 'naruto', name: 'Naruto', note: 'Ninja orange with headband blue.', scheme: 'dark', bar: '#0d0b09', swatch: ['#0d0b09', '#ff8a1f', '#3f8cf0'] },
  { id: 'gintama', name: 'Gintama', note: 'Silver and strawberry milk, with Edo wave patterns.', scheme: 'dark', bar: '#0b0f1d', swatch: ['#0b0f1d', '#c9d6ff', '#ff9ec7'], special: true },
  { id: 'dragon-ball', name: 'Dragon Ball', note: 'Gi orange, ki yellow, night sky.', scheme: 'dark', bar: '#070d1f', swatch: ['#070d1f', '#ff9f1a', '#ffe14d'] },
  { id: 'bleach', name: 'Bleach', note: 'Black and bone white, orange spark.', scheme: 'dark', bar: '#08080a', swatch: ['#08080a', '#f6f3ea', '#ff6a1a'] },
  { id: 'rent-a-girlfriend', name: 'Rent-a-Girlfriend', note: 'Light, sky blue with a touch of pink.', scheme: 'light', bar: '#f1f7ff', swatch: ['#f1f7ff', '#2a74c7', '#e8719c'] },
  { id: 'attack-on-titan', name: 'Attack on Titan', note: 'Survey Corps green and wall stone.', scheme: 'dark', bar: '#0b0d0b', swatch: ['#0b0d0b', '#8fc27a', '#d3a06a'] }
]);

export const THEME_OPTIONS = Object.freeze(THEMES.map(theme => [theme.id, theme.name]));
export const findTheme = id => THEMES.find(theme => theme.id === id) || THEMES[0];
export const nextTheme = id => THEMES[(THEMES.findIndex(theme => theme.id === id) + 1) % THEMES.length];
