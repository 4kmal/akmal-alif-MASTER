import assert from 'node:assert/strict';
import test from 'node:test';
import { GALLERY_PAGE_SIZE, normaliseGalleryManifest } from '../js/blog-gallery.js';
import { normaliseYoutubeId } from '../js/youtube-embed.js';
import { renderBlogFilterIcon, resolveBlogThumbnail } from '../js/blog-artwork.js';

test('gallery manifests preserve page order, PDF numbers, and bounded thumbnail batches', () => {
  const manifest = normaliseGalleryManifest({
    id: 'release-notes',
    pages: Array.from({ length: 2_211 }, (_, index) => ({
      original_url: `/media/original-${index + 1}.png`,
      thumbnail_url: `/media/thumb-${index + 1}.png`,
      pdf_page_number: index + 1,
    })),
  });

  assert.equal(GALLERY_PAGE_SIZE, 24);
  assert.equal(manifest.pageCount, 2_000);
  assert.equal(manifest.pages[0].originalUrl, '/media/original-1.png');
  assert.equal(manifest.pages[23].thumbnailUrl, '/media/thumb-24.png');
  assert.equal(manifest.pages.at(-1).pdfPageNumber, 2_000);
});

test('youtube IDs accept exact IDs and supported URLs without weakening validation', () => {
  assert.equal(normaliseYoutubeId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(normaliseYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(normaliseYoutubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(normaliseYoutubeId('dQw4w9WgXcQ-extra'), '');
  assert.equal(normaliseYoutubeId('https://example.com/watch?v=dQw4w9WgXcQ'), '');
});

test('new public cover artwork keeps custom covers ahead of slug fallbacks', () => {
  const generated = resolveBlogThumbnail({ slug: 'dream-1-zero-shot-robotics', title: 'Dream 1' });
  const custom = resolveBlogThumbnail({
    slug: 'dream-1-zero-shot-robotics',
    title: 'Dream 1',
    cover_image_url: '/media/custom.png',
  });

  assert.equal(generated.type, 'sprite');
  assert.equal(generated.artwork, 'bimanual-robot');
  assert.deepEqual(custom, { type: 'image', src: '/media/custom.png', alt: 'Dream 1' });
  assert.match(renderBlogFilterIcon('civic-tech'), /blog-filter-icon--civic-tech/);
  assert.match(renderBlogFilterIcon('new-slug', 'cybersecurity'), /blog-filter-icon--cybersecurity/);
  assert.equal(renderBlogFilterIcon('new-slug', '<svg>'), '');
});
