import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  // Hosted at https://openclaw.rausku.com/ui/
  base: "/ui/",
});
