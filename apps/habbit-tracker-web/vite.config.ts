import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    // Disajikan di root pada port frontend sendiri (lihat scripts/nginx.conf).
    base: "/",
    plugins: [
      react(),
      TanStackRouterVite(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon/favicon.ico', 'robots.txt', 'favicon/apple-touch-icon.png'],
        manifest: {
          name: "Habbit Pasutri",
          short_name: "Pasutri",
          description: "Cute & Gamified Habit Tracker for Couples",
          theme_color: '#0f172a',
          background_color: '#0f172a',
          display: 'standalone',
          orientation: 'portrait',
          scope: '/',
          start_url: '/',
          icons: [
            {
              src: 'favicon/web-app-manifest-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any maskable'
            },
            {
              src: 'favicon/web-app-manifest-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ]
        }
      })
    ],
    server: {
      port: 7071,
      host: true,
      proxy: {
        '/api': {
          target: env.VITE_BASE_URL_API || 'http://localhost:7070',
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});

