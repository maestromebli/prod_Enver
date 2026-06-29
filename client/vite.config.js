import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

/** Лише якщо запускають окремо: npm run dev --prefix client → проксі на :3000 */
export default defineConfig({
  publicDir: "public",
  resolve: {
    alias: {
      "@enver/shared": path.join(repoRoot, "shared")
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three")) return "three";
        }
      },
      input: {
        main: path.resolve(__dirname, "index.html"),
        operator: path.resolve(__dirname, "operator.html"),
        viewer: path.resolve(__dirname, "viewer.html"),
        androidInstall: path.resolve(__dirname, "android-install.html")
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true
      }
    }
  }
});
