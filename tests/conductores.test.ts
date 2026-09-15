import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../src/app";
import { EstadoConductor, Prisma, type PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { conductorDetalleDtoSchema, conductorRegistroSchema, listadoConductorDtoSchema, type ConductorRegistroInput, type ListadoConductorDto } from "../src/modules/conductores/conductores.schema";

let prisma: PrismaClient;
let registrarConductor: typeof import("../src/modules/conductores/conductores.service").registrarConductor;
const telefonos: string[] = [];
const placas: string[] = [];

function input(): ConductorRegistroInput {
  const telefono = randomUUID().replace(/-/g, "").slice(0, 30);
  const placa = randomUUID().replace(/-/g, "").slice(0, 30);
  telefonos.push(telefono);
  placas.push(placa);
  return conductorRegistroSchema.parse({
    telefono, pin: "1234", nombreCompleto: "Conductor de prueba", cedulaIdentidad: randomUUID(),
    vehiculo: { placa, marca: "Toyota", modelo: "Corolla", color: "Blanco", capacidadPasajeros: 4 },
  });
}

async function assertAbsent(body: ConductorRegistroInput) {
  expect(await prisma.usuario.count({ where: { telefono: body.telefono } })).toBe(0);
  expect(await prisma.conductor.count({ where: { cedulaIdentidad: body.cedulaIdentidad } })).toBe(0);
}

beforeAll(async () => {
  const url = inject("adminTestDatabaseUrl");
  if (!url || process.env.DATABASE_URL !== url) throw new Error("Falta destino validado por el setup");
  prisma = (await import("../src/config/prisma")).prisma;
  ({ registrarConductor } = await import("../src/modules/conductores/conductores.service"));
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  if (!prisma) return;
  try {
    const usuarios = { telefono: { in: telefonos } };
    const conductores = { usuario: usuarios };
    await prisma.vehiculo.deleteMany({ where: { conductor: conductores } });
    await prisma.conductor.deleteMany({ where: conductores });
    await prisma.usuario.deleteMany({ where: usuarios });
    expect(await prisma.usuario.count({ where: usuarios })).toBe(0);
    expect(await prisma.vehiculo.count({ where: { placa: { in: placas } } })).toBe(0);
  } finally {
    await prisma.$disconnect();
  }
});

describe("GET /api/conductores administrativo", () => {
  const endpoint = "/api/conductores";
  let adminToken: string;
  let conductorToken: string;
  let expiredToken: string;
  let n8nToken: string;
  const perfiles: Record<string, { id: string; usuarioId: string; telefono: string; vehiculoId?: string }> = {};

  beforeAll(async () => {
    const { env } = await import("../src/config/env");
    n8nToken = env.N8N_API_TOKEN;
    const admin = await prisma.usuario.create({ data: { telefono: input().telefono, rol: "admin" } });
    adminToken = jwt.sign({}, env.JWT_SECRET, { subject: admin.id, algorithm: "HS256", expiresIn: "1h" });
    expiredToken = jwt.sign({}, env.JWT_SECRET, { subject: admin.id, algorithm: "HS256", expiresIn: -1 });
    const names = [...Object.values(EstadoConductor), "eliminado", "sinActivo", "sinVehiculos"];
    for (const [index, name] of names.entries()) {
      const body = input();
      const usuario = await prisma.usuario.create({
        data: {
          telefono: body.telefono, rol: "conductor", hashContrasena: "hash-fixture-no-publicar",
          conductor: { create: {
            nombreCompleto: body.nombreCompleto, cedulaIdentidad: body.cedulaIdentidad,
            estado: name in EstadoConductor ? name as EstadoConductor : "pendiente",
            creadoEn: new Date(Date.UTC(2020, 0, names.length - index)),
            eliminadoEn: name === "eliminado" ? new Date() : null,
            vehiculos: name === "sinVehiculos" ? undefined : { create: {
              ...body.vehiculo, creadoEn: new Date("2020-01-01T00:00:00Z"),
              eliminadoEn: name === "sinActivo" ? new Date() : null,
            } },
          } },
        },
        include: { conductor: { include: { vehiculos: true } } },
      });
      perfiles[name] = {
        id: usuario.conductor!.id, usuarioId: usuario.id, telefono: usuario.telefono,
        vehiculoId: usuario.conductor!.vehiculos[0]?.id,
      };
    }
    conductorToken = jwt.sign({}, env.JWT_SECRET, {
      subject: perfiles.pendiente.usuarioId, algorithm: "HS256", expiresIn: "1h",
    });
    const reciente = await prisma.vehiculo.create({ data: {
      ...input().vehiculo, conductorId: perfiles.aprobado.id, creadoEn: new Date("2021-01-01T00:00:00Z"),
    } });
    perfiles.aprobado.vehiculoId = reciente.id;
    await prisma.vehiculo.create({ data: {
      ...input().vehiculo, conductorId: perfiles.aprobado.id,
      creadoEn: new Date("2022-01-01T00:00:00Z"), eliminadoEn: new Date(),
    } });
  }, 30000);

  it("401 sin JWT, con JWT invalido/expirado o solo n8n; no consulta conductores", async () => {
    const query = vi.spyOn(prisma.conductor, "findMany");
    const headers: Record<string, string>[] = [
      {}, { Authorization: "Bearer invalido" }, { Authorization: `Bearer ${expiredToken}` }, { "X-N8N-Token": n8nToken },
    ];
    for (const header of headers) {
      const response = await request(app).get(endpoint).set(header);
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: { code: "UNAUTHORIZED", message: "Credenciales invalidas" } });
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("403 con JWT de conductor, incluso si agrega n8n", async () => {
    const query = vi.spyOn(prisma.conductor, "findMany");
    for (const internal of [false, true]) {
      const req = request(app).get(endpoint).set("Authorization", `Bearer ${conductorToken}`);
      if (internal) req.set("X-N8N-Token", n8nToken);
      const response = await req;
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: { code: "FORBIDDEN", message: "Permiso denegado" } });
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("200 admin: DTO sin secretos, orden ascendente, excluye eliminados y elige vehiculo activo mas reciente", async () => {
    const response = await request(app).get(endpoint).set("Authorization", `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    const rows = response.body as ListadoConductorDto[];
    expect(rows.every((row) => listadoConductorDtoSchema.safeParse(row).success)).toBe(true);
    expect(rows.every((row, index) => index === 0 || Date.parse(rows[index - 1].creadoEn) <= Date.parse(row.creadoEn))).toBe(true);
    const ownIds = Object.values(perfiles).map((perfil) => perfil.id);
    const own = rows.filter((row) => ownIds.includes(row.id));
    expect(own.map((row) => row.id)).toEqual([
      perfiles.sinVehiculos.id, perfiles.sinActivo.id, perfiles.suspendido.id,
      perfiles.rechazado.id, perfiles.aprobado.id, perfiles.pendiente.id,
    ]);
    expect(rows.some((row) => row.id === perfiles.eliminado.id)).toBe(false);
    for (const name of ["sinVehiculos", "sinActivo"]) {
      expect(own.find((row) => row.id === perfiles[name].id)?.vehiculo).toBeNull();
    }
    const aprobado = own.find((row) => row.id === perfiles.aprobado.id)!;
    expect(aprobado.telefono).toBe(perfiles.aprobado.telefono);
    expect(aprobado.vehiculo?.id).toBe(perfiles.aprobado.vehiculoId);
    expect(response.text.includes("hash-fixture-no-publicar")).toBe(false);
    expect(own.every((row) => !("usuarioId" in row) && !("usuario" in row) && !("hashContrasena" in row))).toBe(true);
  });

  it.each(Object.values(EstadoConductor))("filtra estado Prisma %s", async (estado) => {
    const response = await request(app).get(endpoint).query({ estado }).set("Authorization", `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    const rows = response.body as ListadoConductorDto[];
    expect(rows.every((row) => listadoConductorDtoSchema.safeParse(row).success && row.estado === estado)).toBe(true);
    expect(rows.some((row) => row.id === perfiles[estado].id)).toBe(true);
    expect(rows.some((row) => row.id === perfiles.eliminado.id)).toBe(false);
  });

  it.each(["estado=", "estado=activo", "estado=APROBADO", "estado=%20pendiente%20", "estado=pendiente&estado=aprobado", "extra=x"])(
    "400 para filtro invalido %s antes de consultar conductores", async (queryString) => {
      const query = vi.spyOn(prisma.conductor, "findMany");
      const response = await request(app).get(`${endpoint}?${queryString}`).set("Authorization", `Bearer ${adminToken}`);
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: { code: "VALIDATION_ERROR", message: "Entrada invalida" } });
      expect(query).not.toHaveBeenCalled();
    },
  );

  it("500 seguro ante fallo de consulta del listado", async () => {
    vi.spyOn(prisma.conductor, "findMany").mockRejectedValueOnce(new Error("SQL stack secreto simulado"));
    const response = await request(app).get(endpoint).set("Authorization", `Bearer ${adminToken}`);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
  });
});

describe("GET /api/conductores/:id detalle", () => {
  const endpoint = "/api/conductores";
  let adminToken: string;
  let expiredToken: string;
  let n8nToken: string;
  let owner: { id: string; usuarioId: string; telefono: string };
  let other: { id: string; usuarioId: string; telefono: string };
  let deleted: { id: string };
  let ownerToken: string;
  let otherToken: string;

  beforeAll(async () => {
    const { env } = await import("../src/config/env");
    n8nToken = env.N8N_API_TOKEN;
    const admin = await prisma.usuario.create({ data: { telefono: input().telefono, rol: "admin" } });
    adminToken = jwt.sign({}, env.JWT_SECRET, { subject: admin.id, algorithm: "HS256", expiresIn: "1h" });
    expiredToken = jwt.sign({}, env.JWT_SECRET, { subject: admin.id, algorithm: "HS256", expiresIn: -1 });

    const ownerResult = await registrarConductor(input());
    const otherResult = await registrarConductor(input());
    const deletedResult = await registrarConductor(input());
    if (!ownerResult.ok || !otherResult.ok || !deletedResult.ok) throw new Error("Fallo de fixture");
    owner = { id: ownerResult.conductor.id, usuarioId: ownerResult.conductor.usuarioId, telefono: ownerResult.conductor.telefono };
    other = { id: otherResult.conductor.id, usuarioId: otherResult.conductor.usuarioId, telefono: otherResult.conductor.telefono };
    deleted = { id: deletedResult.conductor.id };
    await prisma.conductor.update({ where: { id: deleted.id }, data: { eliminadoEn: new Date() } });
    await prisma.usuario.update({ where: { id: deletedResult.conductor.usuarioId }, data: { eliminadoEn: new Date() } });
    ownerToken = jwt.sign({}, env.JWT_SECRET, { subject: owner.usuarioId, algorithm: "HS256", expiresIn: "1h" });
    otherToken = jwt.sign({}, env.JWT_SECRET, { subject: other.usuarioId, algorithm: "HS256", expiresIn: "1h" });
  }, 30000);

  it("401 sin JWT valido o con token expirado", async () => {
    const query = vi.spyOn(prisma.conductor, "findFirst");
    for (const header of [{}, { Authorization: "Bearer invalido" }, { Authorization: `Bearer ${expiredToken}` }]) {
      const response = await request(app).get(`${endpoint}/${owner.id}`).set(header);
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: { code: "UNAUTHORIZED", message: "Credenciales invalidas" } });
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("200 conductor propietario: DTO completo sin secretos", async () => {
    const response = await request(app).get(`${endpoint}/${owner.id}`).set("Authorization", `Bearer ${ownerToken}`);
    expect(response.status).toBe(200);
    const dto = conductorDetalleDtoSchema.parse(response.body);
    expect(dto.id).toBe(owner.id);
    expect(dto.usuarioId).toBe(owner.usuarioId);
    expect(dto.telefono).toBe(owner.telefono);
    expect(dto.vehiculo).not.toBeNull();
    expect(response.text.includes("hash")).toBe(false);
    expect(response.text.includes("pin")).toBe(false);
  });

  it("200 admin con el DTO", async () => {
    const response = await request(app).get(`${endpoint}/${owner.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(conductorDetalleDtoSchema.parse(response.body).id).toBe(owner.id);
  });

  it("200 acceso interno n8n aunque supervise a otro conductor", async () => {
    const response = await request(app).get(`${endpoint}/${owner.id}`).set("X-N8N-Token", n8nToken);
    expect(response.status).toBe(200);
    expect(conductorDetalleDtoSchema.parse(response.body).id).toBe(owner.id);
  });

  it("403 conductor ajeno", async () => {
    const response = await request(app).get(`${endpoint}/${owner.id}`).set("Authorization", `Bearer ${otherToken}`);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: { code: "FORBIDDEN", message: "Permiso denegado" } });
  });

  it("404 conductor inexistente o eliminado para admin y propietario", async () => {
    const notFound = { error: { code: "NOT_FOUND", message: "Conductor no encontrado" } };
    for (const id of [randomUUID(), deleted.id]) {
      for (const header of [{ Authorization: `Bearer ${adminToken}` }, { Authorization: `Bearer ${ownerToken}` }]) {
        const response = await request(app).get(`${endpoint}/${id}`).set(header);
        expect(response.status).toBe(404);
        expect(response.body).toEqual(notFound);
      }
    }
  });

  it("404 :id no UUID sin consultar la base", async () => {
    const query = vi.spyOn(prisma.conductor, "findFirst");
    const response = await request(app).get(`${endpoint}/no-es-un-uuid`).set("Authorization", `Bearer ${adminToken}`);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "NOT_FOUND", message: "Conductor no encontrado" } });
    expect(query).not.toHaveBeenCalled();
  });

  it("500 seguro ante fallo de consulta del detalle", async () => {
    vi.spyOn(prisma.conductor, "findFirst").mockRejectedValueOnce(new Error("SQL stack secreto simulado"));
    const response = await request(app).get(`${endpoint}/${owner.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
  });
});

describe("transiciones de estado PATCH", () => {
  const endpoint = "/api/conductores";
  let adminToken: string;
  let conductorToken: string;

  async function conductorPendiente(): Promise<{ id: string; usuarioId: string }> {
    const result = await registrarConductor(input());
    if (!result.ok) throw new Error("Fallo de fixture");
    return { id: result.conductor.id, usuarioId: result.conductor.usuarioId };
  }

  beforeAll(async () => {
    const { env } = await import("../src/config/env");
    const admin = await prisma.usuario.create({ data: { telefono: input().telefono, rol: "admin" } });
    adminToken = jwt.sign({}, env.JWT_SECRET, { subject: admin.id, algorithm: "HS256", expiresIn: "1h" });
    const cond = await conductorPendiente();
    conductorToken = jwt.sign({}, env.JWT_SECRET, { subject: cond.usuarioId, algorithm: "HS256", expiresIn: "1h" });
  }, 30000);

  it("401 sin JWT y 403 con JWT de conductor", async () => {
    const conductor = await conductorPendiente();
    const sinToken = await request(app).patch(`${endpoint}/${conductor.id}/aprobar`);
    expect(sinToken.status).toBe(401);
    const noAdmin = await request(app).patch(`${endpoint}/${conductor.id}/aprobar`)
      .set("Authorization", `Bearer ${conductorToken}`);
    expect(noAdmin.status).toBe(403);
  });

  it("ciclo completo: aprobar notifica, suspender y reactivar no notifican", async () => {
    const conductor = await conductorPendiente();
    const notif = await import("../src/modules/conductores/notificaciones");
    const spy = vi.spyOn(notif, "notificarConductor");
    const aprobar = await request(app).patch(`${endpoint}/${conductor.id}/aprobar`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(aprobar.status).toBe(200);
    expect(aprobar.body.estado).toBe("aprobado");
    expect(conductorDetalleDtoSchema.parse(aprobar.body).id).toBe(conductor.id);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: conductor.id }));
    const suspender = await request(app).patch(`${endpoint}/${conductor.id}/suspender`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(suspender.status).toBe(200);
    expect(suspender.body.estado).toBe("suspendido");
    expect(spy).toHaveBeenCalledTimes(1);
    const reactivar = await request(app).patch(`${endpoint}/${conductor.id}/reactivar`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(reactivar.status).toBe(200);
    expect(reactivar.body.estado).toBe("aprobado");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("rechazar desde pendiente notifica una sola vez", async () => {
    const conductor = await conductorPendiente();
    const notif = await import("../src/modules/conductores/notificaciones");
    const spy = vi.spyOn(notif, "notificarConductor");
    const rechazar = await request(app).patch(`${endpoint}/${conductor.id}/rechazar`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(rechazar.status).toBe(200);
    expect(rechazar.body.estado).toBe("rechazado");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  const invalidas: Array<[string, string]> = [
    ["suspender", "pendiente"], ["reactivar", "pendiente"], ["aprobar", "rechazado"], ["rechazar", "aprobado"],
    ["suspender", "rechazado"], ["reactivar", "rechazado"], ["aprobar", "suspendido"], ["rechazar", "suspendido"],
  ];

  it.each(invalidas)("409 INVALID_STATE_TRANSITION al %s desde %s", async (accion, desde) => {
    const conductor = await conductorPendiente();
    if (desde === "aprobado") {
      await request(app).patch(`${endpoint}/${conductor.id}/aprobar`).set("Authorization", `Bearer ${adminToken}`);
    } else if (desde === "rechazado") {
      await request(app).patch(`${endpoint}/${conductor.id}/rechazar`).set("Authorization", `Bearer ${adminToken}`);
    } else if (desde === "suspendido") {
      await request(app).patch(`${endpoint}/${conductor.id}/aprobar`).set("Authorization", `Bearer ${adminToken}`);
      await request(app).patch(`${endpoint}/${conductor.id}/suspender`).set("Authorization", `Bearer ${adminToken}`);
    }
    const response = await request(app).patch(`${endpoint}/${conductor.id}/${accion}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INVALID_STATE_TRANSITION");
    expect(response.body.error.message).toContain(desde);
    expect(response.body.error.message).toContain("estado");
  });

  it("404 para id no UUID, inexistente o eliminado", async () => {
    const inexistente = await request(app).patch(`${endpoint}/${randomUUID()}/aprobar`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(inexistente.status).toBe(404);
    const malformado = await request(app).patch(`${endpoint}/no-es-un-uuid/aprobar`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(malformado.status).toBe(404);
    const conductor = await conductorPendiente();
    await prisma.conductor.update({ where: { id: conductor.id }, data: { eliminadoEn: new Date() } });
    const eliminado = await request(app).patch(`${endpoint}/${conductor.id}/aprobar`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(eliminado.status).toBe(404);
  });

  it("un fallo simulado de notificacion no bloquea ni falla el endpoint", async () => {
    const conductor = await conductorPendiente();
    const notif = await import("../src/modules/conductores/notificaciones");
    vi.spyOn(notif, "notificarConductor").mockRejectedValueOnce(new Error("Fallo simulado de notificacion"));
    const response = await request(app).patch(`${endpoint}/${conductor.id}/aprobar`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.body.estado).toBe("aprobado");
  });
});

describe("PATCH /api/conductores/:id/vehiculo parcial para admin", () => {
  const endpoint = "/api/conductores";
  let adminToken: string;
  let conductorToken: string;

  async function conductorConVehiculo(): Promise<{ id: string; usuarioId: string }> {
    const result = await registrarConductor(input());
    if (!result.ok) throw new Error("Fallo de fixture");
    return { id: result.conductor.id, usuarioId: result.conductor.usuarioId };
  }

  async function vehiculoDe(conductorId: string) {
    return prisma.vehiculo.findFirstOrThrow({ where: { conductorId, eliminadoEn: null } });
  }

  beforeAll(async () => {
    const { env } = await import("../src/config/env");
    const admin = await prisma.usuario.create({ data: { telefono: input().telefono, rol: "admin" } });
    adminToken = jwt.sign({}, env.JWT_SECRET, { subject: admin.id, algorithm: "HS256", expiresIn: "1h" });
    const cond = await conductorConVehiculo();
    conductorToken = jwt.sign({}, env.JWT_SECRET, { subject: cond.usuarioId, algorithm: "HS256", expiresIn: "1h" });
  }, 30000);

  it("401 sin JWT y 403 con JWT de conductor", async () => {
    const conductor = await conductorConVehiculo();
    const sinToken = await request(app).patch(`${endpoint}/${conductor.id}/vehiculo`).send({ color: "Negro" });
    expect(sinToken.status).toBe(401);
    const noAdmin = await request(app).patch(`${endpoint}/${conductor.id}/vehiculo`).send({ color: "Negro" })
      .set("Authorization", `Bearer ${conductorToken}`);
    expect(noAdmin.status).toBe(403);
  });

  it("actualiza solo lo enviado y conserva lo omitido", async () => {
    const conductor = await conductorConVehiculo();
    const vehiculo = await vehiculoDe(conductor.id);
    const soloColor = await request(app).patch(`${endpoint}/${conductor.id}/vehiculo`)
      .set("Authorization", `Bearer ${adminToken}`).send({ color: "Negro" });
    expect(soloColor.status).toBe(200);
    const dto = conductorDetalleDtoSchema.parse(soloColor.body);
    expect(dto.id).toBe(conductor.id);
    expect(dto.vehiculo).toMatchObject({ id: vehiculo.id, color: "Negro" });
    expect(dto.vehiculo).toMatchObject({
      placa: vehiculo.placa, marca: vehiculo.marca, modelo: vehiculo.modelo,
      capacidadPasajeros: vehiculo.capacidadPasajeros,
    });
    const parcial = await request(app).patch(`${endpoint}/${conductor.id}/vehiculo`)
      .set("Authorization", `Bearer ${adminToken}`).send({ marca: "Nissan", capacidadPasajeros: 6 });
    expect(parcial.status).toBe(200);
    const final = await prisma.vehiculo.findUniqueOrThrow({ where: { id: vehiculo.id } });
    expect(final).toMatchObject({ marca: "Nissan", capacidadPasajeros: 6, color: "Negro" });
    expect(final.placa).toBe(vehiculo.placa);
    expect(final.modelo).toBe(vehiculo.modelo);
  });

  it("409 CONFLICT cuando la placa nueva colisiona (activa y soft-delete)", async () => {
    const primero = await conductorConVehiculo();
    const segundo = await conductorConVehiculo();
    const vehiculoPrimero = await vehiculoDe(primero.id);
    const placaSegundo = (await vehiculoDe(segundo.id)).placa;
    const activa = await request(app).patch(`${endpoint}/${primero.id}/vehiculo`)
      .set("Authorization", `Bearer ${adminToken}`).send({ placa: placaSegundo });
    expect(activa.status).toBe(409);
    expect(activa.body.error).toEqual({ code: "CONFLICT", message: "La placa ya esta registrada" });
    const vehiculoSegundo = await vehiculoDe(segundo.id);
    await prisma.vehiculo.update({ where: { id: vehiculoSegundo.id }, data: { eliminadoEn: new Date() } });
    const eliminada = await request(app).patch(`${endpoint}/${primero.id}/vehiculo`)
      .set("Authorization", `Bearer ${adminToken}`).send({ placa: placaSegundo });
    expect(eliminada.status).toBe(409);
    expect(eliminada.body.error.code).toBe("CONFLICT");
    const intacta = await prisma.vehiculo.findUniqueOrThrow({ where: { id: vehiculoPrimero.id } });
    expect(intacta.placa).not.toBe(placaSegundo);
  });

  const invalidos: Array<[string, object]> = [
    ["vacio", {}],
    ["placa vacia", { placa: "   " }],
    ["placa demasiado larga", { placa: "X".repeat(31) }],
    ["placa no string", { placa: 123 }],
    ["capacidad cero", { capacidadPasajeros: 0 }],
    ["capacidad superior", { capacidadPasajeros: 101 }],
    ["capacidad no entera", { capacidadPasajeros: 2.5 }],
    ["capacidad no number", { capacidadPasajeros: "4" }],
    ["campo extra", { color: "Negro", extra: true }],
  ];

  it.each(invalidos)("400 para body %s antes de tocar la base", async (_nombre, body) => {
    const conductor = await conductorConVehiculo();
    const vehiculo = await vehiculoDe(conductor.id);
    const findFirst = vi.spyOn(prisma.vehiculo, "findFirst");
    const update = vi.spyOn(prisma.vehiculo, "update");
    const response = await request(app).patch(`${endpoint}/${conductor.id}/vehiculo`)
      .set("Authorization", `Bearer ${adminToken}`).send(body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(findFirst).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    const intacto = await prisma.vehiculo.findUniqueOrThrow({ where: { id: vehiculo.id } });
    expect(intacto.placa).toBe(vehiculo.placa);
  });

  it("404 para id no UUID, conductor inexistente, eliminado o sin vehiculo activo", async () => {
    const noUuid = await request(app).patch(`${endpoint}/no-es-un-uuid/vehiculo`)
      .set("Authorization", `Bearer ${adminToken}`).send({ color: "Negro" });
    expect(noUuid.status).toBe(404);
    expect(noUuid.body.error.message).toBe("Conductor no encontrado");
    const inexistente = await request(app).patch(`${endpoint}/${randomUUID()}/vehiculo`)
      .set("Authorization", `Bearer ${adminToken}`).send({ color: "Negro" });
    expect(inexistente.status).toBe(404);
    const conductor = await conductorConVehiculo();
    await prisma.conductor.update({ where: { id: conductor.id }, data: { eliminadoEn: new Date() } });
    const eliminado = await request(app).patch(`${endpoint}/${conductor.id}/vehiculo`)
      .set("Authorization", `Bearer ${adminToken}`).send({ color: "Negro" });
    expect(eliminado.status).toBe(404);
    expect(eliminado.body.error.message).toBe("Conductor no encontrado");
    const sinVehiculo = await conductorConVehiculo();
    await prisma.vehiculo.update({
      where: { id: (await vehiculoDe(sinVehiculo.id)).id },
      data: { eliminadoEn: new Date() },
    });
    const vehiculoFaltante = await request(app).patch(`${endpoint}/${sinVehiculo.id}/vehiculo`)
      .set("Authorization", `Bearer ${adminToken}`).send({ color: "Negro" });
    expect(vehiculoFaltante.status).toBe(404);
    expect(vehiculoFaltante.body.error).toEqual({ code: "NOT_FOUND", message: "Vehiculo no encontrado" });
  });
});

describe("registrarConductor: persistencia atomica", () => {
  it.each(["1234", "012345"])("crea las tres filas y un DTO seguro con PIN %s", async (pin) => {
    const body = { ...input(), pin };
    const transaction = vi.spyOn(prisma, "$transaction");
    const result = await registrarConductor(body);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Registro fallido");
    expect(conductorDetalleDtoSchema.parse(result.conductor)).toEqual(result.conductor);
    const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: result.conductor.usuarioId } });
    expect(usuario.rol).toBe("conductor");
    expect(usuario.telefono).toBe(body.telefono);
    expect(bcrypt.getRounds(usuario.hashContrasena!)).toBe(12);
    expect(await bcrypt.compare(pin, usuario.hashContrasena!)).toBe(true);
    expect(await bcrypt.compare("999999", usuario.hashContrasena!)).toBe(false);
    expect(JSON.stringify(result).includes(usuario.hashContrasena!)).toBe(false);
    const perfil = await prisma.conductor.findUniqueOrThrow({ where: { id: result.conductor.id } });
    expect(result.conductor).toMatchObject({
      usuarioId: usuario.id, telefono: body.telefono, nombreCompleto: body.nombreCompleto,
      cedulaIdentidad: body.cedulaIdentidad, estado: "pendiente", estadoJornada: "no_iniciada",
      estadoDisponibilidad: "no_disponible", creadoEn: perfil.creadoEn.toISOString(),
      vehiculo: body.vehiculo,
    });
    expect(perfil.usuarioId).toBe(usuario.id);
    expect(await prisma.vehiculo.count({ where: { conductorId: perfil.id } })).toBe(1);
    expect(await prisma.vehiculo.findUnique({ where: { placa: body.vehiculo.placa } }))
      .toMatchObject({ ...body.vehiculo, conductorId: perfil.id, eliminadoEn: null });
  });

  it.each([false, true])("distingue duplicados y conserva filas existentes, eliminado=%s", async (eliminado) => {
    const original = input();
    const created = await registrarConductor(original);
    if (!created.ok) throw new Error("Fallo de fixture");
    if (eliminado) {
      await prisma.usuario.update({ where: { id: created.conductor.usuarioId }, data: { eliminadoEn: new Date() } });
      await prisma.vehiculo.update({ where: { id: created.conductor.vehiculo!.id }, data: { eliminadoEn: new Date() } });
    }
    const before = await prisma.usuario.findUnique({
      where: { telefono: original.telefono }, include: { conductor: { include: { vehiculos: true } } },
    });
    const telefono = { ...input(), telefono: original.telefono };
    expect(await registrarConductor(telefono)).toEqual({ ok: false, code: "CONFLICT", message: "El telefono ya esta registrado" });
    expect(await prisma.conductor.count({ where: { cedulaIdentidad: telefono.cedulaIdentidad } })).toBe(0);
    expect(await prisma.vehiculo.count({ where: { placa: telefono.vehiculo.placa } })).toBe(0);
    const placa = input();
    placa.vehiculo.placa = original.vehiculo.placa;
    expect(await registrarConductor(placa)).toEqual({ ok: false, code: "CONFLICT", message: "La placa ya esta registrada" });
    await assertAbsent(placa);
    expect(await registrarConductor(original)).toMatchObject({ ok: false, code: "CONFLICT" });
    const after = await prisma.usuario.findUnique({
      where: { telefono: original.telefono }, include: { conductor: { include: { vehiculos: true } } },
    });
    expect(JSON.stringify(after) === JSON.stringify(before)).toBe(true);
  }, 20000);

  it("un fallo simulado tras las tres escrituras revierte todas las filas", async () => {
    const body = input();
    const failure = new Error("Fallo simulado de transaccion");
    const transaction = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback) => transaction(async (tx) => {
      await callback(tx);
      expect(await tx.usuario.count({ where: { telefono: body.telefono } })).toBe(1);
      expect(await tx.conductor.count({ where: { cedulaIdentidad: body.cedulaIdentidad } })).toBe(1);
      expect(await tx.vehiculo.count({ where: { placa: body.vehiculo.placa } })).toBe(1);
      throw failure;
    }));
    await expect(registrarConductor(body)).rejects.toBe(failure);
    await assertAbsent(body);
    expect(await prisma.vehiculo.count({ where: { placa: body.vehiculo.placa } })).toBe(0);
  });

  it.each(["telefono", "placa"] as const)("fallback sin meta.target resuelve %s eliminado despues del rollback", async (field) => {
    const original = input();
    const created = await registrarConductor(original);
    if (!created.ok) throw new Error("Fallo de fixture");
    await prisma.usuario.update({ where: { id: created.conductor.usuarioId }, data: { eliminadoEn: new Date() } });
    await prisma.vehiculo.update({ where: { id: created.conductor.vehiculo!.id }, data: { eliminadoEn: new Date() } });
    const body = input();
    if (field === "telefono") body.telefono = original.telefono;
    else body.vehiculo.placa = original.vehiculo.placa;
    const transaction = prisma.$transaction.bind(prisma);
    let rolledBack = false;
    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback) => {
      try { return await transaction(callback); }
      catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
        rolledBack = true;
        throw new Prisma.PrismaClientKnownRequestError("Unicidad simulada sin columna", {
          code: "P2002", clientVersion: Prisma.prismaVersion.client,
        });
      }
    });
    const findUsuario = prisma.usuario.findUnique.bind(prisma.usuario);
    const lookup = vi.spyOn(prisma.usuario, "findUnique").mockImplementation((args) => {
      expect(rolledBack).toBe(true);
      return findUsuario(args);
    });
    const result = await registrarConductor(body);
    expect(lookup).toHaveBeenCalledWith({ where: { telefono: body.telefono }, select: { id: true } });
    expect(result).toEqual({
      ok: false, code: "CONFLICT", message: field === "telefono" ? "El telefono ya esta registrado" : "La placa ya esta registrada",
    });
    expect(await prisma.conductor.count({ where: { cedulaIdentidad: body.cedulaIdentidad } })).toBe(0);
    if (field === "placa") await assertAbsent(body);
  }, 15000);

  it.each(["telefono", "placa"])("usa meta.target %s sin consultas de fallback", async (field) => {
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("Unicidad", {
      code: "P2002", clientVersion: Prisma.prismaVersion.client, meta: { target: [field] },
    }));
    const usuario = vi.spyOn(prisma.usuario, "findUnique");
    const vehiculo = vi.spyOn(prisma.vehiculo, "findUnique");
    expect(await registrarConductor(input())).toEqual({
      ok: false, code: "CONFLICT", message: field === "telefono" ? "El telefono ya esta registrado" : "La placa ya esta registrada",
    });
    expect(usuario).not.toHaveBeenCalled();
    expect(vehiculo).not.toHaveBeenCalled();
  });

  it("propaga P2002 no identificable sin inventar un conflicto", async () => {
    const error = new Prisma.PrismaClientKnownRequestError("Unicidad no identificada", {
      code: "P2002", clientVersion: Prisma.prismaVersion.client, meta: { target: ["id"] },
    });
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(error);
    const body = input();
    await expect(registrarConductor(body)).rejects.toBe(error);
    await assertAbsent(body);
  });

  it("un fallo de consulta en fallback se propaga como error interno", async () => {
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("Unicidad", {
      code: "P2002", clientVersion: Prisma.prismaVersion.client,
    }));
    const failure = new Error("Fallo simulado de consulta");
    vi.spyOn(prisma.usuario, "findUnique").mockRejectedValueOnce(failure);
    await expect(registrarConductor(input())).rejects.toBe(failure);
  });

  it.each(["telefono", "placa"] as const)("dos registros concurrentes con %s igual dejan un solo ganador", async (field) => {
    const first = input();
    const second = input();
    if (field === "telefono") second.telefono = first.telefono;
    else second.vehiculo.placa = first.vehiculo.placa;
    const results = await Promise.all([registrarConductor(first), registrarConductor(second)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{
      ok: false, code: "CONFLICT", message: field === "telefono" ? "El telefono ya esta registrado" : "La placa ya esta registrada",
    }]);
    expect(await prisma.usuario.count({ where: { telefono: { in: [first.telefono, second.telefono] } } })).toBe(1);
    expect(await prisma.conductor.count({ where: { cedulaIdentidad: { in: [first.cedulaIdentidad, second.cedulaIdentidad] } } })).toBe(1);
    expect(await prisma.vehiculo.count({ where: { placa: { in: [first.vehiculo.placa, second.vehiculo.placa] } } })).toBe(1);
  }, 20000);
});

describe("POST /api/conductores publico", () => {
  const endpoint = "/api/conductores";
  const validation = { error: { code: "VALIDATION_ERROR", message: "Entrada invalida" } };
  const internal = { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } };

  it.each(["1234", "012345"])("201 sin autenticacion, persiste y devuelve DTO sin secretos (PIN %s)", async (pin) => {
    const body = { ...input(), pin };
    const response = await request(app).post(endpoint).send({
      ...body, telefono: ` ${body.telefono} `, nombreCompleto: ` ${body.nombreCompleto} `,
      cedulaIdentidad: ` ${body.cedulaIdentidad} `,
      vehiculo: { ...body.vehiculo, placa: ` ${body.vehiculo.placa} `, color: " Blanco " },
    });
    expect(response.status).toBe(201);
    expect(response.headers["content-type"]).toMatch(/json/);
    const dto = conductorDetalleDtoSchema.parse(response.body);
    expect(dto).toMatchObject({
      telefono: body.telefono, nombreCompleto: body.nombreCompleto, cedulaIdentidad: body.cedulaIdentidad,
      estado: "pendiente", estadoJornada: "no_iniciada", estadoDisponibilidad: "no_disponible",
      vehiculo: body.vehiculo,
    });
    const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: dto.usuarioId } });
    expect(usuario.telefono).toBe(body.telefono);
    expect(usuario.rol).toBe("conductor");
    expect(bcrypt.getRounds(usuario.hashContrasena!)).toBe(12);
    expect(await bcrypt.compare(pin, usuario.hashContrasena!)).toBe(true);
    expect(response.text.includes(usuario.hashContrasena!)).toBe(false);
    expect(response.body).not.toHaveProperty("pin");
    expect(response.body).not.toHaveProperty("token");
    const perfil = await prisma.conductor.findUniqueOrThrow({ where: { id: dto.id } });
    expect(perfil.usuarioId).toBe(dto.usuarioId);
    expect(dto.creadoEn).toBe(perfil.creadoEn.toISOString());
    expect(await prisma.vehiculo.findUnique({ where: { id: dto.vehiculo!.id } }))
      .toMatchObject({ ...body.vehiculo, conductorId: dto.id });
  });

  it.each([false, true])("409 diferencia telefono y placa existentes, eliminado=%s", async (eliminado) => {
    const original = input();
    const created = await registrarConductor(original);
    if (!created.ok) throw new Error("Fallo de fixture");
    if (eliminado) {
      await prisma.usuario.update({ where: { id: created.conductor.usuarioId }, data: { eliminadoEn: new Date() } });
      await prisma.vehiculo.update({ where: { id: created.conductor.vehiculo!.id }, data: { eliminadoEn: new Date() } });
    }
    for (const field of ["telefono", "placa", "ambos"]) {
      const body = input();
      if (field !== "placa") body.telefono = original.telefono;
      if (field !== "telefono") body.vehiculo.placa = original.vehiculo.placa;
      const response = await request(app).post(endpoint).send(body);
      expect(response.status).toBe(409);
      expect(response.body).toEqual({ error: {
        code: "CONFLICT", message: field === "placa" ? "La placa ya esta registrada" : "El telefono ya esta registrado",
      } });
      expect(await prisma.conductor.count({ where: { cedulaIdentidad: body.cedulaIdentidad } })).toBe(0);
      if (field === "placa") await assertAbsent(body);
    }
  }, 20000);

  it("400 para entradas invalidas antes de invocar servicio, bcrypt o base de datos", async () => {
    const body = input();
    const invalid: unknown[] = [undefined, null, [], "texto", 42, {},
      { ...body, rol: "admin" }, { ...body, estado: "aprobado" }, { ...body, extra: true },
      { ...body, vehiculo: { ...body.vehiculo, conductorId: randomUUID() } },
      { ...body, vehiculo: { ...body.vehiculo, extra: true } },
    ];
    for (const field of Object.keys(body)) {
      const missing: Record<string, unknown> = { ...body };
      delete missing[field];
      invalid.push(missing);
    }
    for (const [field, max] of [["telefono", 30], ["nombreCompleto", 100], ["cedulaIdentidad", 50]] as const) {
      for (const value of ["", "   ", "x".repeat(max + 1), null, 123, [], {}]) invalid.push({ ...body, [field]: value });
    }
    for (const pin of ["", "123", "1234567", "abcd", "12.34", " 1234", "1234\n", null, 1234]) {
      invalid.push({ ...body, pin });
    }
    for (const vehiculo of [null, [], "texto", {}]) invalid.push({ ...body, vehiculo });
    for (const field of Object.keys(body.vehiculo)) {
      const missing: Record<string, unknown> = { ...body.vehiculo };
      delete missing[field];
      invalid.push({ ...body, vehiculo: missing });
    }
    for (const field of ["placa", "marca", "modelo", "color"]) {
      for (const value of ["", "   ", "x".repeat(31), null, 123, [], {}]) {
        invalid.push({ ...body, vehiculo: { ...body.vehiculo, [field]: value } });
      }
    }
    for (const capacidadPasajeros of [0, 101, -1, 1.5, "4", null, true]) {
      invalid.push({ ...body, vehiculo: { ...body.vehiculo, capacidadPasajeros } });
    }
    const service = await import("../src/modules/conductores/conductores.service");
    const register = vi.spyOn(service, "registrarConductor");
    const hash = vi.spyOn(bcrypt, "hash");
    const transaction = vi.spyOn(prisma, "$transaction");
    const usuario = vi.spyOn(prisma.usuario, "findUnique");
    const vehiculo = vi.spyOn(prisma.vehiculo, "findUnique");
    for (const value of invalid) {
      const req = request(app).post(endpoint);
      const response = value === undefined ? await req : await req.set("Content-Type", "application/json").send(JSON.stringify(value));
      expect(response.status).toBe(400);
      expect(response.body).toEqual(validation);
    }
    const malformed = await request(app).post(endpoint).set("Content-Type", "application/json").send('{"pin":');
    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual(validation);
    expect(register).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(usuario).not.toHaveBeenCalled();
    expect(vehiculo).not.toHaveBeenCalled();
    await assertAbsent(body);
    expect(await prisma.vehiculo.count({ where: { placa: body.vehiculo.placa } })).toBe(0);
  }, 15000);

  it("500 seguro ante fallo de base de datos sin crear registros", async () => {
    const body = input();
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("SQL postgres://fake:secret@invalid/db stack"));
    const response = await request(app).post(endpoint).send(body);
    expect(response.status).toBe(500);
    expect(response.body).toEqual(internal);
    await assertAbsent(body);
    expect(await prisma.vehiculo.count({ where: { placa: body.vehiculo.placa } })).toBe(0);
  });

  it("500 seguro y rollback cuando falla tras las escrituras", async () => {
    const body = input();
    const transaction = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback) => transaction(async (tx) => {
      await callback(tx);
      throw new Error("SQL stack detalle privado simulado");
    }));
    const response = await request(app).post(endpoint).send(body);
    expect(response.status).toBe(500);
    expect(response.body).toEqual(internal);
    await assertAbsent(body);
    expect(await prisma.vehiculo.count({ where: { placa: body.vehiculo.placa } })).toBe(0);
  });
});
