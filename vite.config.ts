import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { crx, ManifestV3Export } from '@crxjs/vite-plugin';
import manifest from './manifest.json';
import { resolve } from 'path';
import preprocess from 'svelte-preprocess';

// Update manifest with asset paths
const manifestWithAssets = {
  ...manifest,
  manifest_version: 3,
  icons: {
    '16': 'assets/icons/icon16.png',
    '48': 'assets/icons/icon48.png',
    '128': 'assets/icons/icon128.png',
  },
  action: {
    ...manifest.action,
    default_icon: {
      '16': 'assets/icons/icon16.png',
      '48': 'assets/icons/icon48.png',
      '128': 'assets/icons/icon128.png',
    },
  },
} as ManifestV3Export;

export default defineConfig(({ mode }) => {
  return {
    plugins: [
      svelte({
        preprocess: preprocess(),
        compilerOptions: {
          dev: mode === 'development',
        },
      }),
      crx({ manifest: manifestWithAssets }),
    ],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      minify: mode === 'production',
      sourcemap: mode === 'development',
      rollupOptions: {
        output: {
          format: 'esm',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]'
        },
      },
    },
    resolve: {
      alias: {
        $lib: resolve(__dirname, './src/lib'),
        buffer: 'buffer/',
      },
    },
    define: {
      global: 'globalThis',
      'process.env.NODE_ENV': JSON.stringify(mode),
    },
    server: {
      port: 5173,
      strictPort: true,
      hmr: {
        port: 5173,
      },
    },
    publicDir: 'assets',
  };
});
