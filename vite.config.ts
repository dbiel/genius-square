import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'fonts/*.woff2'],
      manifest: {
        name: 'Genius Square',
        short_name: 'Genius Sq',
        description: 'Roll the dice, place the blockers, fill the square.',
        theme_color: '#0b0b14',
        background_color: '#0b0b14',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // /12345 is a puzzle link; serve the app shell for it offline too.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/(assets|fonts)\//, /\.(js|css|json|png|svg|woff2|webmanifest)$/],
      },
    }),
  ],
});
