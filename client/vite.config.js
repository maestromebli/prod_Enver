import { defineConfig } from "vite";

/** Лише якщо запускають окремо: npm run dev --prefix client → проксі на :3000 */
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true
      }
    }
  }
});
