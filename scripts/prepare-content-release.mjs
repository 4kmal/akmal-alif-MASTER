import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countWords, parseMarkdownPost, renderPostHtml, renderPostTiptap } from './content-release.mjs';

// Usage: node scripts/prepare-content-release.mjs <output-dir-outside-checkout> [release-date]
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const releaseDate = process.argv[3] ?? '2026-10-28';
if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) throw new Error('Release date must look like 2026-10-31.');
const sourceDirectory = resolve(projectRoot, 'content/releases', releaseDate);
const outputDirectory = process.argv[2];
if (!outputDirectory) throw new Error('Provide an output directory outside the checkout for reviewed publishing artifacts.');
const destination = resolve(outputDirectory);
if (destination.toLowerCase().startsWith(projectRoot.toLowerCase())) {
  throw new Error('Publishing artifacts must stay outside the checkout.');
}

const release = JSON.parse(await readFile(resolve(sourceDirectory, 'release.json'), 'utf8'));
const index = [];
await mkdir(destination, { recursive: true });
for (const post of release.posts) {
  const file = resolve(sourceDirectory, `${post.slug}.md`);
  const source = await readFile(file, 'utf8');
  const parsed = parseMarkdownPost(source);
  if (!parsed.title) throw new Error(`Missing title in ${basename(file)}`);
  const body = renderPostHtml(parsed);
  const words = countWords(body);
  const [minWords, maxWords] = post.words ?? [900, 1400];
  if (words < minWords || words > maxWords) throw new Error(`${post.slug}: ${words} words, expected ${minWords}–${maxWords}`);
  if (post.meta_title.length > 80 || post.meta_description.length > 180) throw new Error(`${post.slug}: oversized SEO field`);
  const record = { ...post, title: parsed.title, read_minutes: Math.max(1, Math.ceil(words / 220)), words, sha256: createHash('sha256').update(source).digest('hex') };
  await writeFile(resolve(destination, `${post.slug}.html`), body);
  await writeFile(resolve(destination, `${post.slug}.tiptap.json`), `${JSON.stringify(renderPostTiptap(parsed), null, 2)}\n`);
  index.push(record);
}
await writeFile(resolve(destination, 'publishing-index.json'), `${JSON.stringify({ date: release.date, posts: index, categories: release.categories, gallery: release.gallery, calendar_event: release.calendar_event }, null, 2)}\n`);
console.log(JSON.stringify(index.map(({ slug, words, read_minutes }) => ({ slug, words, read_minutes })), null, 2));
