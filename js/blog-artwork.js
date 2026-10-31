export const LEGACY_BLOG_THUMBNAIL = '/blog/blogpic/pic3.jpg';
export const BLOG_ARTWORK_PLAYBACK_BUDGET_MS = 4000;

const LEGACY_BLOG_THUMBNAIL_PATH = LEGACY_BLOG_THUMBNAIL;
const CANONICAL_BLOG_HOSTNAMES = new Set(['akmalalif.com', 'www.akmalalif.com']);
const BLOG_ARTWORK_BY_SLUG = Object.freeze({
  'versatility-humanoid-robots': 'robot-workstation',
  'hexapod-robots-military': 'hexapod',
  'work-life-balance-burnout': 'burnout-desk',
  'tuju-local-builders-open-map-data': 'civic-map',
  'internet-jenga-tower-php2shell': 'security-jenga',
  'mods-worlds-remember-enrage-nightcoop': 'persistent-world',
  'dream-1-zero-shot-robotics': 'bimanual-robot',
  'dumb-money-gamestop-shared-story': 'shared-story',
  'publictransport-my-live-data-deep-dive': 'live-bus-map',
  'wonders-of-creation-al-qazwini': 'wonders-manuscript',
});

const BLOG_ARTWORK_SLUG_BY_NAME = Object.freeze(
  Object.fromEntries(Object.entries(BLOG_ARTWORK_BY_SLUG).map(([slug, artwork]) => [artwork, slug])),
);

const playbackBudgets = new Map();

