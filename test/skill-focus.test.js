import assert from 'node:assert/strict';
import test from 'node:test';
import { renderSkillFocusRadar, SKILL_FOCUS_DATA } from '../js/skill-focus.js';

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
  assert.match(scope.querySelector('[data-skill-focus-summary]').textContent, /Software engineering/);
  assert.match(scope.querySelector('[data-skill-focus-summary]').textContent, /UI\/UX/);

  assert.equal(renderSkillFocusRadar(scope), false);
  assert.equal(svg.querySelector('[data-radar-labels]').children.length, 6);
});
