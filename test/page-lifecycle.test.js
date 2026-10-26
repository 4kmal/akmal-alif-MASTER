import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const vortexSource = readFileSync(new URL('../contact/text-vortex.js', import.meta.url), 'utf8');
const vortexStart = vortexSource.indexOf('class TextVortexBackground');
const vortexEnd = vortexSource.indexOf('\n// ========== INITIALIZATION', vortexStart);
const vortexClassSource = `${vortexSource.slice(vortexStart, vortexEnd)}\nglobalThis.TextVortexBackground = TextVortexBackground;`;

const playgroundSource = readFileSync(new URL('../playground/playground-main.js', import.meta.url), 'utf8');
const playgroundStart = playgroundSource.indexOf('class Creative3DPlaygroundController');
const playgroundEnd = playgroundSource.indexOf('\n// ========== INITIALIZATION', playgroundStart);
const playgroundClassSource = `${playgroundSource.slice(playgroundStart, playgroundEnd)}\nglobalThis.Creative3DPlaygroundController = Creative3DPlaygroundController;`;

function createVortexFixture() {
  let themeColor = '70, 88, 150';
  let frameId = 0;
  let timeoutId = 0;
  let canvas;
  const frameCallbacks = new Map();
  const cancelledFrames = [];
  const clearedTimeouts = [];
  const resizeListeners = new Set();
  const removedResizeListeners = [];
  const context = {
    fillTextCalls: 0,
    fillStyle: '',
    scale() {},
    save() {},
    restore() {},
    clearRect() {},
    fillText() {
      this.fillTextCalls += 1;
    },
  };

  const root = {
    innerHTML: '',
    children: [],
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
    },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parentNode = null;
    },
    getBoundingClientRect() {
      return { width: 1200, height: 800 };
    },
  };

  const mutationObserver = {
    callback: null,
    disconnected: false,
    observe(_target, options) {
      this.options = options;
    },
    disconnect() {
      this.disconnected = true;
    },
  };

  const document = {
    documentElement: {
      clientWidth: 1200,
      clientHeight: 800,
      classList: { contains: (name) => name === 'dark' && themeColor.startsWith('126') },
    },
    querySelector(selector) {
      return selector === '#text-grid' ? root : null;
    },
    createElement(type) {
      assert.equal(type, 'canvas');
      canvas = {
        style: {},
        parentNode: null,
        getContext() {
          return context;
        },
      };
      return canvas;
    },
  };

  const window = {
    devicePixelRatio: 1,
    innerWidth: 1200,
    innerHeight: 800,
    requestAnimationFrame(callback) {
      const id = ++frameId;
      frameCallbacks.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      cancelledFrames.push(id);
      frameCallbacks.delete(id);
    },
    addEventListener(type, callback) {
      if (type === 'resize') resizeListeners.add(callback);
    },
    removeEventListener(type, callback) {
      if (type === 'resize') {
        resizeListeners.delete(callback);
        removedResizeListeners.push(callback);
      }
    },
  };

  const sandbox = {
    document,
    window,
    MutationObserver: class {
      constructor(callback) {
        mutationObserver.callback = callback;
      }

      observe(...args) {
        mutationObserver.observe(...args);
      }

      disconnect() {
        mutationObserver.disconnect();
      }
    },
    getComputedStyle() {
      return {
        getPropertyValue() {
          return themeColor;
        },
      };
    },
    setTimeout(callback, delay) {
      const id = ++timeoutId;
      frameCallbacks.set(`timeout-${id}`, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      clearedTimeouts.push(id);
      frameCallbacks.delete(`timeout-${id}`);
    },
    Number,
    Math,
    console: { log() {}, warn() {}, error() {} },
  };

  vm.runInNewContext(vortexClassSource, sandbox);
  const vortex = new sandbox.TextVortexBackground();

  return {
    vortex,
    canvas,
    context,
    root,
    window,
    mutationObserver,
    frameCallbacks,
    cancelledFrames,
    clearedTimeouts,
    resizeListeners,
    removedResizeListeners,
    setThemeColor(value) {
      themeColor = value;
    },
  };
}

test('text vortex starts on a numeric RAF timestamp and owns one cancellable loop', () => {
  const fixture = createVortexFixture();
  const firstFrameId = fixture.vortex.animationFrameId;
  const firstCallback = fixture.frameCallbacks.get(firstFrameId);

  assert.equal(typeof firstCallback, 'function');
  firstCallback(16);

  const secondFrameId = fixture.vortex.animationFrameId;
  fixture.frameCallbacks.get(secondFrameId)(34);
  assert.equal(Number.isFinite(fixture.vortex.animationBegin), true);
  assert.ok(fixture.context.fillTextCalls > 0);
  assert.notEqual(fixture.vortex.animationFrameId, null);

  const scheduledFrameId = fixture.vortex.animationFrameId;
  fixture.vortex.pause();
  assert.equal(fixture.vortex.animationFrameId, null);
  assert.ok(fixture.cancelledFrames.includes(scheduledFrameId));

  fixture.vortex.resume();
  assert.notEqual(fixture.vortex.animationFrameId, null);
  fixture.vortex.handleResize();
  fixture.vortex.destroy();
  fixture.vortex.destroy();

  assert.equal(fixture.vortex.animationFrameId, null);
  assert.ok(fixture.cancelledFrames.length >= 2);
  assert.equal(fixture.clearedTimeouts.length, 1);
  assert.equal(fixture.resizeListeners.size, 0);
  assert.equal(fixture.removedResizeListeners.length, 1);
  assert.equal(fixture.mutationObserver.disconnected, true);
  assert.equal(fixture.root.children.length, 0);
});

