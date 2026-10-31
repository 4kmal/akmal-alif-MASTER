import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { BLOG_DIAGRAMS, diagramUrl, isApprovedDiagram, mountDiagram } from '../js/blog-diagram.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('diagram keys are allowlisted and only resolve to the repo diagram folder', () => {
  assert.equal(isApprovedDiagram('publictransport-live-data'), true);
  assert.equal(diagramUrl('publictransport-live-data'), '/assets/blog/diagrams/publictransport-live-data.svg');
  for (const key of ['', 'unknown-diagram', '../publictransport-live-data', 'Publictransport-Live-Data', 'https://example.com/x', null, 42]) {
    assert.equal(isApprovedDiagram(key), false, String(key));
    assert.equal(diagramUrl(key), '');
  }
});

test('the public allowlist matches the studio allowlist', () => {
  const studio = read('apps/admin/shared/utils/blog-diagrams.ts');
  const studioKeys = [...studio.matchAll(/key: '([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(studioKeys, [...BLOG_DIAGRAMS]);
});

test('unknown diagram markers are marked invalid without a network request', async () => {
  let fetched = false;
  const figure = { dataset: { diagramKey: '../../secrets' }, ownerDocument: {} };
  const result = await mountDiagram(figure, { documentRef: {}, windowRef: {}, fetchImpl: () => { fetched = true; } });
  assert.equal(result, null);
  assert.equal(fetched, false);
  assert.equal(figure.dataset.diagramState, 'invalid');
});

test('every approved diagram is accessible, self-contained and scoped', () => {
  for (const key of BLOG_DIAGRAMS) {
    const svg = read(`assets/blog/diagrams/${key}.svg`);
    assert.match(svg, /^<svg[^>]+viewBox="0 0 \d+ \d+"/);
    assert.match(svg, /<title id="[a-z]+-title">/);
    assert.match(svg, /<desc id="[a-z]+-desc">[^<]{200,}<\/desc>/);
    assert.match(svg, /@media \(prefers-reduced-motion: reduce\)/);
    assert.doesNotMatch(svg, /<script|<foreignObject|\son[a-z]+=|@import/i);
    assert.doesNotMatch(svg, /href="(?!#)/, 'only same-document references are allowed');
    assert.doesNotMatch(svg, /url\((?!#)/, 'only same-document url() references are allowed');

    // Inline SVG styles apply to the whole page, so every rule must be scoped to the diagram root.
    const scope = svg.match(/<svg[^>]+class="([a-z-]+)"/)[1];
    const css = svg.match(/<style>([\s\S]*?)<\/style>/)[1];
    const selectors = css.replace(/@keyframes[^{]+\{[^{}]*\{[^}]*\}\s*\}/g, '').replace(/@media[^{]+\{/g, '').match(/[^{}]+(?=\{)/g);
    for (const selector of selectors.map(value => value.trim()).filter(Boolean)) {
      for (const part of selector.split(',')) assert.ok(part.trim().startsWith(`.${scope}`), `unscoped selector: ${part.trim()}`);
    }
    const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    assert.ok(ids.every(id => id.startsWith(`${scope.split('-')[0]}-`)), 'ids are prefixed to avoid page collisions');
    assert.equal(new Set(ids).size, ids.length);
  }
});

test('article pages hydrate and dispose diagrams with the other embeds', () => {
  const post = read('js/blog-post.js');
  assert.match(post, /import \{ disposeBlogDiagrams, initBlogDiagrams \} from '\.\/blog-diagram\.js';/);
  assert.match(post, /disposeBlogDiagrams\(content\);/);
  assert.match(post, /initBlogDiagrams\(content\);/);
});
