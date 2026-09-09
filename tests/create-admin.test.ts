import { afterAll, beforeAll, expect, inject, it } from "vitest";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import type { PrismaClient } from "@prisma/client";

declare module "vitest" {
  export interface ProvidedContext {
    adminTestDatabaseUrl: string;
  }
}

const owned: Array<{ correoElectronico: string; telefono: string }> = [];
let prisma: PrismaClient;
let databaseUrl: string;

function credentials(password = "fictitious-password-123") {
  const id = randomUUID();
  const account = { correoElectronico: `spec03-${id}@example.invalid`, telefono: `spec03-${id}` };
  owned.push(account);
  return { ADMIN_EMAIL: account.correoElectronico, ADMIN_PHONE: account.telefono, ADMIN_PASSWORD: password };
}

async function command(values: Record<string, string>, npm = false, importOnly = false) {
  const args = npm
    ? [process.env.npm_execpath!, "run", "--silent", "admin:create"]
    : ["-r", "ts-node/register", ...(importOnly
      ? ["-e", "require('./src/scripts/create-admin')"] : ["src/scripts/create-admin.ts"])];
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      env: { ...process.env, DATABASE_URL: databaseUrl, DOTENV_CONFIG_PATH: ".env.test.disabled",
        ADMIN_EMAIL: "", ADMIN_PASSWORD: "", ADMIN_PHONE: "", ...values },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("El comando no cerro sus recursos a tiempo")); }, 30000);
    child.stdout.on("data", (data) => { output += data.toString(); });
    child.stderr.on("data", (data) => { output += data.toString(); });
    child.on("error", () => { clearTimeout(timer); reject(new Error("No se pudo iniciar el comando de prueba")); });
    child.on("close", (code) => {
      clearTimeout(timer);
      // Comparaciones booleanas para que una regresion no vuelque secretos en el reporte.
      for (const secret of [databaseUrl, ...Object.values(values)].filter((value) => value.length > 0)) {
        if (output.includes(secret)) return reject(new Error("El comando expuso un valor sensible"));
      }
      resolve({ code, output });
    });
  });
}

beforeAll(async () => {
  databaseUrl = inject("adminTestDatabaseUrl");
  if (!databaseUrl || process.env.DATABASE_URL !== databaseUrl) throw new Error("Falta destino validado por el setup");
  prisma = (await import("../src/config/prisma")).prisma;
});

afterAll(async () => {
  if (!prisma) return;
  try {
    const where = { OR: owned.flatMap(({ correoElectronico, telefono }) => [{ correoElectronico }, { telefono }]) };
    await prisma.usuario.deleteMany({ where });
    expect(await prisma.usuario.count({ where })).toBe(0);
  } finally {
    await prisma.$disconnect();
  }
});

it("importar no lee credenciales ni crea cuentas", async () => {
  const values = credentials();
  expect(await command(values, false, true)).toEqual({ code: 0, output: "" });
  expect(await prisma.usuario.count({ where: { correoElectronico: values.ADMIN_EMAIL } })).toBe(0);
}, 40000);

it.each([
  ["minimo ASCII", "a".repeat(12)],
  ["maximo ASCII", "b".repeat(72)],
  ["maximo UTF8", "\u00e9".repeat(36)],
  ["12 puntos de codigo", "\ud83d\ude80".repeat(12)],
  ["sin recortar", "  password-123  "],
])("npm admin:create persiste bcrypt: %s", async (_name, password) => {
  const values = credentials(password);
  expect(await command(values, true)).toEqual({ code: 0, output: "Administrador creado.\n" });
  const row = await prisma.usuario.findUniqueOrThrow({ where: { correoElectronico: values.ADMIN_EMAIL } });
  expect(row.rol).toBe("admin");
  expect(row.telefono).toBe(values.ADMIN_PHONE);
  expect(row.eliminadoEn).toBeNull();
  expect(row.hashContrasena?.startsWith("$2b$12$")).toBe(true);
  expect(await bcrypt.compare(password, row.hashContrasena!)).toBe(true);
  expect(await bcrypt.compare(`${password.slice(0, -1)}x`, row.hashContrasena!)).toBe(false);
  expect(JSON.stringify(row).includes(password)).toBe(false);
}, 40000);

it.each([
  ["correo ausente", { ADMIN_EMAIL: "" }],
  ["correo invalido", { ADMIN_EMAIL: "not-an-email" }],
  ["telefono ausente", { ADMIN_PHONE: "" }],
  ["telefono blanco", { ADMIN_PHONE: "   " }],
  ["password ausente", { ADMIN_PASSWORD: "" }],
  ["11 caracteres", { ADMIN_PASSWORD: "a".repeat(11) }],
  ["73 bytes", { ADMIN_PASSWORD: "a".repeat(73) }],
  ["UTF8 74 bytes", { ADMIN_PASSWORD: "\u00e9".repeat(37) }],
  ["11 puntos de codigo", { ADMIN_PASSWORD: "\ud83d\ude80".repeat(11) }],
])("rechaza %s sin persistir", async (_name, overrides) => {
  const values = { ...credentials(), ...overrides };
  const where = { OR: owned.flatMap(({ correoElectronico, telefono }) => [{ correoElectronico }, { telefono }]) };
  const before = await prisma.usuario.count({ where });
  const result = await command(values);
  expect(result.code).toBe(1);
  expect(result.output.startsWith("Credenciales invalidas:")).toBe(true);
  expect(await prisma.usuario.count({ where })).toBe(before);
}, 40000);

it.each([false, true])("duplicados correo y telefono no modifican cuenta, softdelete=%s", async (deleted) => {
  const original = credentials();
  expect((await command(original)).code).toBe(0);
  if (deleted) await prisma.usuario.update({ where: { correoElectronico: original.ADMIN_EMAIL }, data: { eliminadoEn: new Date(), rol: "conductor" } });
  const before = await prisma.usuario.findUniqueOrThrow({ where: { correoElectronico: original.ADMIN_EMAIL } });
  for (const values of [original, { ...credentials(), ADMIN_EMAIL: original.ADMIN_EMAIL }, { ...credentials(), ADMIN_PHONE: original.ADMIN_PHONE }]) {
    expect(await command(values)).toEqual({ code: 1, output: "Ya existe una cuenta con ese correo o telefono.\n" });
    expect(await prisma.usuario.findUnique({ where: { id: before.id } })).toEqual(before);
  }
}, 120000);

it.each(["ADMIN_EMAIL", "ADMIN_PHONE"] as const)("concurrencia por %s tiene un unico ganador", async (field) => {
  const first = credentials();
  const second = { ...credentials(), [field]: first[field] };
  const results = await Promise.all([command(first), command(second)]);
  expect(results.map((result) => result.code).sort()).toEqual([0, 1]);
  expect(results.find((result) => result.code === 1)?.output).toBe("Ya existe una cuenta con ese correo o telefono.\n");
  expect(await prisma.usuario.count({ where: field === "ADMIN_EMAIL" ? { correoElectronico: first[field] } : { telefono: first[field] } })).toBe(1);
}, 40000);

it("fallo de conexion sale con 1 sin revelar detalles y sin quedar abierto", async () => {
  const result = await command({ ...credentials(), DATABASE_URL: "postgresql://fake:fake@127.0.0.1:1/fake?connect_timeout=1" });
  expect(result).toEqual({ code: 1, output: "No se pudo crear el administrador.\n" });
}, 40000);
