import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../contact/text-vortex.js', import.meta.url), 'utf8');
const classSource = source.slice(0, source.indexOf('// ========== INITIALIZATION'));
const contactMarkup = readFileSync(new URL('../contact/index.html', import.meta.url), 'utf8');
const contactStyles = readFileSync(new URL('../contact/contact-styles.css', import.meta.url), 'utf8');

test('contact canvas follows the active palette and disconnects its theme observer', () => {
  let rgb = '70, 88, 150';
  let callback;
  let observed;
  let disconnected = false;
  let removedResize = false;
  const root = { removeChild() {} };
  const document = { documentElement: { classList: { contains: () => false } } };
  const sandbox = {
    document,
    window: { removeEventListener(type, handler) { removedResize = type === 'resize' && handler === vortex.resizeHandler; } },
    getComputedStyle: () => ({ getPropertyValue: () => rgb }),
    MutationObserver: class {
      constructor(handler) { callback = handler; }
      observe(target, options) { observed = { target, options }; }
      disconnect() { disconnected = true; }
    },
    console: { log() {} },
  };
  vm.runInNewContext(`${classSource}\nglobalThis.Vortex = TextVortexBackground;`, sandbox);
  const vortex = Object.create(sandbox.Vortex.prototype);
  Object.assign(vortex, { root, ctx: {}, canvas: {}, animationFrameId: null, resizeTimeout: null, resizeHandler() {} });
  vortex.setupThemeObserver();
  assert.equal(vortex.ctx.fillStyle, 'rgb(70,88,150)');
  assert.equal(observed.target, document.documentElement);
  assert.ok(observed.options.attributeFilter.includes('data-theme'));
  rgb = '126, 152, 220';
  callback();
  assert.equal(vortex.ctx.fillStyle, 'rgb(126,152,220)');
  vortex.destroy();
  assert.equal(disconnected, true);
  assert.equal(removedResize, true);
});

test('contact header uses the responsive pixel coding sprite with a finite motion sequence', () => {
  assert.doesNotMatch(contactMarkup, /avatar-circle|avatar-text|>AA</);
  assert.match(contactMarkup, /<svg class="contact-avatar-sprite"[^>]+viewBox="0 0 48 48"/);
  assert.match(contactMarkup, /class="avatar-pixel-monitor-frame"/);
  assert.match(contactMarkup, /class="avatar-pixel-person"/);
  assert.match(contactMarkup, /class="contact-status"/);
  assert.match(contactMarkup, /class="status-dot"/);
  assert.match(contactStyles, /--contact-retro-accent/);
  assert.match(contactStyles, /--contact-avatar-accent: #a87900/);
  assert.match(contactStyles, /--contact-avatar-accent: #f4c152/);
  assert.match(contactStyles, /animation: contact-avatar-type 4s steps\(1, end\) 1 both/);
  assert.match(contactStyles, /animation: contact-avatar-monitor 4s steps\(1, end\) 1 both/);
  assert.match(contactStyles, /\.contact-avatar-sprite \{[\s\S]*?width: 40px/);
  assert.match(contactStyles, /\.contact-avatar-sprite \.avatar-pixel-person,[\s\S]*?animation: none/);
});
