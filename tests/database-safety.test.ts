import { describe, expect, it } from "vitest";
import { validateDatabaseIdentities, validateDatabaseTargets } from "./database-safety";

const dev = "postgresql://user:fake@localhost/app";
const test = "postgresql://user:fake@localhost/app_test";

describe("protecciones puras, no acreditan integracion PostgreSQL", () => {
  it.each([undefined, ""])("no usa DATABASE_URL como fallback (%s)", (missing) => {
    expect(() => validateDatabaseTargets(dev, missing)).toThrow(/TEST_DATABASE_URL/);
  });
  it("requiere referencia de desarrollo", () => {
    expect(() => validateDatabaseTargets(undefined, test)).toThrow(/DATABASE_URL/);
  });
  it.each([
    dev,
    "postgres://other:fake@127.0.0.1:5432/app",
    "postgresql://user:fake@alias.example:6432/%61pp",
    "postgresql://user:fake@remote/APP",
  ])("rechaza el mismo nombre incluso con alias (%s)", (url) => {
    expect(() => validateDatabaseTargets(dev, url)).toThrow(/nombre distinto/);
  });
  it.each(["invalid", "https://host/app_test", `${test}?host=alias`, `${test}?options=override`])(
    "rechaza URLs ambiguas (%s)", (url) => {
      expect(() => validateDatabaseTargets(dev, url)).toThrow(/invalida o ambigua/);
    },
  );
  it("admite nombres distintos sujetos a verificar identidad real", () => {
    const targets = validateDatabaseTargets(dev, test);
    expect(() => validateDatabaseIdentities(targets, "app", "app_test")).not.toThrow();
    expect(() => validateDatabaseIdentities(targets, "app", "app")).toThrow(/Identidad/);
    expect(() => validateDatabaseIdentities(targets, "aliased", "app_test")).toThrow(/Identidad/);
  });

  const first = "abcdefghijklmnopqrst";
  const second = "tsrqponmlkjihgfedcba";
  const direct = (project: string) => `postgresql://postgres:fake@db.${project}.supabase.co:5432/postgres`;
  const pooler = (project: string) => `postgresql://postgres.${project}:fake@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;

  it.each([
    [direct(first), direct(second)],
    [direct(first), pooler(second)],
    [pooler(first), pooler(second)],
  ])("admite proyectos comprobables distintos con nombre postgres (%#)", (development, isolated) => {
    const targets = validateDatabaseTargets(development, isolated);
    expect(() => validateDatabaseIdentities(targets, "postgres", "postgres")).not.toThrow();
    expect(() => validateDatabaseIdentities(targets, "other", "postgres")).toThrow(/Identidad/);
  });

  it.each([
    pooler(first),
    pooler(first).replace(":5432/", ":6543/"),
    pooler(first).replace("aws-0-us-east-1", "aws-1-eu-west-1"),
    direct(first).replace(":5432/", ":6543/"),
    direct(first).replace(".supabase.co:", ".SUPABASE.CO.:"),
    pooler(first).replace("postgres.", "other%2E").replace(":fake@", ":different@"),
    pooler(first).replace("/postgres", "/another_database"),
  ])("rechaza mismo proyecto entre aliases, roles, puertos y bases (%#)", (isolated) => {
    expect(() => validateDatabaseTargets(direct(first), isolated)).toThrow(/compartir proyecto/);
  });

  it.each([
    pooler(second).replace(`postgres.${second}`, "postgres"),
    pooler(second).replace("pooler.supabase.com", "pooler.supabase.com.evil.example"),
    pooler(second).replace("aws-0-us-east-1.pooler.supabase.com", "alias.example"),
    direct(second).replace(second, "unknown"),
    direct(second).replace(":5432/", ":9999/"),
    direct(second).replace("postgres:fake", `postgres.${first}:fake`),
    `${direct(second)}?sslmode=require&sslmode=disable`,
    `${direct(second)}?user=postgres.${first}`,
  ])("falla cerrado ante identidad o routing ambiguos (%#)", (isolated) => {
    expect(() => validateDatabaseTargets(direct(first), isolated)).toThrow(/invalida o ambigua/);
  });

  it("no acredita aislamiento por hosts o IPs desconocidos con nombre postgres", () => {
    expect(() => validateDatabaseTargets(direct(first), "postgresql://postgres:fake@127.0.0.1/postgres"))
      .toThrow(/no verificable/);
    expect(() => validateDatabaseTargets(direct(first), "postgresql://postgres:fake@alias.example/other"))
      .toThrow(/no verificable/);
  });
});
