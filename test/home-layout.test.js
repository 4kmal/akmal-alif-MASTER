import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tactileStyles = readFileSync(new URL('../css/tactile.css', import.meta.url), 'utf8');
const mobileTracklist = readFileSync(new URL('../js/mobile-tracklist.js', import.meta.url), 'utf8');

function blockEnd(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return index;
  }
  throw new Error('Unbalanced CSS block');
}

function mediaBlocks(source, query) {
  const blocks = [];
  let start = source.indexOf(`@media ${query} {`);
  while (start !== -1) {
    const open = source.indexOf('{', start);
    const end = blockEnd(source, open);
    blocks.push(source.slice(open + 1, end));
    start = source.indexOf(`@media ${query} {`, end);
  }
  return blocks;
}

function withoutMediaBlocks(source) {
  let result = '';
  let cursor = 0;
  let start = source.indexOf('@media');
  while (start !== -1) {
    const open = source.indexOf('{', start);
    const end = blockEnd(source, open);
    result += source.slice(cursor, start);
    cursor = end + 1;
    start = source.indexOf('@media', cursor);
  }
  return result + source.slice(cursor);
}

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&');
  return source.match(new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`))?.[1] || '';
}

const baseStyles = withoutMediaBlocks(tactileStyles);
const tabletQuery = '(min-width: 600px) and (max-width: 1279px)';

test('desktop keeps the three-column grid and the sticky calendar rail', () => {
  assert.match(rule(baseStyles, '.home-content-wrapper'), /grid-template-columns:\s*240px minmax\(0, 800px\) 280px/);
  assert.match(baseStyles, /#clock-widget-placeholder\s*\{[^}]*align-self:\s*stretch/);
  assert.match(rule(baseStyles, '.calendar-rail'), /position:\s*sticky/);
});

test('tablets place the main card and the calendar rail in two columns', () => {
  const [tablet = ''] = mediaBlocks(tactileStyles, tabletQuery);
  const columns = rule(tablet, '.home-content-wrapper').match(/grid-template-columns:\s*([^;]+);/)?.[1] || '';
  assert.equal(columns.split(/\s+(?![^(]*\))/).length, 2);
  assert.match(rule(tablet, '.main-content-column'), /grid-column:\s*1/);
  assert.match(rule(tablet, '#clock-widget-placeholder'), /grid-column:\s*2/);
  assert.doesNotMatch(rule(tablet, '#clock-widget-placeholder'), /align-self/);
  assert.doesNotMatch(rule(tablet, '.calendar-rail'), /position:/);
});

test('only phones stack the calendar rail above the main card', () => {
  const phone = mediaBlocks(tactileStyles, '(max-width: 599px)').join('\n');
  const drawer = mediaBlocks(tactileStyles, '(max-width: 1279px)').join('\n');
  assert.match(rule(phone, '#clock-widget-placeholder'), /order:\s*-1/);
  assert.match(rule(phone, '.home-content-wrapper'), /flex-direction:\s*column/);
  assert.doesNotMatch(drawer, /order:\s*-1/);
  assert.doesNotMatch(rule(drawer, '.home-content-wrapper'), /flex-direction:\s*column/);
});

test('the tracklist drawer breakpoint matches its script', () => {
  const drawer = mediaBlocks(tactileStyles, '(max-width: 1279px)').join('\n');
  assert.match(rule(drawer, '.tracklist-panel'), /position:\s*fixed/);
  assert.match(mobileTracklist, /drawerBreakpoint = 1279;/);
});
