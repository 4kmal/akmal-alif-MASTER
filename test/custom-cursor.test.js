import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/custom-cursor.js', import.meta.url), 'utf8');

class Events {
  listeners = new Map();

  addEventListener(type, callback, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Map());
    this.listeners.get(type).set(callback, options);
  }

  removeEventListener(type, callback) {
    this.listeners.get(type)?.delete(callback);
  }

  emit(type, properties = {}) {
    for (const [callback, options] of [...(this.listeners.get(type) || [])]) {
      if (options?.once) this.removeEventListener(type, callback);
      callback({ type, ...properties });
    }
  }

  count() {
    return [...this.listeners.values()].reduce((total, entries) => total + entries.size, 0);
  }
}

class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.style = {};
    this.children = [];
    this.attributes = {};
    const names = new Set();
    Object.defineProperty(this, 'className', {
      get: () => [...names].join(' '),
      set: (value) => { names.clear(); value.split(/\s+/).filter(Boolean).forEach((name) => names.add(name)); },
    });
    this.classList = {
      add: (...values) => values.forEach((name) => names.add(name)),
      remove: (...values) => values.forEach((name) => names.delete(name)),
      contains: (name) => names.has(name),
      toggle: (name, force = !names.has(name)) => force ? names.add(name) : names.delete(name),
    };
  }

  setAttribute(name, value) { this.attributes[name] = value; }
  appendChild(child) { child.parentNode = this; this.children.push(child); }
  remove() { this.parentNode.children = this.parentNode.children.filter((child) => child !== this); }
  matches(selector) {
    return selector.split(',').some((part) => {
      const value = part.trim();
      if (value === 'dialog[open]') return this.tagName === 'dialog' && 'open' in this.attributes;
      return value.startsWith('.') ? this.classList.contains(value.slice(1)) : value === this.tagName;
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest?.(selector) || null; }
}

function fixture({ reducedMotion = false, touch = false } = {}) {
  const document = new Events();
  Object.assign(document, {
    head: new Element('head'),
    body: new Element('body'),
    documentElement: new Element('html'),
    hidden: false,
    readyState: 'loading',
    createElement: (tag) => new Element(tag),
  });
  const motion = new Events();
  motion.matches = reducedMotion;
  const window = new Events();
  window.matchMedia = () => motion;
  const frames = new Map();
  let nextFrame = 0;
  const context = vm.createContext({
    document,
    window,
    navigator: { maxTouchPoints: touch ? 1 : 0 },
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
    console: { log() {} },
  });
  vm.runInContext(source, context);
  document.emit('DOMContentLoaded');
  document.readyState = 'complete';
  const pointer = (x, y, type = 'pointermove', target = document.body) => {
    document.emit(type, { clientX: x, clientY: y, pointerType: 'mouse', target });
  };
  return {
    document, window, motion, frames, pointer,
    get cursor() { return window.customCursor; },
    runFrame() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    },
    reloadScript() { vm.runInContext(source, context); },
  };
}

const active = (f) => f.document.documentElement.classList.contains('custom-cursor-active');
const coordinates = (f) => [Number.parseFloat(f.cursor.cursorSvg.style.left), Number.parseFloat(f.cursor.cursorSvg.style.top)];

test('startup keeps the native cursor until coordinates arrive, then snaps without a corner frame', () => {
  const f = fixture();
  assert.equal(f.cursor.cursor.classList.contains('hidden'), true);
  assert.equal(active(f), false);
  assert.equal(f.frames.size, 0);
  f.pointer(900, 300);
  assert.deepEqual(coordinates(f), [900, 300]);
  assert.equal(active(f), true);
  assert.equal(f.cursor.cursor.classList.contains('hidden'), false);
  f.pointer(1000, 400);
  assert.equal(f.frames.size, 1);
  f.runFrame();
  assert.ok(coordinates(f)[0] > 900 && coordinates(f)[0] < 1000);
});

test('window re-entry and restored pages wait for fresh coordinates and accept the origin', () => {
  const f = fixture();
  f.pointer(900, 300);
  f.document.emit('pointerleave');
  assert.equal(active(f), false);
  f.pointer(0, 0, 'pointerenter');
  assert.deepEqual(coordinates(f), [0, 0]);
  assert.equal(active(f), true);
  f.window.emit('pagehide');
  f.window.emit('pageshow', { persisted: true });
  assert.equal(active(f), false);
  f.pointer(600, 200);
  assert.deepEqual(coordinates(f), [600, 200]);
});

