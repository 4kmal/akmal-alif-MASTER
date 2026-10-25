import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const scriptSource = readFileSync(new URL('../js/script.js', import.meta.url), 'utf8');
const functionStart = scriptSource.indexOf('function initNewDynamicTextAnimation()');
const functionEnd = scriptSource.indexOf('\n// -------- Blog Outline', functionStart);
const animationSource = `${scriptSource.slice(functionStart, functionEnd)}\nglobalThis.initNewDynamicTextAnimation = initNewDynamicTextAnimation;`;

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  toggle(name, force) {
    const shouldAdd = force === undefined ? !this.values.has(name) : force;
    if (shouldAdd) this.values.add(name);
    else this.values.delete(name);
    return shouldAdd;
  }

  contains(name) {
    return this.values.has(name);
  }
}

function createAnimationFixture({ reducedMotion = false, wrapperWidth = 224, widestLabelWidth = 224 } = {}) {
  const items = ['producer', 'ui/ux designer', 'full stack developer', 'data hoarder', '𓅓', '?', ''].map((label) => ({
    textContent: label,
    classList: new FakeClassList(),
    style: {},
    height: 34.56,
    getBoundingClientRect() {
      return { height: this.height, width: 0 };
    },
  }));
  const wrapper = {
    style: {
      setProperty(name, value) {
        this[name] = value;
      },
    },
  };
  const list = {
    children: items,
    classList: new FakeClassList(),
    dataset: {},
    style: {},
  };
  const resizeListeners = [];
  const animationFrames = [];
  const intervals = [];
  const clearedIntervals = [];
  let currentWrapperWidth = wrapperWidth;
  const reducedMotionQuery = {
    matches: reducedMotion,
    addEventListener(type, callback) {
      if (type === 'change') this.changeListener = callback;
    },
  };

  const document = {
    body: {
      appendChild() {},
    },
    fonts: {
      ready: {
        then() {},
      },
    },
    createElement() {
      return {
        style: {},
        textContent: '',
        setAttribute() {},
        getBoundingClientRect() {
          const width = this.textContent === 'full stack developer'
            ? widestLabelWidth
            : this.textContent.length * 10;
          return { width, height: 0 };
        },
        remove() {},
      };
    },
    querySelector(selector) {
      return selector.endsWith('dynamic-text-wrapper') ? wrapper : list;
    },
  };

  const window = {
    matchMedia() {
      return reducedMotionQuery;
    },
    getComputedStyle(element) {
      return {
        fontFamily: 'Arial',
        fontSize: '28.8px',
        fontStyle: 'normal',
        fontVariant: 'normal',
        letterSpacing: 'normal',
        textTransform: 'none',
        lineHeight: '34.56px',
        width: element === wrapper ? `${currentWrapperWidth}px` : '224px',
      };
    },
    requestAnimationFrame(callback) {
      animationFrames.push(callback);
      return animationFrames.length;
    },
    addEventListener(type, callback) {
      if (type === 'resize') resizeListeners.push(callback);
    },
  };

  const sandbox = {
    document,
    window,
    setInterval(callback, delay) {
      intervals.push({ callback, delay });
      return intervals.length;
    },
    clearInterval(id) {
      clearedIntervals.push(id);
    },
    Number,
    parseFloat,
    console,
  };

  vm.runInNewContext(animationSource, sandbox);
  return {
    animate: sandbox.initNewDynamicTextAnimation,
    items,
    list,
    wrapper,
    resizeListeners,
    animationFrames,
    intervals,
    clearedIntervals,
    reducedMotionQuery,
    setWrapperWidth(width) {
      currentWrapperWidth = width;
    },
  };
}

test('dynamic text keeps one interval and recomputes the row height after resize', () => {
  const fixture = createAnimationFixture();

  fixture.animate();
  fixture.animate();

  assert.equal(fixture.intervals.length, 1);
  assert.equal(fixture.intervals[0].delay, 2500);
  assert.equal(fixture.resizeListeners.length, 1);
  assert.equal(parseFloat(fixture.wrapper.style.height), 103.68);
  assert.equal(fixture.wrapper.style['--dynamic-text-slot-width'], '224px');

  fixture.intervals[0].callback();
  assert.equal(fixture.items[1].classList.contains('active-text-item'), true);

  fixture.items[0].height = 40;
  fixture.resizeListeners[0]();
  fixture.animationFrames.at(-1)();
  assert.equal(parseFloat(fixture.wrapper.style.height), 120);
});

test('dynamic text uses a single static label when reduced motion is requested', () => {
  const fixture = createAnimationFixture({ reducedMotion: true });

  fixture.animate();

  assert.equal(fixture.intervals.length, 0);
  assert.equal(fixture.list.classList.contains('is-static'), true);
  assert.equal(fixture.list.style.transition, 'none');
  assert.equal(parseFloat(fixture.wrapper.style.height), 34.56);
  assert.equal(fixture.items[0].classList.contains('active-text-item'), true);
  assert.equal(fixture.items[1].classList.contains('active-text-item'), false);
});

test('dynamic text resyncs its interval, line count, and static state when motion preference changes', () => {
  const fixture = createAnimationFixture();

  fixture.animate();
  fixture.reducedMotionQuery.changeListener({ matches: true });

  assert.deepEqual(fixture.clearedIntervals, [1]);
  assert.equal(fixture.intervals.length, 1);
  assert.equal(fixture.list.classList.contains('is-static'), true);
  assert.equal(fixture.list.style.transition, 'none');
  assert.equal(parseFloat(fixture.wrapper.style.height), 34.56);

  fixture.reducedMotionQuery.changeListener({ matches: false });

  assert.equal(fixture.intervals.length, 2);
  assert.equal(fixture.intervals[1].delay, 2500);
  assert.equal(fixture.list.classList.contains('is-static'), false);
  assert.equal(parseFloat(fixture.wrapper.style.height), 103.68);
  assert.match(fixture.list.style.transition, /^transform 0\.6s/);
});

test('dynamic text reserves only measured label width across breakpoint changes', () => {
  const fixture = createAnimationFixture({ wrapperWidth: 520, widestLabelWidth: 224 });

  fixture.animate();

  assert.equal(fixture.wrapper.style['--dynamic-text-slot-width'], '224px');

  fixture.setWrapperWidth(224);
  fixture.resizeListeners[0]();
  fixture.animationFrames.at(-1)();
  assert.equal(fixture.wrapper.style['--dynamic-text-slot-width'], '224px');
});
