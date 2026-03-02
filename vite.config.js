import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readdirSync, statSync, cpSync, existsSync } from 'fs';

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

export default defineConfig({
  root: '.',
  publicDir: false, // We're serving static files directly
  server: {
    port: 3000,
    open: true, // Auto-open browser
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
      name: 'copy-static-assets',
      closeBundle() {
        // Copy directories with static files that are not bundled by Vite
        // (plain <script src> tags, dynamically loaded assets, partial images)
        const staticDirs = ['js', 'icon', 'lagu', 'album cover'];
        for (const dir of staticDirs) {
          if (existsSync(dir)) {
            cpSync(dir, `dist/${dir}`, { recursive: true });
          }
        }
      },
    },
  ],
});

