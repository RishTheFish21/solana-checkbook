import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  // GitHub Pages serves the app from /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  server: { port: 5173 },
  // The vendored Codama client reads process.env['NODE_ENV'], which browsers don't have.
  define: { "process.env": JSON.stringify({ NODE_ENV: mode }) },
}));