const BLOG_ARTWORK_SVGS = Object.freeze({
  'live-bus-map': `
    <svg class="blog-card-sprite blog-card-sprite--live-bus-map" data-blog-artwork="live-bus-map" data-artwork-motion-state="paused" viewBox="0 0 320 180" role="presentation" aria-hidden="true" focusable="false">
      <rect class="blog-artwork-bg" width="320" height="180" />
      <rect class="blog-artwork-shadow" x="24" y="140" width="272" height="4" />
      <rect class="blog-artwork-deep" x="48" y="28" width="224" height="106" />
      <path class="blog-artwork-line" d="M48 72h224v5H48zM120 28h5v106h-5zM206 28h5v106h-5z" />
      <path class="blog-artwork-mid" d="M62 112h46v8H62zM100 86h8v34h-8zM100 86h58v8h-58zM150 60h8v34h-8zM150 60h62v8h-62zM204 42h8v26h-8zM204 42h48v8h-48z" />
      <rect class="blog-artwork-accent" x="56" y="108" width="12" height="12" />
      <rect class="blog-artwork-accent" x="246" y="38" width="12" height="12" />
      <rect class="blog-artwork-surface" x="138" y="54" width="32" height="18" />
      <rect class="blog-artwork-deep" x="142" y="58" width="24" height="5" />
      <rect class="blog-artwork-deep" x="142" y="70" width="6" height="5" /><rect class="blog-artwork-deep" x="160" y="70" width="6" height="5" />
      <g class="blog-artwork-motion blog-artwork-motion--map" data-blog-artwork-motion>
        <rect class="blog-artwork-accent" x="149" y="40" width="10" height="8" />
      </g>
    </svg>`,
  'wonders-manuscript': `
    <svg class="blog-card-sprite blog-card-sprite--wonders-manuscript" data-blog-artwork="wonders-manuscript" data-artwork-motion-state="paused" viewBox="0 0 320 180" role="presentation" aria-hidden="true" focusable="false">
      <rect class="blog-artwork-bg" width="320" height="180" />
      <rect class="blog-artwork-shadow" x="40" y="141" width="240" height="4" />
      <rect class="blog-artwork-deep" x="62" y="128" width="196" height="10" />
      <rect class="blog-artwork-mid" x="70" y="92" width="86" height="38" />
      <rect class="blog-artwork-mid" x="164" y="92" width="86" height="38" />
      <rect class="blog-artwork-deep" x="156" y="88" width="8" height="46" />
      <path class="blog-artwork-line" d="M80 102h60v4H80zM80 112h46v4H80zM174 102h60v4h-60zM174 112h52v4h-52z" />
      <path class="blog-artwork-deep" d="M146 22h28v6h8v6h6v20h-6v6h-8v6h-28v-6h-8v-6h-6V34h6v-6h8z" />
      <path class="blog-artwork-line" d="M124 42h72v4h-72z" />
      <rect class="blog-artwork-accent" x="154" y="38" width="12" height="12" />
      <path class="blog-artwork-mid" d="M66 46h12v6h10v6h12v6H88v6H76v-6h-6v-6h-4z" />
      <rect class="blog-artwork-accent" x="226" y="40" width="6" height="6" /><rect class="blog-artwork-accent" x="246" y="58" width="6" height="6" />
      <g class="blog-artwork-motion blog-artwork-motion--world" data-blog-artwork-motion>
        <rect class="blog-artwork-accent" x="234" y="22" width="8" height="8" />
      </g>
    </svg>`,
  'robot-workstation': `
    <svg class="blog-card-sprite blog-card-sprite--robot-workstation" data-blog-artwork="robot-workstation" data-artwork-motion-state="paused" viewBox="0 0 320 180" role="presentation" aria-hidden="true" focusable="false">
      <rect class="blog-artwork-bg" width="320" height="180" />
      <rect class="blog-artwork-shadow" x="26" y="137" width="268" height="5" />
      <rect class="blog-artwork-surface" x="50" y="128" width="220" height="9" />
      <rect class="blog-artwork-deep" x="86" y="54" width="70" height="59" />
      <rect class="blog-artwork-bg" x="94" y="62" width="54" height="37" />
      <rect class="blog-artwork-line" x="101" y="70" width="40" height="3" />
      <rect class="blog-artwork-line" x="105" y="80" width="21" height="7" />
      <rect class="blog-artwork-line" x="130" y="80" width="11" height="7" />
      <rect class="blog-artwork-deep" x="112" y="113" width="18" height="15" />
      <g class="blog-artwork-robot">
        <rect class="blog-artwork-mid" x="170" y="90" width="28" height="30" />
        <rect class="blog-artwork-deep" x="176" y="77" width="16" height="13" />
        <rect class="blog-artwork-accent" x="180" y="81" width="3" height="3" />
        <rect class="blog-artwork-accent" x="187" y="81" width="3" height="3" />
        <rect class="blog-artwork-deep" x="168" y="118" width="8" height="17" />
        <rect class="blog-artwork-deep" x="192" y="118" width="8" height="17" />
        <rect class="blog-artwork-mid" x="163" y="94" width="7" height="18" />
        <rect class="blog-artwork-mid" x="198" y="94" width="7" height="18" />
      </g>
      <g class="blog-artwork-motion blog-artwork-motion--blink" data-blog-artwork-motion>
        <rect class="blog-artwork-accent" x="104" y="80" width="21" height="7" />
      </g>
    </svg>`,
  hexapod: `
    <svg class="blog-card-sprite blog-card-sprite--hexapod" data-blog-artwork="hexapod" data-artwork-motion-state="paused" viewBox="0 0 320 180" role="presentation" aria-hidden="true" focusable="false">
      <rect class="blog-artwork-bg" width="320" height="180" />
      <rect class="blog-artwork-shadow" x="28" y="139" width="264" height="4" />
      <rect class="blog-artwork-line" x="56" y="124" width="208" height="5" />
      <g class="blog-artwork-hexapod">
        <rect class="blog-artwork-deep" x="104" y="74" width="112" height="43" />
        <rect class="blog-artwork-mid" x="117" y="63" width="84" height="17" />
        <rect class="blog-artwork-accent" x="135" y="68" width="16" height="5" />
        <rect class="blog-artwork-line" x="157" y="68" width="28" height="5" />
        <rect class="blog-artwork-mid" x="97" y="84" width="9" height="22" />
        <rect class="blog-artwork-mid" x="214" y="84" width="9" height="22" />
        <rect class="blog-artwork-deep" x="119" y="113" width="10" height="22" />
        <rect class="blog-artwork-deep" x="149" y="113" width="10" height="22" />
        <rect class="blog-artwork-deep" x="180" y="113" width="10" height="22" />
        <rect class="blog-artwork-deep" x="208" y="113" width="10" height="22" />
      </g>
      <g class="blog-artwork-motion blog-artwork-motion--leg" data-blog-artwork-motion>
        <rect class="blog-artwork-deep" x="106" y="113" width="10" height="22" />
        <rect class="blog-artwork-deep" x="194" y="113" width="10" height="22" />
      </g>
    </svg>`,
  'burnout-desk': `
    <svg class="blog-card-sprite blog-card-sprite--burnout-desk" data-blog-artwork="burnout-desk" data-artwork-motion-state="paused" viewBox="0 0 320 180" role="presentation" aria-hidden="true" focusable="false">
      <rect class="blog-artwork-bg" width="320" height="180" />
      <rect class="blog-artwork-shadow" x="26" y="138" width="268" height="5" />
      <rect class="blog-artwork-surface" x="46" y="126" width="228" height="10" />
      <rect class="blog-artwork-deep" x="82" y="58" width="84" height="57" />
      <rect class="blog-artwork-bg" x="92" y="68" width="64" height="34" />
      <rect class="blog-artwork-line" x="101" y="77" width="45" height="4" />
      <rect class="blog-artwork-line" x="101" y="86" width="30" height="4" />
      <rect class="blog-artwork-accent" x="101" y="95" width="14" height="4" />
      <rect class="blog-artwork-mid" x="117" y="95" width="25" height="4" />
      <rect class="blog-artwork-deep" x="115" y="115" width="18" height="11" />
      <rect class="blog-artwork-mid" x="219" y="111" width="24" height="17" />
      <rect class="blog-artwork-deep" x="224" y="106" width="14" height="8" />
      <g class="blog-artwork-motion blog-artwork-motion--steam" data-blog-artwork-motion>
        <rect class="blog-artwork-line" x="225" y="94" width="4" height="10" />
        <rect class="blog-artwork-line" x="235" y="88" width="4" height="16" />
      </g>
    </svg>`,
  'civic-map': `
    <svg class="blog-card-sprite blog-card-sprite--civic-map" data-blog-artwork="civic-map" data-artwork-motion-state="paused" viewBox="0 0 320 180" role="presentation" aria-hidden="true" focusable="false">
      <rect class="blog-artwork-bg" width="320" height="180" />
      <rect class="blog-artwork-shadow" x="24" y="140" width="272" height="4" />
      <rect class="blog-artwork-deep" x="58" y="34" width="204" height="98" />
      <path class="blog-artwork-line" d="M70 55h178v12H70zM70 76h178v8H70zM70 94h114v8H70zM70 112h82v8H70z" />
      <path class="blog-artwork-mid" d="M84 48 116 34l25 18 37-8 28 19 35-13 22 20v47l-44 7-34-18-36 15-38-20-27 15Z" />
      <rect class="blog-artwork-accent" x="103" y="67" width="10" height="10" />
      <rect class="blog-artwork-accent" x="186" y="83" width="10" height="10" />
      <rect class="blog-artwork-accent" x="218" y="105" width="10" height="10" />
      <g class="blog-artwork-motion blog-artwork-motion--map" data-blog-artwork-motion>
        <rect class="blog-artwork-accent" x="154" y="46" width="12" height="12" />
      </g>
    </svg>`,
  'security-jenga': `
    <svg class="blog-card-sprite blog-card-sprite--security-jenga" data-blog-artwork="security-jenga" data-artwork-motion-state="paused" viewBox="0 0 320 180" role="presentation" aria-hidden="true" focusable="false">
      <rect class="blog-artwork-bg" width="320" height="180" />
      <rect class="blog-artwork-shadow" x="52" y="140" width="214" height="4" />
      <g class="blog-artwork-deep">
        <rect x="108" y="122" width="102" height="13" /><rect x="108" y="103" width="102" height="13" />
        <rect x="108" y="84" width="102" height="13" /><rect x="108" y="65" width="102" height="13" />
      </g>
      <g class="blog-artwork-mid">
        <rect x="122" y="46" width="74" height="13" /><rect x="122" y="27" width="74" height="13" />
      </g>
      <path class="blog-artwork-line" d="M116 128h24m12 0h20m12 0h20M116 109h22m16 0h30m12 0h14M116 90h40m14 0h28M116 71h24m14 0h38" />
      <g class="blog-artwork-motion blog-artwork-motion--jenga" data-blog-artwork-motion>
        <rect class="blog-artwork-accent" x="206" y="84" width="14" height="13" />
      </g>
    </svg>`,
  'persistent-world': `
    <svg class="blog-card-sprite blog-card-sprite--persistent-world" data-blog-artwork="persistent-world" data-artwork-motion-state="paused" viewBox="0 0 320 180" role="presentation" aria-hidden="true" focusable="false">
      <rect class="blog-artwork-bg" width="320" height="180" />
      <rect class="blog-artwork-shadow" x="26" y="139" width="268" height="5" />
      <rect class="blog-artwork-deep" x="54" y="49" width="212" height="84" />
      <rect class="blog-artwork-mid" x="68" y="63" width="184" height="56" />
      <path class="blog-artwork-line" d="M68 78h184M68 95h184M98 63v56M132 63v56M166 63v56M200 63v56M234 63v56" />
      <rect class="blog-artwork-accent" x="106" y="77" width="16" height="16" />
      <rect class="blog-artwork-accent" x="174" y="95" width="16" height="16" />
      <g class="blog-artwork-motion blog-artwork-motion--world" data-blog-artwork-motion>
        <rect class="blog-artwork-accent" x="208" y="77" width="16" height="16" />
      </g>
    </svg>`,
  'bimanual-robot': `
    <svg class="blog-card-sprite blog-card-sprite--bimanual-robot" data-blog-artwork="bimanual-robot" data-artwork-motion-state="paused" viewBox="0 0 320 180" role="presentation" aria-hidden="true" focusable="false">
      <rect class="blog-artwork-bg" width="320" height="180" />
      <rect class="blog-artwork-shadow" x="35" y="140" width="250" height="4" />
      <rect class="blog-artwork-surface" x="74" y="128" width="172" height="10" />
      <rect class="blog-artwork-deep" x="126" y="69" width="68" height="58" />
      <rect class="blog-artwork-mid" x="139" y="53" width="42" height="18" />
      <rect class="blog-artwork-accent" x="147" y="59" width="8" height="6" /><rect class="blog-artwork-accent" x="166" y="59" width="8" height="6" />
      <path class="blog-artwork-deep" d="M126 78 96 88 80 112 93 117 112 101 126 96ZM194 78l30 10 16 24-13 5-19-16-14-5Z" />
      <path class="blog-artwork-mid" d="M84 112h20v18H84zM216 112h20v18h-20z" />
      <g class="blog-artwork-motion blog-artwork-motion--arms" data-blog-artwork-motion>
        <rect class="blog-artwork-accent" x="74" y="107" width="12" height="9" /><rect class="blog-artwork-accent" x="234" y="107" width="12" height="9" />
      </g>
    </svg>`,
  'shared-story': `
    <svg class="blog-card-sprite blog-card-sprite--shared-story" data-blog-artwork="shared-story" data-artwork-motion-state="paused" viewBox="0 0 320 180" role="presentation" aria-hidden="true" focusable="false">
      <rect class="blog-artwork-bg" width="320" height="180" />
      <rect class="blog-artwork-shadow" x="24" y="139" width="272" height="5" />
      <rect class="blog-artwork-deep" x="48" y="50" width="224" height="80" />
      <rect class="blog-artwork-mid" x="65" y="66" width="64" height="48" />
      <rect class="blog-artwork-mid" x="191" y="66" width="64" height="48" />
      <path class="blog-artwork-line" d="M76 78h42v5H76zM76 91h30v5H76zM202 78h42v5h-42zM202 91h30v5h-30z" />
      <path class="blog-artwork-accent" d="m129 78 22 9-22 9v-7h-17v-4h17zM191 78l-22 9 22 9v-7h17v-4h-17z" />
      <g class="blog-artwork-motion blog-artwork-motion--story" data-blog-artwork-motion>
        <rect class="blog-artwork-accent" x="143" y="107" width="34" height="7" />
      </g>
    </svg>`,
});

