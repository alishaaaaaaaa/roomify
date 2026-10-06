// Test setup. Kept separate from vite.config.ts on purpose: that file
// loads the React Router plugin, which isn't needed (and can get in the
// way) when running plain unit tests.
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Lets tests use the same "~/..." imports as the app
    alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["app/**/*.test.ts"],
  },
});
