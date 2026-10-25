import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEMES, THEME_OPTIONS, DEFAULT_THEME, findTheme, nextTheme } from '../src/features/theme/themes.js';
import { DEFAULT_SETTINGS, normalizeSettingValue } from '../src/features/settings/settings-service.js';

const css = readFileSync(new URL('../css/theme.css', import.meta.url), 'utf8');
const REQUIRED = ['bg', 'surface', 'raised', 'raised-2', 'line', 'line-soft', 'text', 'muted', 'faint', 'accent', 'accent-ink', 'accent-soft', 'accent-2', 'good', 'warn', 'danger'];

function block(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return null;
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  const vars = {};
  for (const match of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) vars[match[1]] = match[2].trim();
  return { vars, scheme: /color-scheme:\s*(\w+)/.exec(body)?.[1] };
}
function themeVars(id) {
  const base = block(':root').vars;
  const own = block(`:root[data-theme="${id}"]`);
  return id === 'sakura' ? { ...base } : own ? { ...base, ...own.vars } : null;
}
const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

test('theme ids are unique, the default exists and every theme has a swatch and a note', () => {
  const ids = THEMES.map(theme => theme.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes(DEFAULT_THEME));
  assert.equal(DEFAULT_SETTINGS.theme, DEFAULT_THEME);
  for (const theme of THEMES) {
    assert.ok(theme.name && theme.note, `${theme.id} needs a name and note`);
    assert.equal(theme.swatch.length, 3);
    assert.ok(['dark', 'light'].includes(theme.scheme));
    assert.match(theme.bar, /^#[0-9a-f]{6}$/i);
  }
  for (const id of ['sakura-flowers', 'one-piece', 'naruto', 'gintama', 'dragon-ball', 'bleach', 'rent-a-girlfriend', 'attack-on-titan']) assert.ok(ids.includes(id), `${id} is missing`);
});

test('every theme has a full colour block in theme.css matching its scheme and browser bar colour', () => {
  for (const theme of THEMES) {
    const vars = themeVars(theme.id);
    assert.ok(vars, `${theme.id} has no block in theme.css`);
    for (const name of REQUIRED) assert.ok(vars[name], `${theme.id} is missing --${name}`);
    assert.equal(vars.bg.toLowerCase(), theme.bar.toLowerCase(), `${theme.id}: browser bar colour should equal --bg`);
    if (theme.id !== 'sakura') assert.equal(block(`:root[data-theme="${theme.id}"]`).scheme, theme.scheme, `${theme.id}: color-scheme`);
  }
});

test('text stays readable on every theme', () => {
  for (const theme of THEMES) {
    const v = themeVars(theme.id);
    const check = (fg, bg, min, what) => assert.ok(ratio(v[fg], v[bg]) >= min, `${theme.id}: ${what} contrast ${ratio(v[fg], v[bg]).toFixed(2)} is below ${min}`);
    check('text', 'bg', 7, 'text on background');
    check('text', 'surface', 7, 'text on cards');
    check('muted', 'surface', 4.5, 'muted text on cards');
    check('muted', 'raised', 4.5, 'muted text on raised areas');
    check('faint', 'surface', 4.5, 'faint text on cards');
    check('accent-ink', 'accent', 4.5, 'button label on accent');
    check('accent', 'surface', 3, 'accent on cards');
    check('accent', 'bg', 3, 'accent on background');
    check('danger', 'surface', 3, 'danger on cards');
    check('good', 'surface', 3, 'good on cards');
    check('warn', 'surface', 3, 'warn on cards');
  }
});

test('theme setting only accepts known themes and the picker lists all of them', () => {
  assert.equal(THEME_OPTIONS.length, THEMES.length);
  for (const theme of THEMES) assert.equal(normalizeSettingValue('theme', theme.id), theme.id);
  assert.throws(() => normalizeSettingValue('theme', 'neon'));
  assert.equal(findTheme('nope').id, THEMES[0].id);
  assert.equal(nextTheme(THEMES.at(-1).id).id, THEMES[0].id);
  assert.equal(nextTheme('sakura').id, 'midnight');
});
