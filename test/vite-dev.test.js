import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

test('frontend preview serves clean routes and only forwards public reads', async (t) => {
  const requests = [];
  const backend = createHttpServer((request, response) => {
    requests.push({ method: request.method, url: request.url, range: request.headers.range });
    if (request.url.startsWith('/api/')) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ profile_views: 618, post_impressions: 178 }));
      return;
    }
    response.writeHead(request.headers.range ? 206 : 200, {
      'Content-Type': 'video/mp4',
      'Content-Length': '4',
      'Accept-Ranges': 'bytes',
      ...(request.headers.range ? { 'Content-Range': 'bytes 0-3/20' } : {}),
    });
    response.end(request.method === 'HEAD' ? undefined : 'ftyp');
  });
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');

  const previousBackend = process.env.PORTFOLIO_DEV_BACKEND;
  process.env.PORTFOLIO_DEV_BACKEND = `http://127.0.0.1:${backend.address().port}`;
  let server;
  t.after(async () => {
    await server?.close();
    backend.closeAllConnections();
    await new Promise((resolve) => backend.close(resolve));
    if (previousBackend === undefined) delete process.env.PORTFOLIO_DEV_BACKEND;
    else process.env.PORTFOLIO_DEV_BACKEND = previousBackend;
  });

  server = await createServer({
    configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false, open: false },
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;

  await t.test('keeps reference HTML and generated output out of entries', () => {
    const entries = Object.values(server.config.build.rollupOptions.input);
    assert.ok(entries.some((entry) => /[/\\]blog\.html$/.test(entry)));
    assert.ok(entries.every((entry) => !/[/\\](repo-reference|dist|generated|node_modules|\.wrangler|apps|admin-analytics)[/\\]/.test(entry)));
  });

  await t.test('serves the blog clean URL with its query intact', async () => {
    const response = await fetch(`${origin}/blogs?source=dev-check`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /My Blog - Akmal Alif/);
  });

  await t.test('serves the shared article shell for a slug published without a build', async () => {
    const response = await fetch(`${origin}/blog/newly-published-studio-post?preview=1`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /data-blog-content/);
  });

  await t.test('canonicalizes shared article URLs with a trailing slash', async () => {
    const response = await fetch(`${origin}/blog/newly-published-studio-post/?source=share`, { redirect: 'manual' });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('Location'), '/blog/newly-published-studio-post?source=share');
  });

  await t.test('forwards public API reads and their query strings', async () => {
    const response = await fetch(`${origin}/api/profile-metrics?check=1`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { profile_views: 618, post_impressions: 178 });
    assert.equal(requests.at(-1).url, '/api/profile-metrics?check=1');
  });

  await t.test('forwards seeking and HEAD on R2 and original video URLs', async () => {
    for (const pathname of ['/media/videos/demo.mp4', '/assets/video/brandon.mp4', '/assets/video/zopo%20(@aesopcash).mp4', '/blog/blogpic/thumb1.mp4']) {
      const range = await fetch(`${origin}${pathname}`, { headers: { Range: 'bytes=0-3' } });
      assert.equal(range.status, 206, pathname);
      assert.equal(range.headers.get('Content-Range'), 'bytes 0-3/20');
      assert.equal(await range.text(), 'ftyp');
      assert.equal(requests.at(-1).range, 'bytes=0-3');
      const head = await fetch(`${origin}${pathname}`, { method: 'HEAD' });
      assert.equal(head.status, 200, pathname);
      assert.equal(head.headers.get('Content-Length'), '4');
      assert.equal(await head.text(), '');
    }
  });

  await t.test('rejects mutations before any request reaches the backend', async () => {
    const before = requests.length;
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await fetch(`${origin}/api/profile-metrics`, { method });
      assert.equal(response.status, 405, method);
      assert.equal(response.headers.get('Allow'), 'GET, HEAD');
    }
    const videoWrite = await fetch(`${origin}/assets/video/brandon.mp4`, { method: 'POST' });
    assert.equal(videoWrite.status, 405);
    for (const path of ['/api/events', '/api/admin/sink/link/create']) {
      const response = await fetch(`${origin}${path}`, { method: 'POST' });
      assert.equal(response.status, 405, path);
    }
    assert.equal(requests.length, before);
  });
});
