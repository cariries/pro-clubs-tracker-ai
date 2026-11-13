import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests only: pure logic with fixtures and mocks. No network, no database, no browser.
// Tests must never need real credentials; process.env.DATABASE_URL is faked where a module reads it.
export default defineConfig({
  resolve: {
    // Same alias as tsconfig.json ("@/*" -> project root), so tests can import like the app does.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