const BLOG_FILTER_ICONS = Object.freeze({
  all: `
    <svg class="blog-filter-icon blog-filter-icon--all" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="6" height="6" fill="currentColor" />
      <rect x="12" y="2" width="6" height="6" fill="currentColor" />
      <rect x="2" y="12" width="6" height="6" fill="currentColor" />
      <rect x="12" y="12" width="6" height="6" fill="currentColor" />
    </svg>`,
  psychology: `
    <svg class="blog-filter-icon blog-filter-icon--psychology" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M6 3h6v2h3v3h2v5h-3v3H8v-2H5v-3H3V7h3V3Z" fill="currentColor" />
      <rect x="8" y="7" width="2" height="2" fill="var(--blog-accent)" />
      <rect x="12" y="10" width="2" height="2" fill="var(--blog-accent)" />
    </svg>`,
  'machine-learning': `
    <svg class="blog-filter-icon blog-filter-icon--machine-learning" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="5" y="5" width="10" height="10" fill="currentColor" />
      <rect x="8" y="8" width="4" height="4" fill="var(--blog-accent)" />
      <path d="M2 7h3v2H2V7Zm0 4h3v2H2v-2Zm13-4h3v2h-3V7Zm0 4h3v2h-3v-2ZM7 2h2v3H7V2Zm4 0h2v3h-2V2ZM7 15h2v3H7v-3Zm4 0h2v3h-2v-3Z" fill="currentColor" />
    </svg>`,
  neuroscience: `
    <svg class="blog-filter-icon blog-filter-icon--neuroscience" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="m4 5 5 3m2 0 5-3M4 15l5-3m2 0 5 3M9 8v4m2-4v4" stroke="currentColor" stroke-width="2" fill="none" />
      <rect x="2" y="3" width="4" height="4" fill="currentColor" />
      <rect x="14" y="3" width="4" height="4" fill="currentColor" />
      <rect x="2" y="13" width="4" height="4" fill="currentColor" />
      <rect x="14" y="13" width="4" height="4" fill="currentColor" />
      <rect x="8" y="8" width="4" height="4" fill="var(--blog-accent)" />
    </svg>`,
  'civic-tech': `
    <svg class="blog-filter-icon blog-filter-icon--civic-tech" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M2 16h16v2H2zM4 14h2V8H4v6Zm5 0h2V5H9v9Zm5 0h2V2h-2v12Z" fill="currentColor" />
      <rect x="3" y="3" width="3" height="3" fill="var(--blog-accent)" /><rect x="8" y="2" width="3" height="3" fill="var(--blog-accent)" /><rect x="14" y="7" width="3" height="3" fill="var(--blog-accent)" />
    </svg>`,
  cybersecurity: `
    <svg class="blog-filter-icon blog-filter-icon--cybersecurity" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M10 2 17 5v5c0 4-2.7 6.5-7 8-4.3-1.5-7-4-7-8V5l7-3Z" fill="currentColor" />
      <path d="M7 10h6v4H7z" fill="var(--blog-accent)" /><rect x="8" y="7" width="4" height="4" fill="var(--blog-accent)" />
    </svg>`,
  'game-development': `
    <svg class="blog-filter-icon blog-filter-icon--game-development" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M3 8c1-3 3-4 7-4s6 1 7 4l1 6c.4 2-2 3-3.4 1.5L12 13H8l-2.6 2.5C4 17 1.6 16 2 14l1-6Z" fill="currentColor" />
      <path d="M5 9h4v2H5V9Zm1-1h2v4H6V8Z" fill="var(--blog-accent)" /><rect x="13" y="8" width="2" height="2" fill="var(--blog-accent)" /><rect x="15" y="10" width="2" height="2" fill="var(--blog-accent)" />
    </svg>`,
  robotics: `
    <svg class="blog-filter-icon blog-filter-icon--robotics" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="5" y="5" width="10" height="9" fill="currentColor" /><rect x="8" y="2" width="4" height="3" fill="currentColor" />
      <rect x="7" y="8" width="2" height="2" fill="var(--blog-accent)" /><rect x="11" y="8" width="2" height="2" fill="var(--blog-accent)" />
      <path d="M2 8h3v2H2v-2Zm13 0h3v2h-3V8ZM7 14h2v4H7v-4Zm4 0h2v4h-2v-4Z" fill="currentColor" />
    </svg>`,
  anthem: `
    <svg class="blog-filter-icon blog-filter-icon--anthem" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M4 3h2v11.5a3.5 3.5 0 1 1-2 0V3Zm2 2h9v2H6V5Zm9 0h2v8.5a3.5 3.5 0 1 1-2 0V5Z" fill="currentColor" />
      <circle cx="4" cy="16" r="2" fill="var(--blog-accent)" /><circle cx="15" cy="16" r="2" fill="var(--blog-accent)" />
    </svg>`,
  'internet-culture': `
    <svg class="blog-filter-icon blog-filter-icon--internet-culture" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="2" y="3" width="7" height="6" fill="currentColor" /><rect x="11" y="11" width="7" height="6" fill="currentColor" />
      <path d="M9 6h2v2H9V6Zm0 6h2v2H9v-2Z" fill="var(--blog-accent)" /><path d="M6 9v2h8V9h2v4h-2v2H6v-2H4V9h2Z" fill="currentColor" />
    </svg>`,
  'islamic-heritage': `
    <svg class="blog-filter-icon blog-filter-icon--islamic-heritage" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M9 1h2v3H9V1ZM7 4h6v2h2v2h1v3H4V8h1V6h2V4ZM3 11h14v7H3v-7Z" fill="currentColor" />
      <rect x="9" y="13" width="2" height="5" fill="var(--blog-accent)" />
    </svg>`,
});

