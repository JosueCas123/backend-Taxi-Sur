import dotenv from "dotenv";
import { Client } from "pg";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import type { TestProject } from "vitest/node";
import { validateDatabaseIdentities, validateDatabaseTargets } from "./database-safety";

export default async function setup(project: TestProject) {
  // Leer configuracion sin volcar valores ni sustituir DATABASE_URL antes de validarla.
  const local = dotenv.config({ path: ".env", quiet: true, processEnv: {} }).parsed ?? {};
  const targets = validateDatabaseTargets(
    process.env.DATABASE_URL ?? local.DATABASE_URL,
    process.env.TEST_DATABASE_URL ?? local.TEST_DATABASE_URL,
  );

  async function identity(connectionString: string, destination: "desarrollo" | "pruebas") {
    const client = new Client({
      connectionString,
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
      options: "-c default_transaction_read_only=on",
    });
    try {
      await client.connect();
      await client.query("BEGIN READ ONLY");
      const result = await client.query<{ database: string }>("SELECT current_database() AS database");
      await client.query("ROLLBACK");
      return result.rows[0].database;
    } catch (error) {
      const code = (error as { code?: string })?.code;
      const safeCode = code && ["28P01", "28000", "ENOTFOUND", "ENETUNREACH", "ECONNREFUSED",
        "ETIMEDOUT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID"].includes(code) ? code : "NO_VERIFICADA";
      throw new Error(`No se pudo verificar identidad PostgreSQL de ${destination} en modo solo lectura (${safeCode})`);
    } finally {
      try {
        await client.end();
      } catch {
        throw new Error("No se pudo cerrar la comprobacion PostgreSQL de forma segura");
      }
    }
  }

  validateDatabaseIdentities(
    targets, await identity(targets.development.url, "desarrollo"), await identity(targets.test.url, "pruebas"),
  );
  console.info("Identidades PostgreSQL separadas verificadas en modo solo lectura");

  process.env.DATABASE_URL = targets.test.url;
  process.env.NODE_ENV = "test";
  try {
    const require = createRequire(import.meta.url);
    execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: targets.test.url },
      stdio: "pipe",
      timeout: 60000,
    });
    console.info("Migraciones existentes: deploy completado solo en pruebas");
  } catch {
    throw new Error("No se pudieron aplicar migraciones al destino de pruebas validado");
  }
  project.provide("adminTestDatabaseUrl", targets.test.url);
  // Cada suite limpia solo sus propios registros; nunca se hace limpieza global.
}
