import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractCloudFrontReferences,
  extractRuntimeModelReferences,
  isGitLfsPointer,
  r2KeyForUrl,
  safeOutputPath,
} from '../scripts/prepare-media.mjs';

test('extracts CloudFront URLs and trims CSS/JavaScript delimiters', () => {
  const source = `
    background: url('https://dwvo2npct47gg.cloudfront.net/images/my%20image.png');
    const clip = "https://dwvo2npct47gg.cloudfront.net/videos/demo.mp4";
    const ignored = "https://example.com/not-cloudfront.png";
  `;

  const references = extractCloudFrontReferences(source, 'fixture.css');

  assert.deepEqual(references.map((reference) => reference.originalUrl), [
    'https://dwvo2npct47gg.cloudfront.net/images/my%20image.png',
    'https://dwvo2npct47gg.cloudfront.net/videos/demo.mp4',
  ]);
  assert.deepEqual(references.map((reference) => reference.key), [
    'images/my image.png',
    'videos/demo.mp4',
  ]);
  assert.deepEqual(references.map((reference) => reference.line), [2, 3]);
});

test('rejects unsafe decoded object keys before writing', () => {
  assert.throws(
    () => r2KeyForUrl('https://dwvo2npct47gg.cloudfront.net/%2e%2e/secret.txt'),
    /safe object key/,
  );
  assert.throws(
    () => safeOutputPath('C:/tmp/media', '../secret.txt'),
    /escapes output directory/,
  );
});

test('identifies LFS pointers and accepts an MP4 header', () => {
  assert.equal(
    isGitLfsPointer(Buffer.from('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12\n')),
    true,
  );
  assert.equal(isGitLfsPointer(Buffer.from('....ftypisom')), false);
});

test('expands the runtime model prefix into the six OBJ objects', () => {
  const source = `
    function loadModel(name) {
      objLoader.setPath('https://dwvo2npct47gg.cloudfront.net/models/');
      objLoader.load(name + '.obj');
      switch (name) {
        case 'shirts_1': break;
        case 'shirts_2': break;
        case 'hats_1': break;
        case 'hats_2': break;
        case 'hats_3': break;
        case 'revenge_green': break;
      }
    }
    var noise;
  `;
  const literals = extractCloudFrontReferences(source, 'fixture.js');
  const derived = extractRuntimeModelReferences(source, 'fixture.js', literals);

  assert.deepEqual(derived.map((reference) => reference.key), [
    'models/shirts_1.obj',
    'models/shirts_2.obj',
    'models/hats_1.obj',
    'models/hats_2.obj',
    'models/hats_3.obj',
    'models/revenge_green.obj',
  ]);
  assert.equal(derived.every((reference) => reference.derived), true);
});
