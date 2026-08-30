import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    coverage: { reporter: ["text", "json", "html"] },
  },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
});
