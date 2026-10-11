import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // The obsidian package carries only types; the app provides it at run time
      obsidian: fileURLToPath(new URL("./src/test/obsidian-stub.ts", import.meta.url)),
    },
  },
});
