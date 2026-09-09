import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/setup.ts"],
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      DOTENV_CONFIG_PATH: ".env.test.disabled",
      PORT: "3000",
      JWT_SECRET: "unit-test-only-jwt-secret-not-for-deployment",
      JWT_EXPIRES_IN: "8h",
      N8N_API_TOKEN: "unit-test-only-internal-secret-not-for-deployment",
    },
  },
});
