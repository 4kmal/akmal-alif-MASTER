import { defineConfig } from 'vite';
import { relative, resolve } from 'path';
import { readdirSync, statSync, cpSync, existsSync, mkdirSync } from 'fs';

// Function to recursively find all HTML files
function findHtmlFiles(dir, basePath = '') {
  const entries = {};
  
  try {
    const files = readdirSync(dir);
    
    for (const file of files) {
      const fullPath = resolve(dir, file);
      const relativePath = basePath ? `${basePath}/${file}` : file;
      
      // Skip node_modules, hidden directories, and build output
      if (file === 'node_modules' || file === 'dist' || file.startsWith('.')) continue;
      
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
const htmlEntries = findHtmlFiles(resolve(__dirname, '.'));

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

export default defineConfig({
  root: '.',
  publicDir: false, // We're serving static files directly
  server: {
    port: 3000,
    open: true, // Auto-open browser
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/media': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
    watch: {
      // Watch all files for changes
      usePolling: true, // Better compatibility on Windows
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
      name: 'local-clean-url-rewrites',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const url = req.url?.split('?')[0] ?? '';

          if (url === '/blogs' || url === '/blogs/') {
            req.url = req.url?.replace(/^\/blogs\/?/, '/blog.html');
          } else {
            const blogMatch = url.match(/^\/blog\/([^/.]+)\/?$/);
            if (blogMatch) {
              req.url = req.url?.replace(/^\/blog\/([^/.]+)\/?/, '/blog/$1.html');
            }
          }

          next();
        });
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
});

