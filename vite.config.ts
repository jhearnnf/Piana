import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs. The desktop shell serves the build from `piana://app/`
  // (see electron/serve.cjs), and relative paths resolve there and under a
  // plain static host alike, without the build having to know which it is.
  base: "./",
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