test('visibility, blur and cursor-type changes cannot reveal stale coordinates', () => {
  const f = fixture();
  f.pointer(400, 200);
  f.document.hidden = true;
  f.document.emit('visibilitychange');
  f.cursor.setCursorType('hand');
  assert.equal(f.cursor.cursor.classList.contains('hidden'), true);
  f.document.hidden = false;
  f.document.emit('visibilitychange');
  assert.equal(active(f), false);
  f.pointer(800, 500);
  assert.deepEqual(coordinates(f), [800, 500]);
  f.window.emit('blur');
  assert.equal(active(f), false);
  f.cursor.setCursorType('pointy');
  assert.equal(f.cursor.cursor.classList.contains('hidden'), true);
});

test('reduced motion tracks directly and a preference change stops queued easing', () => {
  const f = fixture({ reducedMotion: true });
  f.pointer(200, 300);
  f.pointer(800, 600);
  assert.deepEqual(coordinates(f), [800, 600]);
  assert.equal(f.frames.size, 0);
  f.motion.matches = false;
  f.motion.emit('change', { matches: false });
  f.pointer(900, 700);
  assert.equal(f.frames.size, 1);
  f.motion.matches = true;
  f.motion.emit('change', { matches: true });
  assert.equal(f.frames.size, 0);
  assert.deepEqual(coordinates(f), [900, 700]);
});

test('nested links preserve the hand sprite and duplicate initialization creates one cursor', () => {
  const f = fixture();
  const link = new Element('a');
  const icon = new Element('svg');
  link.appendChild(icon);
  f.pointer(400, 200, 'pointermove', icon);
  assert.equal(f.cursor.currentCursor, 'hand');
  const cursor = f.cursor;
  cursor.init();
  new f.window.CustomCursor();
  f.reloadScript();
  assert.equal(f.cursor, cursor);
  assert.equal(f.document.body.children.length, 1);
  assert.equal(f.document.head.children.length, 1);
});

test('destroy restores the native cursor and removes listeners, styles and frames', () => {
  const f = fixture();
  f.pointer(200, 100);
  f.pointer(900, 500);
  f.cursor.destroy();
  assert.equal(active(f), false);
  assert.equal(f.frames.size, 0);
  assert.equal(f.document.body.children.length, 0);
  assert.equal(f.document.head.children.length, 0);
  assert.equal(f.document.count() + f.window.count() + f.motion.count(), 0);
  assert.equal(f.window.customCursor, null);
  const replacement = new f.window.CustomCursor();
  assert.equal(replacement.isInitialized, true);
  assert.equal(active(f), false);
});

test('touch devices keep native behavior without cursor styles or listeners', () => {
  const f = fixture({ touch: true });
  assert.equal(active(f), false);
  assert.equal(f.document.body.children.length, 0);
  assert.equal(f.document.head.children.length, 0);
  assert.equal(f.document.count() + f.window.count() + f.motion.count(), 0);
});

test('switching from a mouse to touch hides the cursor until fresh mouse coordinates arrive', () => {
  const f = fixture();
  f.pointer(300, 200);
  f.pointer(800, 400);
  f.document.emit('pointermove', { pointerType: 'touch', clientX: 100, clientY: 100 });
  assert.equal(active(f), false);
  assert.equal(f.frames.size, 0);
  f.pointer(900, 500);
  assert.deepEqual(coordinates(f), [900, 500]);
  f.document.emit('pointerdown', { pointerType: 'touch' });
  assert.equal(active(f), false);
});

test('native dialogs keep a native cursor above the document layer', () => {
  const f = fixture();
  f.pointer(300, 200);
  const dialog = new Element('dialog');
  dialog.setAttribute('open', '');
  const close = new Element('button');
  dialog.appendChild(close);
  f.pointer(900, 500, 'pointermove', close);
  assert.equal(active(f), false);
  f.pointer(400, 200);
  assert.deepEqual(coordinates(f), [400, 200]);
});
