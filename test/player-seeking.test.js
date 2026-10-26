import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/modules/playerIntegration.js', import.meta.url), 'utf8');
const start = source.indexOf('    setupWaveformInteraction() {');
const end = source.indexOf('    setupMinimizeButton()', start);
const method = source.slice(start, end);

function fixture() {
  const listeners = new Map();
  const range = { value: '0', addEventListener(type, fn) { listeners.set(`range:${type}`, fn); } };
  const waveform = {
    addEventListener(type, fn) { listeners.set(`waveform:${type}`, fn); },
    getBoundingClientRect: () => ({ left: 50, width: 400 }),
  };
  const seek = [];
  const painted = [];
  const sandbox = {
    document: {
      getElementById: (id) => id === 'progressBar' ? range : waveform,
      addEventListener() {},
    },
  };
  vm.runInNewContext(`class Integration { ${method} } globalThis.Integration = Integration;`, sandbox);
  const integration = new sandbox.Integration();
  integration.player = { seek: (value) => seek.push(value) };
  integration.updateProgressBar = (value) => painted.push(value);
  integration.setupWaveformInteraction();
  return { range, listeners, seek, painted };
}

test('native range input and change seek without a mouse scrubbing flag', () => {
  const f = fixture();
  f.range.value = '50';
  f.listeners.get('range:input')({ target: f.range });
  f.range.value = '0';
  f.listeners.get('range:change')({ target: f.range });
  assert.deepEqual(f.seek, [50, 0]);
  assert.deepEqual(f.painted, [50, 0]);
});

test('range clicks do not trigger a second waveform seek, while waveform clicks still work', () => {
  const f = fixture();
  f.listeners.get('waveform:click')({ target: f.range, clientX: 0 });
  assert.deepEqual(f.seek, []);
  f.listeners.get('waveform:click')({ target: {}, clientX: 150 });
  assert.deepEqual(f.seek, [25]);
  assert.deepEqual(f.painted, [25]);
});
