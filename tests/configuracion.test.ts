import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import app from "../src/app";
import { configuracionDtoSchema, configuracionUpdateSchema } from "../src/modules/configuracion/configuracion.schema";

const maxRadio = 2147483647;

function parse(body: unknown) {
  return configuracionUpdateSchema.safeParse(body);
}

function expectsFailure(body: unknown) {
  const result = parse(body);
  expect(result.success).toBe(false);
  return result;
}

describe("configuracionUpdateSchema: cuerpo parcial con al menos un campo valido", () => {
  it.each([
    [{ nombreEmpresa: "TaxiSur" }],
    [{ radioMaximoBusquedaKm: 5 }],
    [{ telefonoCentroAtencion: "+59170000000" }],
    [{ nombreEmpresa: "TaxiSur", radioMaximoBusquedaKm: 5, telefonoCentroAtencion: "+59170000000" }],
  ])("acepta %j", (body) => {
    expect(parse(body).success).toBe(true);
  });

  it("telefono null explicito se mantiene distinto de un campo ausente", () => {
    const result = parse({ telefonoCentroAtencion: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data)).toEqual(["telefonoCentroAtencion"]);
      expect(result.data.telefonoCentroAtencion).toBeNull();
    }
  });

  it("strings aceptados se almacenan recortados", () => {
    const result = parse({ nombreEmpresa: "  TaxiSur  ", telefonoCentroAtencion: "  +59170000000  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nombreEmpresa).toBe("TaxiSur");
      expect(result.data.telefonoCentroAtencion).toBe("+59170000000");
    }
  });

  it.each([
    "a".repeat(100),
    " ".repeat(99) + "x",
  ])("nombreEmpresa en el limite superior se acepta (%s)", (valor) => {
    expect(parse({ nombreEmpresa: valor }).success).toBe(true);
  });

  it.each([1, 2147483647])("radio en limites se acepta (%d)", (radio) => {
    expect(parse({ radioMaximoBusquedaKm: radio }).success).toBe(true);
  });

  it.each(["x".repeat(30)])("telefono en el limite superior se acepta (%s)", (telefono) => {
    expect(parse({ telefonoCentroAtencion: telefono }).success).toBe(true);
  });
});

describe("configuracionUpdateSchema: entrada invalida", () => {
  it.each([
    {},
    [],
    null,
    undefined,
    "texto",
    42,
  ])("cuerpo no objeto con campos editables se rechaza (%j)", (body) => {
    expectsFailure(body);
  });

  it.each([
    { id: 1 },
    { creadoEn: "2026-09-09T00:00:00.000Z" },
    { actualizadoEn: "2026-09-09T00:00:00.000Z" },
    { eliminadoEn: null },
    { nombreEmpresa: "TaxiSur", id: 1 },
    { radioMaximoBusquedaKm: 5, eliminadoEn: null },
  ])("campos no editables se rechazan (%j)", (body) => {
    expectsFailure(body);
  });

  it.each([
    { extra: "desconocido" },
    { nombreEmpresa: "TaxiSur", extra: "desconocido" },
    { nombreEmpresa: "TaxiSur", telefonoCentroAtencion: ["+59170000000"] },
  ])("cualquier campo desconocido se rechaza (%j)", (body) => {
    expectsFailure(body);
  });

  it.each([
    { nombreEmpresa: null },
    { nombreEmpresa: "" },
    { nombreEmpresa: "   " },
    { nombreEmpresa: "a".repeat(101) },
    { nombreEmpresa: 42 },
  ])("nombreEmpresa invalido se rechaza (%j)", (body) => {
    expectsFailure(body);
  });

  it.each([
    { radioMaximoBusquedaKm: null },
    { radioMaximoBusquedaKm: 0 },
    { radioMaximoBusquedaKm: -1 },
    { radioMaximoBusquedaKm: 2147483648 },
    { radioMaximoBusquedaKm: 2.5 },
    { radioMaximoBusquedaKm: "5" },
    { radioMaximoBusquedaKm: true },
    { radioMaximoBusquedaKm: Math.PI },
  ])("radioMaximoBusquedaKm invalido se rechaza (%j)", (body) => {
    expectsFailure(body);
  });

  it.each([
    { telefonoCentroAtencion: "" },
    { telefonoCentroAtencion: "   " },
    { telefonoCentroAtencion: "x".repeat(31) },
    { telefonoCentroAtencion: 123 },
    { telefonoCentroAtencion: [null] },
  ])("telefonoCentroAtencion invalido se rechaza (%j)", (body) => {
    expectsFailure(body);
  });

  it("radio maximo fuera de rango por uno se rechaza", () => {
    expectsFailure({ radioMaximoBusquedaKm: maxRadio + 1 });
  });
});

