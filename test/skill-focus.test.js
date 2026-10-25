import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderSkillFocusRadar, SKILL_FOCUS_DATA } from '../js/skill-focus.js';

const clockPartial = readFileSync(new URL('../partials/bento/bento-clock.html', import.meta.url), 'utf8');

class FakeNode {
  constructor(name, ownerDocument = null) {
    this.name = name;
    this.ownerDocument = ownerDocument;
    this.attributes = new Map();
    this.children = [];
    this.textContent = '';
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((entry) => entry !== child);
    return child;
  }

  get firstChild() {
    return this.children[0] ?? null;
  }

  matches(selector) {
    const attribute = selector.match(/^\[([^\]]+)\]$/)?.[1];
    return attribute ? this.attributes.has(attribute) : false;
  }

  querySelector(selector) {
    if (this.matches(selector)) return this;

    for (const child of this.children) {
      const match = child.querySelector(selector);
      if (match) return match;
    }

    return null;
  }
}

class FakeDocument {
  createElementNS(_namespace, name) {
    return new FakeNode(name, this);
  }
}

function makeRadarScope() {
  const document = new FakeDocument();
  const scope = new FakeNode('div', document);
  const header = new FakeNode('div', document);
  const svg = new FakeNode('svg', document);
  const groups = [
    ['data-skill-focus-radar', svg],
    ['data-radar-axes', svg],
    ['data-radar-rings', svg],
    ['data-radar-area', svg],
    ['data-radar-outline', svg],
    ['data-radar-nodes', svg],
    ['data-radar-labels', svg],
    ['data-skill-focus-summary', header]
  ];

  groups.forEach(([attribute, parent]) => {
    const node = attribute === 'data-skill-focus-radar'
      ? parent
      : new FakeNode(attribute.replace('data-', ''), document);
    if (node !== parent) parent.appendChild(node);
    node.setAttribute(attribute, '');
  });

  header.appendChild(svg);
  scope.appendChild(header);
  return { scope, svg, header };
}

test('renders the weighted focus radar once and exposes its text equivalent', () => {
  const { scope, svg } = makeRadarScope();

  assert.deepEqual(
    SKILL_FOCUS_DATA.map(({ label, weight }) => [label, weight]),
    [
      ['Software engineering', 4],
      ['AI/ML', 5],
      ['Systems/cloud', 3],
      ['Cybersecurity', 3],
      ['Robotics', 4],
      ['UI/UX', 3]
    ]
  );
  assert.equal(renderSkillFocusRadar(scope), true);
  assert.equal(svg.getAttribute('data-radar-rendered'), 'true');
  assert.equal(svg.querySelector('[data-radar-axes]').children.length, 6);
  assert.equal(svg.querySelector('[data-radar-rings]').children.length, 3);
  assert.equal(svg.querySelector('[data-radar-labels]').children.length, 6);
  assert.equal(svg.querySelector('[data-radar-nodes]').children.length, 6);
  const labelNodes = svg.querySelector('[data-radar-labels]').children;
  assert.ok([...labelNodes].every((node) => node.getAttribute('text-anchor') === 'middle'));
  assert.ok([...labelNodes].every((node) => Number(node.getAttribute('x')) > 0 && Number(node.getAttribute('x')) < 240));
  assert.match(clockPartial, /<polygon class="skill-focus-radar-area" data-radar-area/);
  assert.match(clockPartial, /<polygon class="skill-focus-radar-outline" data-radar-outline/);
  assert.match(clockPartial, /aria-labelledby="skill-focus-radar-title"/);
  assert.match(clockPartial, /aria-describedby="skill-focus-radar-description skill-focus-radar-summary"/);
  assert.match(clockPartial, /id="skill-focus-radar-summary" data-skill-focus-summary/);
  assert.equal(
    scope.querySelector('[data-skill-focus-summary]').textContent,
    'Current research and project focus: AI/ML is highest; Software engineering and Robotics are high; Systems/cloud, Cybersecurity, and UI/UX are moderate.'
  );

  assert.equal(renderSkillFocusRadar(scope), false);
  assert.equal(svg.querySelector('[data-radar-labels]').children.length, 6);
});
