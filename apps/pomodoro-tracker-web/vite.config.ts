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
        registerType: "autoUpdate",
        includeAssets: ["favicon/favicon.svg", "favicon/favicon.ico", "robots.txt"],
        // `start_url` / `scope` are relative on purpose: the plugin resolves
        // them against Vite's `base`, so the manifest stays correct both at
        // `/` (dev) and `/pomodoro/` (production).
        manifest: {
          name: "Pomodoro",
          short_name: "Pomodoro",
          description: "Timer fokus Pomodoro dengan riwayat dan statistik pribadi",
          lang: "id",
          theme_color: "#FF8FB1",
          background_color: "#FFF7F9",
          display: "standalone",
          orientation: "portrait",
          start_url: ".",
          scope: ".",
          icons: [
            {
              src: "favicon/web-app-manifest-192x192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any maskable",
            },
            {
              src: "favicon/web-app-manifest-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any maskable",
            },
          ],
        },
        workbox: {
          // App shell only. Sessions are append-only and queued in
          // localStorage (see `use-offline-queue`), so there is no runtime API
          // caching to get stale.
          globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2}"],
          navigateFallback: "index.html",
        },
      }),
    ],
    server: {
      port: 8081,
      host: true,
      proxy: {
        "/api": {
          target: env.VITE_BASE_URL_API || "http://localhost:8080",
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