describe("configuracionDtoSchema: contrato de salida", () => {
  const base = {
    id: 1,
    nombreEmpresa: "TaxiSur - Pruebas",
    radioMaximoBusquedaKm: 5,
    actualizadoEn: "2026-09-09T00:00:00.000Z",
  };

  it("acepta telefono string y null", () => {
    for (const telefonoCentroAtencion of ["+59170000000", null]) {
      const result = configuracionDtoSchema.safeParse({ ...base, telefonoCentroAtencion });
      expect(result.success).toBe(true);
    }
  });

  it("rechaza tipos invalidos, campos obligatorios ausentes y campos que no pertenecen al DTO", () => {
    for (const body of [
      { ...base, id: "1", telefonoCentroAtencion: null },
      { ...base, nombreEmpresa: 42, telefonoCentroAtencion: null },
      { ...base, radioMaximoBusquedaKm: "5", telefonoCentroAtencion: null },
      { ...base, actualizadoEn: 42, telefonoCentroAtencion: null },
      { ...base, telefonoCentroAtencion: null, creadoEn: "2026-09-09T00:00:00.000Z" },
      { ...base, telefonoCentroAtencion: null, eliminadoEn: null },
      { ...base },
    ]) {
      const parsed = configuracionDtoSchema.safeParse(body);
      expect(parsed.success).toBe(false);
    }
  });
});

