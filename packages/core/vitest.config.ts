import { defineConfig } from "vitest/config";

// `pnpm test` runs the unit tests; `pnpm bench` runs the timing / smoke scripts in bench/.
export default defineConfig({
  test: {
    include: process.env.MARSMAP_BENCH ? ["bench/**/*.bench.ts"] : ["test/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
