import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceDirectory = resolve(projectRoot, 'content/releases/2026-10-28');
const outputDirectory = process.argv[2];
if (!outputDirectory) throw new Error('Provide an output directory outside the checkout for reviewed publishing artifacts.');
const destination = resolve(outputDirectory);
if (destination.toLowerCase().startsWith(projectRoot.toLowerCase())) {
  throw new Error('Publishing artifacts must stay outside the checkout.');
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function inline(value) {
  const escaped = escapeHtml(value);
  return escaped.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

const release = JSON.parse(await readFile(resolve(sourceDirectory, 'release.json'), 'utf8'));
const index = [];
await mkdir(destination, { recursive: true });
for (const post of release.posts) {
  const file = resolve(sourceDirectory, `${post.slug}.md`);
  const source = await readFile(file, 'utf8');
  const blocks = source.trim().split(/\r?\n\s*\r?\n/);
  const title = blocks.shift()?.replace(/^#\s+/, '').trim();
  if (!title) throw new Error(`Missing title in ${basename(file)}`);
  const body = blocks.map(block => {
    const heading = block.match(/^(#{2,4})\s+(.+)$/s);
    return heading ? `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>` : `<p>${inline(block.replace(/\r?\n/g, ' '))}</p>`;
  }).join('\n');
  const words = body.replace(/<[^>]*>/g, ' ').match(/\S+/g)?.length ?? 0;
  if (words < 900 || words > 1400) throw new Error(`${post.slug}: ${words} words, expected 900–1400`);
  if (post.meta_title.length > 80 || post.meta_description.length > 180) throw new Error(`${post.slug}: oversized SEO field`);
  const record = { ...post, title, read_minutes: Math.max(1, Math.ceil(words / 220)), words, sha256: createHash('sha256').update(source).digest('hex') };
  await writeFile(resolve(destination, `${post.slug}.html`), body);
  index.push(record);
}
await writeFile(resolve(destination, 'publishing-index.json'), `${JSON.stringify({ date: release.date, posts: index, categories: release.categories, gallery: release.gallery, calendar_event: release.calendar_event }, null, 2)}\n`);
console.log(JSON.stringify(index.map(({ slug, words, read_minutes }) => ({ slug, words, read_minutes })), null, 2));
