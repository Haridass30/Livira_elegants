// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

// TODO(owner): set this to your production domain once deployed on Cloudflare Pages.
const SITE = "https://livira.example.com";

// https://astro.build/config
export default defineConfig({
  site: SITE,
  // Fully static output. The cart/checkout are React islands; the order API
  // lives in /functions (Cloudflare Pages Functions), deployed alongside the
  // static assets — so Astro itself ships zero server runtime.
  output: "static",
  // Hydrate islands only where used; everything else is plain HTML/CSS.
  integrations: [
    react(),
    sitemap({
      // Keep transactional pages out of the sitemap.
      filter: (page) =>
        !page.includes("/checkout") && !page.includes("/order/"),
    }),
  ],
  image: {
    // Allow remote sample imagery during the build; swap for local assets in
    // src/assets for production (astro:assets optimises both).
    remotePatterns: [{ protocol: "https" }],
  },
  vite: {
    plugins: [tailwindcss()],
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: "viewport",
  },
});