test('text vortex updates its live palette and ignores callbacks after destroy', () => {
  const fixture = createVortexFixture();
  const activeFrameId = fixture.vortex.animationFrameId;
  const activeCallback = fixture.frameCallbacks.get(activeFrameId);

  fixture.setThemeColor('126, 152, 220');
  fixture.mutationObserver.callback();
  assert.equal(fixture.context.fillStyle, 'rgb(126,152,220)');

  fixture.vortex.destroy();
  const frameCountBeforeCallback = fixture.context.fillTextCalls;
  activeCallback(100);
  assert.equal(fixture.context.fillTextCalls, frameCountBeforeCallback);
  assert.equal(fixture.vortex.animationFrameId, null);
});

function createModalFixture() {
  const listeners = new Map();
  const body = { children: [], isConnected: true };
  let cursorHideCalls = 0;
  const document = {
    body,
    activeElement: null,
    createElement(type) {
      const element = {
        type,
        children: [],
        attributes: {},
        listeners: new Map(),
        style: {},
        isConnected: false,
        parentNode: null,
        open: false,
        focus() {
          document.activeElement = this;
        },
        setAttribute(name, value) {
          this.attributes[name] = String(value);
        },
        appendChild(child) {
          child.parentNode = this;
          child.isConnected = this.isConnected;
          this.children.push(child);
        },
        addEventListener(name, callback) {
          this.listeners.set(name, callback);
        },
        removeEventListener(name, callback) {
          if (this.listeners.get(name) === callback) this.listeners.delete(name);
        },
        remove() {
          if (!this.isConnected) return;
          this.open = false;
          this.isConnected = false;
          if (this.parentNode?.children) {
            this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
          }
          this.parentNode = null;
          this.children.forEach((child) => {
            child.isConnected = false;
            child.parentNode = null;
          });
        },
        showModal() {
          this.open = true;
        },
        close() {
          this.open = false;
        },
        pause() {},
      };
      return element;
    },
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    removeEventListener(name, callback) {
      if (listeners.get(name) === callback) listeners.delete(name);
    },
  };

  body.appendChild = (child) => {
    child.parentNode = body;
    child.isConnected = true;
    child.children.forEach((grandchild) => {
      grandchild.parentNode = child;
      grandchild.isConnected = true;
    });
    body.children.push(child);
  };

  const sandbox = {
    document,
    window: {
      customCursor: {
        hideCursor() {
          cursorHideCalls += 1;
        },
      },
    },
    console: { log() {}, warn() {}, error() {} },
  };
  vm.runInNewContext(playgroundClassSource, sandbox);
  return {
    document,
    body,
    listeners,
    Controller: sandbox.Creative3DPlaygroundController,
    get cursorHideCalls() {
      return cursorHideCalls;
    },
  };
}

test('video modal uses native dialog lifecycle and restores focus on close', () => {
  const fixture = createModalFixture();
  const controller = Object.create(fixture.Controller.prototype);
  let launchFocusCalls = 0;
  const launchButton = {
    focus() {
      launchFocusCalls += 1;
      fixture.document.activeElement = this;
    },
  };
  controller.launchButton = launchButton;

  controller.openVideoModal({ title: 'Demo Reel', link: '/demo.mp4' });
  const modal = fixture.body.children[0];
  const video = modal.children[0];
  const closeButton = modal.children[1];

  assert.equal(modal.type, 'dialog');
  assert.equal(modal.open, true);
  assert.equal(modal.attributes.role, 'dialog');
  assert.equal(modal.attributes['aria-modal'], 'true');
  assert.equal(modal.attributes['aria-label'], 'Video: Demo Reel');
  assert.equal(closeButton.type, 'button');
  assert.equal(closeButton.attributes['aria-label'], 'Close video');
  assert.equal(fixture.document.activeElement, closeButton);
  assert.equal(fixture.cursorHideCalls, 1);
  assert.equal(modal.listeners.has('keydown'), false);

  const pauseCalls = [];
  video.pause = () => pauseCalls.push(true);
  let prevented = false;
  modal.listeners.get('cancel')({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(modal.open, false);
  assert.equal(modal.isConnected, false);
  assert.equal(pauseCalls.length, 1);
  assert.equal(launchFocusCalls, 1);

  closeButton.listeners.get('click')?.();
  assert.equal(pauseCalls.length, 1);

  controller.openVideoModal({ title: 'Second', link: '/second.mp4' });
  const secondModal = fixture.body.children[0];
  const secondVideo = secondModal.children[0];
  secondVideo.pause = () => pauseCalls.push(true);
  secondModal.listeners.get('click')({ target: secondModal });
  assert.equal(secondModal.open, false);
  assert.equal(secondModal.isConnected, false);
  assert.equal(pauseCalls.length, 2);
  assert.equal(launchFocusCalls, 2);
});
