import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const playgroundMarkup = readFileSync(new URL('../playground/index.html', import.meta.url), 'utf8');
const playgroundStyles = readFileSync(new URL('../playground/playground-styles.css', import.meta.url), 'utf8');
const blogStyles = readFileSync(new URL('../css/blog-styles.css', import.meta.url), 'utf8');

test('playground title keeps colored letters while every rendered label says PLAYGROUND', () => {
  const title = playgroundMarkup.match(/<span id="playground-navbar-text">([\s\S]*)<\/span>/)?.[1] || '';
  assert.equal(title.match(/data-color=/g)?.length, 10);
  assert.equal(title.match(/>([A-Z])<\/span>/g)?.map((value) => value.slice(1, 2)).join(''), 'PLAYGROUND');
  assert.doesNotMatch(title, /NOTAKU|:/);
  assert.doesNotMatch(playgroundMarkup, /© 2025 Notaku|Follow your Curiosity/);
  assert.match(playgroundMarkup, /<footer class="playground-copyright">[\s\S]*© Akmal Alif[\s\S]*<\/footer>/);
  const footerRule = playgroundStyles.match(/\.playground-copyright\s*\{[^}]*\}/)?.[0] || '';
  assert.doesNotMatch(footerRule, /position:\s*fixed/);
  assert.match(playgroundStyles, /\.playground-content\s*\{[\s\S]*?display:\s*flex/);
  assert.match(footerRule, /margin:\s*auto 0 0/);
});

test('blog archive keeps tactile cards while clearing the outer listing material', () => {
  assert.match(blogStyles, /body\.blog-page:has\(\.blog-listing-card\) \.blog-listing-card\s*\{[\s\S]*?background:\s*transparent !important/);
  assert.match(blogStyles, /body\.blog-page:has\(\.blog-listing-card\) \.blog-listing-card::before,[\s\S]*?display:\s*none/);
  assert.match(blogStyles, /\.blog-card\s*\{[\s\S]*?box-shadow:/);
});
