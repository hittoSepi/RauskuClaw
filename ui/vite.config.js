import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  // Hosted at https://rauskuclaw.rausku.com/ui/
  base: "/ui/",
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/highlight.js")) return "highlight";
          if (id.includes("node_modules")) return "vendor";
          return undefined;
        }
      }
    }
  }
});