const BLOG_FILTER_ICON_ALIASES = Object.freeze({
  'civic-tech': 'civic-tech',
  civictech: 'civic-tech',
  civic: 'civic-tech',
  cybersecurity: 'cybersecurity',
  'cyber-security': 'cybersecurity',
  security: 'cybersecurity',
  'game-development': 'game-development',
  'game-dev': 'game-development',
  gamedev: 'game-development',
  robotics: 'robotics',
  anthem: 'anthem',
  'internet-culture': 'internet-culture',
  internetculture: 'internet-culture',
  internet: 'internet-culture',
  'islamic-heritage': 'islamic-heritage',
  heritage: 'islamic-heritage',
  technology: 'machine-learning',
  design: 'all',
  education: 'neuroscience',
  music: 'anthem',
  news: 'internet-culture',
  personal: 'psychology',
  projects: 'civic-tech',
  general: 'all',
});

function normaliseLegacyPath(value) {
  const source = String(value ?? '').trim();
  if (!source) return '';

  try {
    const parsed = new URL(source, 'https://www.akmalalif.com');
    const isRelative = !/^[a-z][a-z\d+.-]*:/i.test(source) && !source.startsWith('//');

    if (!isRelative && !CANONICAL_BLOG_HOSTNAMES.has(parsed.hostname.toLowerCase())) {
      return '';
    }

    return parsed.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function isLegacyBlogThumbnail(value) {
  return normaliseLegacyPath(value) === LEGACY_BLOG_THUMBNAIL_PATH;
}

export function resolveBlogThumbnail(post) {
  const slug = String(post?.slug ?? '').trim();
  const coverUrl = String(post?.cover_image_url ?? post?.cover_url ?? post?.cover_image ?? '').trim();
  const artwork = BLOG_ARTWORK_BY_SLUG[slug];

  if (artwork && (!coverUrl || isLegacyBlogThumbnail(coverUrl))) {
    return { type: 'sprite', artwork };
  }

  return {
    type: 'image',
    src: coverUrl || LEGACY_BLOG_THUMBNAIL,
    alt: String(post?.cover_image_alt || post?.cover_alt || post?.title || 'Blog post'),
  };
}

export function renderBlogSprite(artwork) {
  return BLOG_ARTWORK_SVGS[artwork] ?? '';
}

export function renderBlogFilterIcon(slug, preferredIconKey = '') {
  const slugKey = String(slug ?? '').trim().toLowerCase();
  const preferredKey = String(preferredIconKey ?? '').trim().toLowerCase();
  const iconKey = BLOG_FILTER_ICON_ALIASES[preferredKey]
    || (Object.hasOwn(BLOG_FILTER_ICONS, preferredKey) ? preferredKey : '')
    || BLOG_FILTER_ICON_ALIASES[slugKey]
    || slugKey;
  return BLOG_FILTER_ICONS[iconKey] ?? '';
}

function getReducedMotion(windowRef) {
  return windowRef?.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;
}

function isCardFiltered(sprite) {
  const card = sprite.closest?.('.blog-card');
  return Boolean(card?.hidden)
    || card?.dataset?.filterState === 'hidden'
    || card?.classList?.contains?.('is-filtered') === true;
}

function listArtwork(root) {
  return Array.from(root?.querySelectorAll?.('[data-blog-artwork]') ?? []);
}

function getNow(nowRef) {
  const value = Number(nowRef?.());
  return Number.isFinite(value) ? value : Date.now();
}

function getArtworkBudgetKey(sprite) {
  const artwork = String(sprite?.dataset?.blogArtwork ?? '').trim();
  const slug = String(sprite?.dataset?.blogArtworkSlug ?? '').trim()
    || BLOG_ARTWORK_SLUG_BY_NAME[artwork]
    || artwork;
  return slug || 'unknown-artwork';
}

function getArtworkBudget(sprite) {
  const key = getArtworkBudgetKey(sprite);
  let budget = playbackBudgets.get(key);

  if (!budget) {
    budget = { remaining: BLOG_ARTWORK_PLAYBACK_BUDGET_MS };
    playbackBudgets.set(key, budget);
  }

  return budget;
}

export function resetBlogArtworkPlaybackBudgets() {
  playbackBudgets.clear();
}

async function readPublicMotionSetting(fetchRef) {
  if (typeof fetchRef !== 'function') return null;

  const response = await fetchRef('/api/blog/settings', {
    headers: { Accept: 'application/json' },
  });

  if (!response?.ok) throw new Error(`Blog settings request failed (${response?.status ?? 'unknown'})`);

  const payload = await response.json();
  return payload?.artwork_motion === 'once' ? 'once' : 'off';
}

export function createBlogArtworkMotionController({
  root,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  intersectionObserver = windowRef?.IntersectionObserver ?? globalThis.IntersectionObserver,
  mutationObserver = windowRef?.MutationObserver ?? globalThis.MutationObserver,
  mediaQuery = getReducedMotion(windowRef),
  fetchRef = windowRef?.fetch?.bind(windowRef),
  nowRef = () => (windowRef?.performance?.now?.() ?? globalThis.performance?.now?.() ?? Date.now()),
  setTimeoutRef = windowRef?.setTimeout?.bind(windowRef) ?? globalThis.setTimeout,
  clearTimeoutRef = windowRef?.clearTimeout?.bind(windowRef) ?? globalThis.clearTimeout,
} = {}) {
  if (!root) return null;

  const visible = new Map();
  const observed = new Set();
  const active = new Map();
  const state = {
    disposed: false,
    documentHidden: Boolean(documentRef?.hidden),
    reducedMotion: Boolean(mediaQuery?.matches),
    motionMode: 'pending',
  };
  let settingRequest = null;
  let budgetTimer = null;
  const IntersectionObserverRef = intersectionObserver;
  const MutationObserverRef = mutationObserver;
  const observer = typeof IntersectionObserverRef === 'function'
    ? new IntersectionObserverRef((entries) => {
      if (state.disposed) return;

      entries.forEach((entry) => visible.set(entry.target, entry.isIntersecting));
      updatePlayback();
    }, { threshold: 0.01 })
    : null;
  const mutations = typeof MutationObserverRef === 'function'
    ? new MutationObserverRef(() => refresh())
    : null;

  function clearBudgetTimer() {
    if (budgetTimer === null) return;
    clearTimeoutRef?.(budgetTimer);
    budgetTimer = null;
  }

  function stopSprite(sprite, now = getNow(nowRef)) {
    const startedAt = active.get(sprite);
    if (startedAt === undefined) return;

    const budget = getArtworkBudget(sprite);
    budget.remaining = Math.max(0, budget.remaining - Math.max(0, now - startedAt));
    active.delete(sprite);
  }

  function scheduleBudgetTimer() {
    clearBudgetTimer();
    if (state.disposed || !active.size || typeof setTimeoutRef !== 'function') return;

    const now = getNow(nowRef);
    const nextRemaining = Math.min(...Array.from(active, ([sprite, startedAt]) => {
      const budget = getArtworkBudget(sprite);
      return Math.max(0, budget.remaining - Math.max(0, now - startedAt));
    }));

    budgetTimer = setTimeoutRef(updatePlayback, Math.max(1, nextRemaining));
  }

  function shouldPlay(sprite) {
    const budget = getArtworkBudget(sprite);
    return state.motionMode === 'once'
      && budget.remaining > 0
      && !state.documentHidden
      && !state.reducedMotion
      && !isCardFiltered(sprite)
      && (observer ? visible.get(sprite) === true : true);
  }

  function updatePlayback() {
    if (state.disposed) return;

    const sprites = listArtwork(root);
    const current = new Set(sprites);
    const now = getNow(nowRef);

    active.forEach((_startedAt, sprite) => {
      if (!current.has(sprite)) stopSprite(sprite, now);
    });

    sprites.forEach((sprite) => {
      if (active.has(sprite)) {
        stopSprite(sprite, now);
      }

      if (shouldPlay(sprite)) {
        active.set(sprite, now);
        sprite.dataset.artworkMotionState = 'playing';
      } else {
        sprite.dataset.artworkMotionState = 'paused';
      }
    });
    scheduleBudgetTimer();
  }

  function refresh() {
    if (state.disposed) return;

    const sprites = listArtwork(root);
    const current = new Set(sprites);
    visible.forEach((_isVisible, sprite) => {
      if (!current.has(sprite)) {
        visible.delete(sprite);
        observed.delete(sprite);
        observer?.unobserve?.(sprite);
      }
    });

    sprites.forEach((sprite) => {
      if (!visible.has(sprite)) visible.set(sprite, observer ? false : true);
      if (observer && !observed.has(sprite)) {
        observer.observe(sprite);
        observed.add(sprite);
      }
    });
    updatePlayback();
  }

  function setMotionMode(mode) {
    if (state.disposed) return state.motionMode;
    state.motionMode = ['once', 'off', 'error', 'pending'].includes(mode) ? mode : 'pending';
    updatePlayback();
    return state.motionMode;
  }

  function loadMotionSetting() {
    if (state.disposed || typeof fetchRef !== 'function') return Promise.resolve(state.motionMode);
    if (settingRequest) return settingRequest;

    state.motionMode = 'pending';
    updatePlayback();
    settingRequest = readPublicMotionSetting(fetchRef)
      .then((mode) => setMotionMode(mode ?? 'off'))
      .catch(() => setMotionMode('error'))
      .finally(() => {
        settingRequest = null;
      });

    return settingRequest;
  }

  function handleVisibilityChange() {
    if (state.disposed) return;

    state.documentHidden = Boolean(documentRef?.hidden);
    updatePlayback();
    if (!state.documentHidden) loadMotionSetting();
  }

  function handleMotionChange(event) {
    if (state.disposed) return;

    state.reducedMotion = Boolean(event.matches);
    updatePlayback();
  }

  function dispose() {
    if (state.disposed) return;

    state.disposed = true;
    const now = getNow(nowRef);
    active.forEach((_startedAt, sprite) => stopSprite(sprite, now));
    clearBudgetTimer();
    listArtwork(root).forEach((sprite) => {
      sprite.dataset.artworkMotionState = 'paused';
    });
    observer?.disconnect();
    observed.clear();
    mutations?.disconnect();
    documentRef?.removeEventListener?.('visibilitychange', handleVisibilityChange);
    mediaQuery?.removeEventListener?.('change', handleMotionChange);
    mediaQuery?.removeListener?.(handleMotionChange);
  }

  documentRef?.addEventListener?.('visibilitychange', handleVisibilityChange);
  if (mediaQuery?.addEventListener) mediaQuery.addEventListener('change', handleMotionChange);
  else mediaQuery?.addListener?.(handleMotionChange);
  mutations?.observe(root, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'data-filter-state', 'hidden'],
  });
  refresh();
  loadMotionSetting();

  return {
    dispose,
    refresh,
    loadMotionSetting,
    setMotionMode,
    getState: () => ({ ...state }),
    getArtworkState: (sprite) => sprite?.dataset?.artworkMotionState ?? null,
    getArtworkBudget: (sprite) => getArtworkBudget(sprite).remaining,
  };
}

const controllers = new WeakMap();

export function initBlogArtworkMotion(documentRef = globalThis.document) {
  const root = documentRef?.querySelector?.('[data-blog-posts]');
  if (!root) return null;

  const existing = controllers.get(root);
  if (existing) {
    if (!existing.getState().disposed) {
      existing.refresh();
      return existing;
    }

    controllers.delete(root);
  }

  const controller = createBlogArtworkMotionController({ root, documentRef, windowRef: documentRef?.defaultView ?? globalThis.window });
  if (controller) controllers.set(root, controller);
  return controller;
}

export function disposeBlogArtworkMotion(documentRef = globalThis.document) {
  const root = documentRef?.querySelector?.('[data-blog-posts]');
  const controller = root ? controllers.get(root) : null;
  controller?.dispose();
  if (root) controllers.delete(root);
}
