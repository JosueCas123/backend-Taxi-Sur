import { defineConfig } from "vitest/config";
import config from "./vitest.config";

export default defineConfig({
  test: {
    ...config.test,
    globalSetup: [],
    include: ["tests/health.test.ts", "tests/database-safety.test.ts", "tests/conductores.schema.test.ts", "tests/auth-middleware.test.ts", "tests/pasajeros.schema.test.ts", "tests/pasajeros.service.test.ts", "tests/pasajeros.http.test.ts", "tests/ubicaciones.schema.test.ts", "tests/ubicaciones.service.test.ts", "tests/ubicaciones.http.test.ts", "tests/motor-asignacion.schema.test.ts", "tests/motor-asignacion.service.test.ts", "tests/motor-asignacion.http.test.ts", "tests/solicitudes.schema.test.ts", "tests/solicitudes.service.test.ts", "tests/solicitudes.job.test.ts", "tests/solicitudes.http.test.ts"],
    env: { ...config.test?.env, DATABASE_URL: "", TEST_DATABASE_URL: "" },
  },
});

