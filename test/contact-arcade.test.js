import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const markup = readFileSync(new URL('../contact/index.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../contact/contact-styles.css', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../contact/arcade/arcade.js', import.meta.url), 'utf8');
const analytics = readFileSync(new URL('../js/analytics.js', import.meta.url), 'utf8');

test('the arcade panel sits beside the chat inside the contact wrapper', () => {
  const wrapper = markup.indexOf('<div class="contact-wrapper">');
  const chatEnd = markup.indexOf('<!-- 3D Arcade');
  const panel = markup.indexOf('<section class="arcade-panel"');
  assert.ok(wrapper > 0 && chatEnd > wrapper && panel > chatEnd);
  assert.match(markup, /data-arcade-stage tabindex="0"/);
  assert.match(markup, /data-arcade-launch/);
  assert.match(markup, /<a class="arcade-fallback__link" href="\/video-games\/exepert\/">/);
  assert.match(markup, /data-arcade-toggle aria-controls="arcadePanel" aria-expanded="false"/);
});

test('the arcade module loads from an absolute path so /contact without a slash still works', () => {
  assert.match(markup, /<script type="module" src="\/contact\/arcade\/arcade\.js"><\/script>/);
});

test('three.js stays out of the first load and only the game page is framed', () => {
  assert.doesNotMatch(bootstrap, /from 'three'/);
  assert.match(bootstrap, /import\('\.\/arcade-scene\.js'\)/);
  assert.match(bootstrap, /const GAME_URL = '\/video-games\/exepert\/'/);
  assert.match(bootstrap, /e\.origin !== location\.origin/);
});

test('arcade clicks are not counted as contact interactions', () => {
  assert.match(analytics, /closestElement\(element, '\.arcade-panel, \.arcade-overlay'\)\) return false/);
});

test('narrow screens turn the arcade into a slide-over and keep motion optional', () => {
  assert.match(styles, /@media \(max-width: 1279px\) \{[\s\S]*?\.arcade-panel \{[\s\S]*?position: fixed/);
  assert.match(styles, /\.contact-wrapper\.arcade-open \.arcade-panel \{\s*transform: none;/);
  assert.match(styles, /html\.arcade-playing \.custom-cursor \{\s*display: none !important;/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{\s*\.arcade-panel,/);
});
