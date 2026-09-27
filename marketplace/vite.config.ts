import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  // Relative asset base so the built app works when served from
  // /marketplace/ (or any sub-path) by the OmniStore static server.
  base: "./",
  build: {
    // The package-root index.html is the PRODUCTION entry that
    // express.static serves at GET /marketplace/ (directory index), so vite
    // must build from the source entry in dev.html instead.
    // scripts/postbuild.js then publishes dist/index.html + the root entry.
    rollupOptions: {
      input: path.resolve(__dirname, "dev.html"),
    },
  },
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
