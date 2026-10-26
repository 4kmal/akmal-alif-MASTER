import { defineConfig, loadEnv, normalizePath } from 'vite';
import { relative, resolve } from 'path';
import { readdirSync, statSync, cpSync, existsSync, mkdirSync } from 'fs';
import { Agent as HttpsAgent } from 'node:https';

const projectRoot = resolve(__dirname, '.');
const ignoredDirectories = new Set(['node_modules', 'dist', 'generated', 'repo-reference', 'coverage', 'apps', 'admin-analytics']);
const backendPaths = ['/api', '/media', '/assets/video/', '/blog/blogpic/thumb1.mp4'];

function isBackendPath(url = '') {
  const pathname = url.split('?')[0];
  return backendPaths.some((prefix) => pathname.startsWith(prefix));
}

function findHtmlFiles(dir, basePath = '') {
  const entries = {};
  
  try {
    const files = readdirSync(dir);
    
    for (const file of files) {
      const fullPath = resolve(dir, file);
      const relativePath = basePath ? `${basePath}/${file}` : file;
      
      if (ignoredDirectories.has(file) || file.startsWith('.')) continue;
      
      const stat = statSync(fullPath);
      
      if (stat.isDirectory()) {
        // Recursively search subdirectories
        Object.assign(entries, findHtmlFiles(fullPath, relativePath));
      } else if (file.endsWith('.html')) {
        // Add HTML file as an entry point
        const name = relativePath.replace('.html', '').replace(/\//g, '-');
        entries[name] = fullPath;
      }
    }
  } catch (e) {
    console.warn(`Could not read directory: ${dir}`);
  }
  
  return entries;
}

// Get all HTML entry points
const htmlEntries = findHtmlFiles(projectRoot);

const excludedStaticAssets = new Set([
  'assets/video/brandon.mp4',
  'assets/video/zopo (@aesopcash).mp4',
  'blog/blogpic/thumb1.mp4',
]);

function copyStaticDirectory(sourceDir, targetDir = sourceDir) {
  const sourcePath = resolve(__dirname, sourceDir);
  const targetPath = resolve(__dirname, 'dist', targetDir);

  if (!existsSync(sourcePath)) return;

  mkdirSync(targetPath, { recursive: true });

  for (const entry of readdirSync(sourcePath)) {
    const sourceEntryPath = resolve(sourcePath, entry);
    const targetEntryPath = resolve(targetPath, entry);
    const projectPath = relative(__dirname, sourceEntryPath).replaceAll('\\', '/');

    if (excludedStaticAssets.has(projectPath)) continue;
    if (entry.endsWith('.html')) continue;

    if (statSync(sourceEntryPath).isDirectory()) {
      copyStaticDirectory(projectPath, `${targetDir}/${entry}`);
    } else {
      cpSync(sourceEntryPath, targetEntryPath);
    }
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, 'PORTFOLIO_');
  const backend = env.PORTFOLIO_DEV_BACKEND || 'https://www.akmalalif.com';
  const agent = backend.startsWith('https:')
    ? new HttpsAgent({ keepAlive: true, family: 4 })
    : undefined;
  const proxy = Object.fromEntries(backendPaths.map((prefix) => [prefix, {
    target: backend,
    changeOrigin: true,
    agent,
  }]));

  return {
  root: '.',
  publicDir: false, // We're serving static files directly
  server: {
    port: 3000,
    strictPort: true,
    open: false,
    proxy,
    watch: {
      ignored: ['**/repo-reference/**', '**/dist/**', '**/generated/**', '**/.wrangler/**', '**/coverage/**', '**/apps/**', '**/admin-analytics/**'],
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: htmlEntries,
    },
  },
  plugins: [
    {
      name: 'portfolio-event-tracking',
      transformIndexHtml: {
        order: 'pre',
        handler() {
          return [{ tag: 'script', attrs: { type: 'module', src: '/js/analytics.js' }, injectTo: 'head' }];
        },
      },
    },
    {
      name: 'read-only-development-backend',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (isBackendPath(req.url) && !['GET', 'HEAD'].includes(req.method)) {
            res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'The frontend preview only forwards public reads.' }));
            return;
          }
          next();
        });
      },
    },
    {
      name: 'local-clean-url-rewrites',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const url = req.url?.split('?')[0] ?? '';

          if (url === '/blogs' || url === '/blogs/') {
            req.url = req.url?.replace(/^\/blogs\/?/, '/blog.html');
          } else {
            const blogMatch = url.match(/^\/blog\/([^/.]+)\/?$/);
            if (blogMatch) {
              const page = existsSync(resolve(projectRoot, 'blog', `${blogMatch[1]}.html`))
                ? `/blog/${blogMatch[1]}.html`
                : '/blog/article-template.html';
              req.url = req.url?.replace(/^\/blog\/([^/.]+)\/?/, page);
            }
          }

          next();
        });
      },
    },
    {
      name: 'reload-fetched-partials-and-scripts',
      apply: 'serve',
      handleHotUpdate({ file, modules, timestamp, server }) {
        const pathname = normalizePath(relative(projectRoot, file));
        const partial = pathname.startsWith('partials/') && pathname.endsWith('.html');
        const script = pathname.startsWith('js/') && pathname.endsWith('.js');
        if (!partial && !script) return;

        const invalidated = new Set();
        for (const module of modules) {
          server.moduleGraph.invalidateModule(module, invalidated, timestamp, true);
        }
        server.ws.send({ type: 'full-reload', path: '*' });
        return [];
      },
    },
    {
      name: 'copy-static-assets',
      closeBundle() {
        // Copy directories with static files that are not bundled by Vite
        // (plain <script src> tags, dynamically loaded assets, partial images)
        const staticDirs = [
          'js',
          'icon',
          'lagu',
          'album cover',
          'assets',
          'blog/blogpic',
          'contact',
          'playground',
          'contoh/awge-website',
        ];
        for (const dir of staticDirs) {
          copyStaticDirectory(dir);
        }
      },
    },
  ],
  };
});

