import { defineConfig } from "vitest/config";
import config from "./vitest.config";

export default defineConfig({
  test: {
    ...config.test,
    globalSetup: [],
    include: ["tests/health.test.ts", "tests/database-safety.test.ts"],
    env: { ...config.test?.env, DATABASE_URL: "", TEST_DATABASE_URL: "" },
  },
});
