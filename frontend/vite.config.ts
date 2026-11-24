/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind-mounted source on macOS/Windows doesn't deliver filesystem
    // change events into the container, so Vite has to poll for changes
    // instead of waiting for them. host lets the dev server, which
    // otherwise only listens on the container's localhost, be reached
    // from the host machine's browser via the port mapping in
    // docker-compose.yml.
    watch: {
      usePolling: true,
    },
    host: "0.0.0.0",
    port: 5173,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "cobertura"],
    },
  },
});