describe("GET y PUT /api/configuracion", () => {
  const ownedIds: string[] = [];
  const endpoint = "/api/configuracion";
  let prisma: PrismaClient;
  let jwtSecret: string;
  let n8nToken: string;
  let cuentas: { admin: { id: string }; conductor: { id: string }; eliminado: { id: string } };
  const unauthorized = { error: { code: "UNAUTHORIZED", message: "Credenciales invalidas" } };
  const forbidden = { error: { code: "FORBIDDEN", message: "Permiso denegado" } };
  const validation = { error: { code: "VALIDATION_ERROR", message: "Entrada invalida" } };

  function signToken(sub: string) {
    return jwt.sign({}, jwtSecret, { algorithm: "HS256", subject: sub, expiresIn: 28800 });
  }

  const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  beforeAll(async () => {
    const databaseUrl = inject("adminTestDatabaseUrl");
    if (!databaseUrl || process.env.DATABASE_URL !== databaseUrl) throw new Error("Falta destino validado por el setup");
    prisma = (await import("../src/config/prisma")).prisma;
    const { env } = await import("../src/config/env");
    jwtSecret = env.JWT_SECRET;
    n8nToken = env.N8N_API_TOKEN;
    await prisma.configuracion.deleteMany({ where: { id: 1 } });
    expect(await prisma.configuracion.count({ where: { id: 1 } })).toBe(0);
    const hash = await bcrypt.hash("fictitious-configuracion-password", 12);
    cuentas = { admin: { id: "" }, conductor: { id: "" }, eliminado: { id: "" } };
    for (const name of ["admin", "conductor", "eliminado"]) {
      const id = randomUUID();
      ownedIds.push(id);
      cuentas[name as keyof typeof cuentas] = await prisma.usuario.create({
        data: {
          id, correoElectronico: `spec04-cfg-${id}@example.invalid`, telefono: `spec04-cfg-${id}`,
          rol: name === "conductor" ? "conductor" : "admin",
          eliminadoEn: name === "eliminado" ? new Date() : null,
          hashContrasena: hash,
        },
        select: { id: true },
      });
    }
  }, 30000);

  afterAll(async () => {
    vi.restoreAllMocks();
    if (!prisma) return;
    try {
      await prisma.configuracion.deleteMany({ where: { id: 1 } });
      const where = { id: { in: ownedIds } };
      await prisma.usuario.deleteMany({ where });
      expect(await prisma.usuario.count({ where })).toBe(0);
    } finally {
      await prisma.$disconnect();
    }
  });

  describe("GET: lectura e inicializacion", () => {
    it("sin credenciales devuelve 401 y no crea la fila", async () => {
      const response = await request(app).get(endpoint);
      expect(response.status).toBe(401);
      expect(JSON.stringify(response.body) === JSON.stringify(unauthorized)).toBe(true);
      expect(await prisma.configuracion.findUnique({ where: { id: 1 } })).toBeNull();
    });

    it("JWT vencido, firma invalida, token n8n invalido y usuario eliminado devuelven 401 sin inicializar", async () => {
      const { env } = await import("../src/config/env");
      const expirado = jwt.sign({}, env.JWT_SECRET, { algorithm: "HS256", subject: cuentas.admin.id, expiresIn: -10 });
      const candidatos = [
        request(app).get(endpoint).set("Authorization", `Bearer ${expirado}`),
        request(app).get(endpoint).set("Authorization", "Bearer firma-invalida"),
        request(app).get(endpoint).set("X-N8N-Token", "n8n-invalido"),
        request(app).get(endpoint).set("Authorization", `Bearer ${signToken(cuentas.eliminado.id)}`),
      ];
      for (const response of await Promise.all(candidatos)) {
        expect(response.status).toBe(401);
        expect(JSON.stringify(response.body) === JSON.stringify(unauthorized)).toBe(true);
      }
      expect(await prisma.configuracion.findUnique({ where: { id: 1 } })).toBeNull();
    });

    it("primer GET autenticado crea exactamente id=1 con los tres valores predeterminados confirmados", async () => {
      const response = await request(app).get(endpoint).set("Authorization", `Bearer ${signToken(cuentas.admin.id)}`);
      expect(response.status).toBe(200);
      expect(Object.keys(response.body).sort()).toEqual([
        "actualizadoEn", "id", "nombreEmpresa", "radioMaximoBusquedaKm", "telefonoCentroAtencion",
      ]);
      expect(configuracionDtoSchema.parse(response.body)).toEqual(response.body);
      expect(response.body.id).toBe(1);
      expect(response.body.nombreEmpresa).toBe("TaxiSur - Pruebas");
      expect(response.body.radioMaximoBusquedaKm).toBe(5);
      expect(response.body.telefonoCentroAtencion).toBe("+59100000000");
      expect(response.body.actualizadoEn).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(await prisma.configuracion.count({ where: { id: 1 } })).toBe(1);
      const fila = await prisma.configuracion.findUnique({ where: { id: 1 } });
      expect(fila).not.toBeNull();
      expect(fila!.nombreEmpresa).toBe("TaxiSur - Pruebas");
      expect(fila!.radioMaximoBusquedaKm).toBe(5);
      expect(fila!.telefonoCentroAtencion).toBe("+59100000000");
      expect(fila!.eliminadoEn).toBeNull();
      expect(fila!.actualizadoEn.toISOString()).toBe(response.body.actualizadoEn);
    });

    it("GET con JWT de conductor activo o token n8n valido devuelve 200 con el mismo DTO", async () => {
      const anterior = await request(app).get(endpoint).set("Authorization", `Bearer ${signToken(cuentas.admin.id)}`);
      const conductor = await request(app).get(endpoint).set("Authorization", `Bearer ${signToken(cuentas.conductor.id)}`);
      const n8n = await request(app).get(endpoint).set("X-N8N-Token", n8nToken);
      for (const response of [conductor, n8n]) {
        expect(response.status).toBe(200);
        expect(JSON.stringify(response.body) === JSON.stringify(anterior.body)).toBe(true);
      }
    });

    it("GET repetido no cambia datos ni actualizadoEn", async () => {
      const antes = await request(app).get(endpoint).set("Authorization", `Bearer ${signToken(cuentas.conductor.id)}`);
      await esperar(1100);
      const despues = await request(app).get(endpoint).set("Authorization", `Bearer ${signToken(cuentas.conductor.id)}`);
      expect(JSON.stringify(despues.body) === JSON.stringify(antes.body)).toBe(true);
      const fila = await prisma.configuracion.findUnique({ where: { id: 1 } });
      expect(fila).not.toBeNull();
      expect(fila!.actualizadoEn.toISOString()).toBe(antes.body.actualizadoEn);
      expect(fila!.nombreEmpresa).toBe("TaxiSur - Pruebas");
      expect(fila!.radioMaximoBusquedaKm).toBe(5);
      expect(fila!.telefonoCentroAtencion).toBe("+59100000000");
    });
  });

  describe("PUT: actualizacion parcial protegida por rol admin", () => {
    beforeAll(async () => {
      await prisma.configuracion.deleteMany({ where: { id: 1 } });
      expect(await prisma.configuracion.count({ where: { id: 1 } })).toBe(0);
    });

    it("sin JWT o con cuerpo invalido devuelve 401 y no inicializa (autenticacion antes que validacion)", async () => {
      for (const response of [
        await request(app).put(endpoint).send({ nombreEmpresa: "TaxiSur" }),
        await request(app).put(endpoint).send({}),
        await request(app).put(endpoint).set("Authorization", "Bearer firma-invalida").send({ radioMaximoBusquedaKm: 8 }),
        await request(app).put(endpoint).set("Authorization", `Bearer ${signToken(cuentas.eliminado.id)}`).send({ nombreEmpresa: "TaxiSur" }),
      ]) {
        expect(response.status).toBe(401);
        expect(JSON.stringify(response.body) === JSON.stringify(unauthorized)).toBe(true);
      }
      expect(await prisma.configuracion.findUnique({ where: { id: 1 } })).toBeNull();
    });

    it("solo token n8n valido no autoriza escribir", async () => {
      const response = await request(app).put(endpoint).set("X-N8N-Token", n8nToken).send({ radioMaximoBusquedaKm: 9 });
      expect(response.status).toBe(401);
      expect(JSON.stringify(response.body) === JSON.stringify(unauthorized)).toBe(true);
      expect(await prisma.configuracion.findUnique({ where: { id: 1 } })).toBeNull();
    });

    it("JWT de usuario activo no admin devuelve 403 y no escribe", async () => {
      const response = await request(app).put(endpoint)
        .set("Authorization", `Bearer ${signToken(cuentas.conductor.id)}`)
        .send({ nombreEmpresa: "TaxiSur Hack" });
      expect(response.status).toBe(403);
      expect(JSON.stringify(response.body) === JSON.stringify(forbidden)).toBe(true);
      expect(await prisma.configuracion.findUnique({ where: { id: 1 } })).toBeNull();
    });

    it("PUT admin sobre tabla vacia crea la fila con defaults para los omitidos y valores enviados", async () => {
      const response = await request(app).put(endpoint)
        .set("Authorization", `Bearer ${signToken(cuentas.admin.id)}`)
        .send({ radioMaximoBusquedaKm: 8 });
      expect(response.status).toBe(200);
      expect(Object.keys(response.body).sort()).toEqual([
        "actualizadoEn", "id", "nombreEmpresa", "radioMaximoBusquedaKm", "telefonoCentroAtencion",
      ]);
      expect(configuracionDtoSchema.parse(response.body)).toEqual(response.body);
      expect(response.body.id).toBe(1);
      expect(response.body.nombreEmpresa).toBe("TaxiSur - Pruebas");
      expect(response.body.radioMaximoBusquedaKm).toBe(8);
      expect(response.body.telefonoCentroAtencion).toBe("+59100000000");
      expect(await prisma.configuracion.count({ where: { id: 1 } })).toBe(1);
    });

    it("PUT de admin actualiza campos y conserva los omitidos", async () => {
      const response = await request(app).put(endpoint)
        .set("Authorization", `Bearer ${signToken(cuentas.admin.id)}`)
        .send({ nombreEmpresa: "  TaxiSur Oficial  ", radioMaximoBusquedaKm: 10 });
      expect(response.status).toBe(200);
      expect(response.body.nombreEmpresa).toBe("TaxiSur Oficial");
      expect(response.body.radioMaximoBusquedaKm).toBe(10);
      expect(response.body.telefonoCentroAtencion).toBe("+59100000000");
      expect(response.body.id).toBe(1);
    });

    it("PUT con telefono null limpia el campo y un GET posterior devuelve null", async () => {
      const response = await request(app).put(endpoint)
        .set("Authorization", `Bearer ${signToken(cuentas.admin.id)}`)
        .send({ telefonoCentroAtencion: null });
      expect(response.status).toBe(200);
      expect(response.body.telefonoCentroAtencion).toBeNull();
      expect(response.body.nombreEmpresa).toBe("TaxiSur Oficial");
      expect(response.body.radioMaximoBusquedaKm).toBe(10);
      const lectura = await request(app).get(endpoint).set("Authorization", `Bearer ${signToken(cuentas.admin.id)}`);
      expect(lectura.status).toBe(200);
      expect(lectura.body.telefonoCentroAtencion).toBeNull();
      const fila = await prisma.configuracion.findUnique({ where: { id: 1 } });
      expect(fila!.telefonoCentroAtencion).toBeNull();
    });

    it.each([
      {},
      [],
      null,
      { id: 1 },
      { creadoEn: "2026-09-09T00:00:00.000Z" },
      { nombreEmpresa: "" },
      { nombreEmpresa: null },
      { nombreEmpresa: "x".repeat(101) },
      { radioMaximoBusquedaKm: 0 },
      { radioMaximoBusquedaKm: -5 },
      { radioMaximoBusquedaKm: 2.5 },
      { radioMaximoBusquedaKm: "8" },
      { radioMaximoBusquedaKm: null },
      { telefonoCentroAtencion: "" },
      { telefonoCentroAtencion: "x".repeat(31) },
      { telefonoCentroAtencion: 123 },
      { extra: "desconocido" },
      { nombreEmpresa: "TaxiSur", radioMaximoBusquedaKm: "10" },
      { nombreEmpresa: "   " },
    ])("cuerpo invalido %j devuelve 400 sin escritura", async (body) => {
      const antes = await prisma.configuracion.findUnique({ where: { id: 1 } });
      const response = await request(app).put(endpoint)
        .set("Authorization", `Bearer ${signToken(cuentas.admin.id)}`)
        .send(body);
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body) === JSON.stringify(validation)).toBe(true);
      const despues = await prisma.configuracion.findUnique({ where: { id: 1 } });
      expect(JSON.stringify(despues) === JSON.stringify(antes)).toBe(true);
    });

    it("PUT devuelve el DTO actualizado completo y solo sus cinco campos", async () => {
      const response = await request(app).put(endpoint)
        .set("Authorization", `Bearer ${signToken(cuentas.admin.id)}`)
        .send({ nombreEmpresa: "TaxiSur - Pruebas", radioMaximoBusquedaKm: 12, telefonoCentroAtencion: "+59110000000" });
      expect(response.status).toBe(200);
      expect(Object.keys(response.body).sort()).toEqual([
        "actualizadoEn", "id", "nombreEmpresa", "radioMaximoBusquedaKm", "telefonoCentroAtencion",
      ]);
      expect(configuracionDtoSchema.parse(response.body)).toEqual(response.body);
      expect(response.body.nombreEmpresa).toBe("TaxiSur - Pruebas");
      expect(response.body.radioMaximoBusquedaKm).toBe(12);
      expect(response.body.telefonoCentroAtencion).toBe("+59110000000");
    });
  });

  describe("GET y PUT: fila eliminada, fallos de base y concurrencia", () => {
    const interno = { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } };
    const conflicto = { error: { code: "CONFIGURATION_DELETED", message: "Configuracion eliminada" } };
    const adminHeader = () => ({ Authorization: `Bearer ${signToken(cuentas.admin.id)}` });

    async function sembrar(vals: { nombreEmpresa: string; radioMaximoBusquedaKm: number; telefonoCentroAtencion: string | null }) {
      await prisma.configuracion.deleteMany({ where: { id: 1 } });
      const response = await request(app).put(endpoint).set(adminHeader()).send(vals);
      expect(response.status).toBe(200);
      const fila = await prisma.configuracion.findUnique({ where: { id: 1 } });
      expect(fila).not.toBeNull();
      return fila!;
    }

    it("GET sobre fila eliminada devuelve 409 y preserva todos sus datos", async () => {
      await sembrar({ nombreEmpresa: "TaxiSur Eliminada", radioMaximoBusquedaKm: 6, telefonoCentroAtencion: "+59100000000" });
      await prisma.configuracion.update({ where: { id: 1 }, data: { eliminadoEn: new Date() } });
      const antes = await prisma.configuracion.findUnique({ where: { id: 1 } });
      expect(antes!.eliminadoEn).not.toBeNull();

      const response = await request(app).get(endpoint).set(adminHeader());
      expect(response.status).toBe(409);
      expect(JSON.stringify(response.body) === JSON.stringify(conflicto)).toBe(true);

      const despues = await prisma.configuracion.findUnique({ where: { id: 1 } });
      expect(JSON.stringify(despues) === JSON.stringify(antes)).toBe(true);
      expect(despues!.nombreEmpresa).toBe("TaxiSur Eliminada");
      expect(despues!.radioMaximoBusquedaKm).toBe(6);
      expect(despues!.telefonoCentroAtencion).toBe("+59100000000");
    });

    it("PUT sobre fila eliminada devuelve 409 y no la modifica ni la restaura", async () => {
      const antes = await prisma.configuracion.findUnique({ where: { id: 1 } });
      expect(antes!.eliminadoEn).not.toBeNull();

      const response = await request(app).put(endpoint).set(adminHeader()).send({ radioMaximoBusquedaKm: 99 });
      expect(response.status).toBe(409);
      expect(JSON.stringify(response.body) === JSON.stringify(conflicto)).toBe(true);

      const despues = await prisma.configuracion.findUnique({ where: { id: 1 } });
      expect(JSON.stringify(despues) === JSON.stringify(antes)).toBe(true);
      expect(despues!.radioMaximoBusquedaKm).toBe(6);
      expect(despues!.eliminadoEn).not.toBeNull();
    });

    it("GET no sobrescribe una fila preexistente ni avanza su actualizadoEn", async () => {
      await sembrar({ nombreEmpresa: "TaxiSur Real", radioMaximoBusquedaKm: 3, telefonoCentroAtencion: "+59111111111" });
      await esperar(1100);
      const antes = await prisma.configuracion.findUnique({ where: { id: 1 } });

      const respuesta = await request(app).get(endpoint).set(adminHeader());
      expect(respuesta.status).toBe(200);
      expect(respuesta.body.nombreEmpresa).toBe("TaxiSur Real");
      expect(respuesta.body.radioMaximoBusquedaKm).toBe(3);
      expect(respuesta.body.telefonoCentroAtencion).toBe("+59111111111");
      expect(respuesta.body.actualizadoEn).toBe(antes!.actualizadoEn.toISOString());

      const despues = await prisma.configuracion.findUnique({ where: { id: 1 } });
      expect(JSON.stringify(despues) === JSON.stringify(antes)).toBe(true);
    });

    it("inicializaciones GET concurrentes crean una sola fila id=1 con defaults", async () => {
      await prisma.configuracion.deleteMany({ where: { id: 1 } });
      expect(await prisma.configuracion.count({ where: { id: 1 } })).toBe(0);

      const respuestas = await Promise.all(
        Array.from({ length: 10 }, () => request(app).get(endpoint).set(adminHeader())),
      );
      for (const respuesta of respuestas) {
        expect(respuesta.status).toBe(200);
        expect(respuesta.body.id).toBe(1);
      }

      expect(await prisma.configuracion.count({ where: { id: 1 } })).toBe(1);
      const fila = await prisma.configuracion.findUnique({ where: { id: 1 } });
      expect(fila!.nombreEmpresa).toBe("TaxiSur - Pruebas");
      expect(fila!.radioMaximoBusquedaKm).toBe(5);
      expect(fila!.telefonoCentroAtencion).toBe("+59100000000");
      const bodiesIguales = respuestas.every(
        (r) => JSON.stringify(r.body) === JSON.stringify(respuestas[0].body),
      );
      expect(bodiesIguales).toBe(true);
    });

    it("dos PUTs concurrentes de campos distintos conservan ambas actualizaciones", async () => {
      await prisma.configuracion.deleteMany({ where: { id: 1 } });

      const [primero, segundo] = await Promise.all([
        request(app).put(endpoint).set(adminHeader()).send({ nombreEmpresa: "TaxiSur A" }),
        request(app).put(endpoint).set(adminHeader()).send({ radioMaximoBusquedaKm: 14 }),
      ]);
      expect(primero.status).toBe(200);
      expect(segundo.status).toBe(200);

      expect(await prisma.configuracion.count({ where: { id: 1 } })).toBe(1);
      const fila = await prisma.configuracion.findUnique({ where: { id: 1 } });
      expect(fila!.nombreEmpresa).toBe("TaxiSur A");
      expect(fila!.radioMaximoBusquedaKm).toBe(14);
      expect(fila!.telefonoCentroAtencion).toBe("+59100000000");
    });

    it("inicializaciones GET/PUT concurrentes no duplican ni pierden valores actualizados", async () => {
      await prisma.configuracion.deleteMany({ where: { id: 1 } });
      expect(await prisma.configuracion.count({ where: { id: 1 } })).toBe(0);

      const respuestas = await Promise.all([
        ...Array.from({ length: 10 }, () => request(app).get(endpoint).set(adminHeader())),
        request(app).put(endpoint).set(adminHeader()).send({ nombreEmpresa: "TaxiSur Concurrente" }),
        request(app).put(endpoint).set(adminHeader()).send({ radioMaximoBusquedaKm: 7 }),
      ]);
      for (const respuesta of respuestas) {
        expect(respuesta.status).toBe(200);
      }

      expect(await prisma.configuracion.count({ where: { id: 1 } })).toBe(1);
      const fila = await prisma.configuracion.findUnique({ where: { id: 1 } });
      expect(fila!.nombreEmpresa).toBe("TaxiSur Concurrente");
      expect(fila!.radioMaximoBusquedaKm).toBe(7);
      expect(fila!.telefonoCentroAtencion).toBe("+59100000000");
    });

    it("fallo de base en GET produce 500 seguro sin datos inventados", async () => {
      await sembrar({ nombreEmpresa: "TaxiSur - Pruebas", radioMaximoBusquedaKm: 5, telefonoCentroAtencion: "+59100000000" });
      const create = vi.spyOn(prisma.configuracion, "create").mockRejectedValueOnce(new Error("SQL connection secret stack"));
      try {
        const response = await request(app).get(endpoint).set(adminHeader());
        expect(response.status).toBe(500);
        expect(JSON.stringify(response.body) === JSON.stringify(interno)).toBe(true);
        expect(JSON.stringify(response.body)).not.toMatch(/secret|stack|sql/i);
        expect(JSON.stringify(response.body)).not.toContain("TaxiSur");
      } finally {
        create.mockRestore();
      }
      expect((await prisma.configuracion.findUnique({ where: { id: 1 } }))!.nombreEmpresa).toBe("TaxiSur - Pruebas");
    });

    it("fallo de base en PUT produce 500 seguro sin escritura", async () => {
      const find = vi.spyOn(prisma.configuracion, "findUnique").mockRejectedValueOnce(new Error("SQL connection secret stack"));
      try {
        const response = await request(app).put(endpoint).set(adminHeader()).send({ nombreEmpresa: "Nunca Escrita" });
        expect(response.status).toBe(500);
        expect(JSON.stringify(response.body) === JSON.stringify(interno)).toBe(true);
        expect(JSON.stringify(response.body)).not.toMatch(/secret|stack|sql/i);
      } finally {
        find.mockRestore();
      }
      expect((await prisma.configuracion.findUnique({ where: { id: 1 } }))!.nombreEmpresa).not.toBe("Nunca Escrita");
    });
  });
});