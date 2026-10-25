const SVG_NS = 'http://www.w3.org/2000/svg';
const RADAR_CENTER = 120;
const RADAR_RADIUS = 58;
const LABEL_RADIUS = 80;
const MAX_WEIGHT = 5;

export const SKILL_FOCUS_DATA = Object.freeze([
    Object.freeze({ label: 'Software engineering', weight: 4 }),
    Object.freeze({ label: 'AI/ML', weight: 5 }),
    Object.freeze({ label: 'Systems/cloud', weight: 3 }),
    Object.freeze({ label: 'Cybersecurity', weight: 3 }),
    Object.freeze({ label: 'Robotics', weight: 4 }),
    Object.freeze({ label: 'UI/UX', weight: 3 })
]);

function createSvgElement(ownerDocument, name, attributes = {}) {
    const element = ownerDocument.createElementNS(SVG_NS, name);

    Object.entries(attributes).forEach(([attribute, value]) => {
        element.setAttribute(attribute, String(value));
    });

    return element;
}

function getRadarPoint(index, radius) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / SKILL_FOCUS_DATA.length;

    return {
        x: RADAR_CENTER + Math.cos(angle) * radius,
        y: RADAR_CENTER + Math.sin(angle) * radius
    };
}

function formatPoints(points) {
    return points.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

function getLabelLines(label) {
    if (label.length > 12 && label.includes('/')) return label.split('/');
    if (label.length > 15) return label.split(' ');
    return [label];
}

function formatLabelList(labels) {
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
    return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

function getFocusLevel(weight) {
    if (weight >= MAX_WEIGHT) return 'highest';
    if (weight >= MAX_WEIGHT - 1) return 'high';
    return 'moderate';
}

function getTextEquivalent() {
    const groups = new Map();

    SKILL_FOCUS_DATA.forEach(({ label, weight }) => {
        const level = getFocusLevel(weight);
        const labels = groups.get(level) || [];
        labels.push(label);
        groups.set(level, labels);
    });

    const levels = ['highest', 'high', 'moderate'];
    const descriptions = levels
        .filter((level) => groups.has(level))
        .map((level) => {
            const labels = groups.get(level);
            const verb = labels.length === 1 ? 'is' : 'are';
            return `${formatLabelList(labels)} ${verb} ${level}`;
        });

    return `Current research and project focus: ${descriptions.join('; ')}.`;
}

function clearChildren(element) {
    if (!element) return;

    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
}

function getElement(root, selector) {
    return root?.querySelector?.(selector) ?? null;
}

export function renderSkillFocusRadar(scope = typeof document === 'undefined' ? null : document) {
    const svg = getElement(scope, '[data-skill-focus-radar]');

    if (!svg || svg.getAttribute('data-radar-rendered') === 'true') return false;

    const ownerDocument = svg.ownerDocument || (typeof document === 'undefined' ? null : document);
    if (!ownerDocument) return false;

    const axes = getElement(svg, '[data-radar-axes]');
    const rings = getElement(svg, '[data-radar-rings]');
    const labels = getElement(svg, '[data-radar-labels]');
    const nodes = getElement(svg, '[data-radar-nodes]');
    const area = getElement(svg, '[data-radar-area]');
    const outline = getElement(svg, '[data-radar-outline]');

    if (!axes || !rings || !labels || !nodes || !area || !outline) return false;

    clearChildren(axes);
    clearChildren(rings);
    clearChildren(labels);
    clearChildren(nodes);

    const axisPoints = SKILL_FOCUS_DATA.map((_, index) => getRadarPoint(index, RADAR_RADIUS));

    axisPoints.forEach(({ x, y }) => {
        axes.appendChild(createSvgElement(ownerDocument, 'line', {
            x1: RADAR_CENTER,
            y1: RADAR_CENTER,
            x2: x.toFixed(2),
            y2: y.toFixed(2),
            class: 'skill-focus-radar-axis'
        }));
    });

    [0.34, 0.67, 1].forEach((scale) => {
        rings.appendChild(createSvgElement(ownerDocument, 'polygon', {
            points: formatPoints(SKILL_FOCUS_DATA.map((_, index) => getRadarPoint(index, RADAR_RADIUS * scale))),
            class: 'skill-focus-radar-ring'
        }));
    });

    const weightedPoints = SKILL_FOCUS_DATA.map(({ weight }, index) =>
        getRadarPoint(index, RADAR_RADIUS * Math.max(0, Math.min(weight, MAX_WEIGHT)) / MAX_WEIGHT)
    );
    const weightedPointString = formatPoints(weightedPoints);
    area.setAttribute('points', weightedPointString);
    outline.setAttribute('points', weightedPointString);

    weightedPoints.forEach(({ x, y }, index) => {
        nodes.appendChild(createSvgElement(ownerDocument, 'rect', {
            x: (x - 2.5).toFixed(2),
            y: (y - 2.5).toFixed(2),
            width: 5,
            height: 5,
            class: 'skill-focus-radar-node',
            'data-radar-node': SKILL_FOCUS_DATA[index].label
        }));
    });

    SKILL_FOCUS_DATA.forEach(({ label }, index) => {
        const angle = -Math.PI / 2 + (Math.PI * 2 * index) / SKILL_FOCUS_DATA.length;
        const point = getRadarPoint(index, LABEL_RADIUS);
        const horizontalDirection = Math.cos(angle);
        const x = point.x + (horizontalDirection > 0.25 ? 14 : horizontalDirection < -0.25 ? -14 : 0);
        const lines = getLabelLines(label);
        const text = createSvgElement(ownerDocument, 'text', {
            x: x.toFixed(2),
            y: point.y.toFixed(2),
            class: 'skill-focus-radar-label',
            'data-radar-label': label,
            'text-anchor': 'middle'
        });

        lines.forEach((line, lineIndex) => {
            const tspan = createSvgElement(ownerDocument, 'tspan', {
                x: x.toFixed(2),
                dy: lineIndex === 0 ? `${-((lines.length - 1) * 0.5).toFixed(2)}em` : '1em'
            });
            tspan.textContent = line;
            text.appendChild(tspan);
        });

        labels.appendChild(text);
    });

    const summary = getElement(scope, '[data-skill-focus-summary]');
    if (summary) {
        summary.textContent = getTextEquivalent();
    }

    svg.setAttribute('data-radar-rendered', 'true');
    return true;
}

const skillFocusApi = {
    data: SKILL_FOCUS_DATA,
    render: renderSkillFocusRadar
};

if (typeof window !== 'undefined') {
    window.SkillFocusRadar = skillFocusApi;
}
