import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";
import app from "../src/app";
import { candidatosDtoSchema } from "../src/modules/motor-asignacion/motor-asignacion.schema";
import { barridoInicial } from "../src/modules/solicitudes/solicitudes.service";

type EstadoConductor = "pendiente" | "aprobado" | "rechazado" | "suspendido";
type EstadoJornada = "no_iniciada" | "activa" | "finalizada";

let prisma: PrismaClient;
let n8nToken: string;
let jwtSecret: string;
let adminJwt: string;

let pasajeroSinAvisoId: string;
let pasajeroEliminadoId: string;

const punto = { latitudRecogida: -17.7833, longitudRecogida: -63.1821 };
const destino = "Plaza 24 de Septiembre";
// Prefijo para identificar los registros propios de esta suite (limpieza determinista).
const prefijo = "sp10";

const conductoresCreados: string[] = [];
const usuariosCreados: string[] = [];
const pasajerosCreados: string[] = [];
const solicitudesCreadas: string[] = [];

let c1: string; // mejor candidato (1.12 km)
let c2: string; // 2.65 km
let c3: string; // 4.19 km
let c4: string; // 4.96 km
let cFueraRadio: string;

let usuarioDriver: Record<string, string> = { conductorId: "", usuarioId: "" };
let usuarioAdmin: string;

async function crearConductor(opciones: {
  estado: EstadoConductor;
  jornada?: EstadoJornada;
  disponibilidad?: "disponible" | "no_disponible" | "solicitud_pendiente" | "en_servicio";
  ubicacion?: { latitud: number; longitud: number; antiguedadMs?: number; esValida?: boolean };
}): Promise<{ conductorId: string; usuarioId: string }> {
  const sufijo = `${prefijo}-${randomUUID().replace(/-/g, "").slice(0, 6)}`;
  const placa = randomUUID().replace(/-/g, "").slice(0, 30);
  const usuario = await prisma.usuario.create({ data: { telefono: sufijo, rol: "conductor" }, select: { id: true } });
  const conductor = await prisma.conductor.create({
    data: {
      usuarioId: usuario.id,
      nombreCompleto: `${sufijo}-conductor`,
      cedulaIdentidad: randomUUID(),
      estado: opciones.estado,
      estadoJornada: opciones.jornada ?? "activa",
      estadoDisponibilidad: opciones.disponibilidad ?? "disponible",
      vehiculos: { create: { placa, marca: "Toyota", modelo: "Corolla", color: "Blanco", capacidadPasajeros: 4 } },
      ...(opciones.ubicacion ? {
        ubicaciones: { create: [{
          latitud: opciones.ubicacion.latitud,
          longitud: opciones.ubicacion.longitud,
          horaRegistro: new Date(Date.now() - (opciones.ubicacion.antiguedadMs ?? 30000)),
          esValida: opciones.ubicacion.esValida ?? true,
        }] },
      } : {}),
    },
    select: { id: true, usuarioId: true },
  });
  usuariosCreados.push(usuario.id);
  conductoresCreados.push(conductor.id);
  return { conductorId: conductor.id, usuarioId: conductor.usuarioId };
}

async function crearPasajero(conAviso: boolean, eliminado = false): Promise<string> {
  const pasajero = await prisma.pasajero.create({
    data: {
      whatsappId: `${prefijo}-${randomUUID().replace(/-/g, "").slice(0, 6)}`,
      nombre: "Pasajero de solicitudes",
      aceptacionAvisoPrivacidad: conAviso ? new Date() : null,
      eliminadoEn: eliminado ? new Date() : null,
    },
    select: { id: true },
  });
  pasajerosCreados.push(pasajero.id);
  return pasajero.id;
}

function token(subject: string) {
  return `Bearer ${jwt.sign({}, jwtSecret, { subject, expiresIn: "1h" })}`;
}

const n8n = () => ({ "X-N8N-Token": n8nToken });

async function restaurarDisponibles() {
  await prisma.conductor.updateMany({
    where: { id: { in: [c1, c2, c3, c4, cFueraRadio] } },
    data: { estadoDisponibilidad: "disponible" },
  });
}

function crearSolicitudApi(pasajeroId: string, sendDestino = true) {
  return request(app).post("/api/solicitudes").set(n8n()).send({
    pasajeroId,
    latitudRecogida: punto.latitudRecogida,
    longitudRecogida: punto.longitudRecogida,
    ...(sendDestino ? { destino } : {}),
  });
}

async function reclutarConductorYCrearSolicitud() {
  const pasajeroId = await crearPasajero(true);
  const respuesta = await crearSolicitudApi(pasajeroId);
  expect(respuesta.status).toBe(201);
  return { pasajeroId, solicitudId: respuesta.body.id as string, respuesta };
}

beforeAll(async () => {
  const url = inject("adminTestDatabaseUrl");
  if (!url || process.env.DATABASE_URL !== url) throw new Error("Falta destino validado por el setup");
  prisma = (await import("../src/config/prisma")).prisma;
  const { env } = await import("../src/config/env");
  n8nToken = env.N8N_API_TOKEN;
  jwtSecret = env.JWT_SECRET;

  await prisma.configuracion.deleteMany({ where: { id: 1 } });
  await prisma.configuracion.create({
    data: { id: 1, nombreEmpresa: "Solicitudes - Pruebas", radioMaximoBusquedaKm: 5 },
  });
  expect(await prisma.configuracion.count({ where: { id: 1 } })).toBe(1);

  // Limpieza determinista de restos de corridas abortadas de esta suite.
  await prisma.solicitudConductorRechazado.deleteMany({
    where: { solicitud: { pasajero: { whatsappId: { startsWith: prefijo } } } },
  });
  await prisma.solicitud.deleteMany({
    where: { pasajero: { whatsappId: { startsWith: prefijo } } },
  });
  await prisma.ubicacionConductor.deleteMany({
    where: { conductor: { nombreCompleto: { startsWith: prefijo } } },
  });
  await prisma.vehiculo.deleteMany({
    where: { conductor: { nombreCompleto: { startsWith: prefijo } } },
  });
  await prisma.pasajero.deleteMany({ where: { whatsappId: { startsWith: prefijo } } });
  await prisma.conductor.deleteMany({ where: { nombreCompleto: { startsWith: prefijo } } });
  await prisma.usuario.deleteMany({ where: { telefono: { startsWith: prefijo } } });

  pasajeroSinAvisoId = await crearPasajero(false);
  pasajeroEliminadoId = await crearPasajero(true, true);

  // Elegibles dentro del radio 5: 1.12 / 2.65 / 4.19 / 4.96 km.
  c1 = (await crearConductor({ estado: "aprobado", ubicacion: { latitud: -17.79, longitud: -63.19 } })).conductorId;
  c2 = (await crearConductor({ estado: "aprobado", ubicacion: { latitud: -17.8, longitud: -63.2 } })).conductorId;
  c3 = (await crearConductor({ estado: "aprobado", ubicacion: { latitud: -17.81, longitud: -63.21 } })).conductorId;
  c4 = (await crearConductor({ estado: "aprobado", ubicacion: { latitud: -17.815, longitud: -63.215 } })).conductorId;
  cFueraRadio = (await crearConductor({ estado: "aprobado", ubicacion: { latitud: -17.85, longitud: -63.28 } })).conductorId;
  // Driver principal usado en el ciclo feliz y rechazos.
  usuarioDriver = (await prisma.conductor.findUniqueOrThrow({
    where: { id: c1 }, select: { id: true, usuarioId: true },
  }));
  const admin = await prisma.usuario.create({
    data: {
      telefono: `${prefijo}-admin-${randomUUID().replace(/-/g, "").slice(0, 6)}`,
      rol: "admin",
    },
    select: { id: true },
  });
  usuarioAdmin = admin.id;
  usuariosCreados.push(usuarioAdmin);
  adminJwt = token(usuarioAdmin);
}, 30000);

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  if (!prisma) return;
  try {
    await prisma.solicitudConductorRechazado.deleteMany({
      where: { solicitudId: { in: solicitudesCreadas } },
    });
    await prisma.solicitud.deleteMany({ where: { pasajeroId: { in: pasajerosCreados } } });
    for (const id of solicitudesCreadas) {
      await prisma.solicitud.deleteMany({ where: { id } });
    }
    await prisma.ubicacionConductor.deleteMany({ where: { conductorId: { in: conductoresCreados } } });
    await prisma.vehiculo.deleteMany({ where: { conductorId: { in: conductoresCreados } } });
    await prisma.pasajero.deleteMany({ where: { id: { in: pasajerosCreados } } });
    await prisma.conductor.deleteMany({ where: { id: { in: conductoresCreados } } });
    await prisma.usuario.deleteMany({ where: { id: { in: usuariosCreados } } });
    await prisma.configuracion.deleteMany({ where: { id: 1 } });
    expect(await prisma.solicitud.count({ where: { id: { in: solicitudesCreadas } } })).toBe(0);
    expect(await prisma.pasajero.count({ where: { id: { in: pasajerosCreados } } })).toBe(0);
    expect(await prisma.conductor.count({ where: { id: { in: conductoresCreados } } })).toBe(0);
    expect(await prisma.usuario.count({ where: { id: { in: usuariosCreados } } })).toBe(0);
    expect(await prisma.configuracion.count({ where: { id: 1 } })).toBe(0);
  } finally {
    await prisma.$disconnect();
  }
});

describe("ciclo feliz (crear -> candidatos -> seleccionar -> aceptar -> finalizar)", () => {
  it("crea en buscando sin conductor ni expiraEn (Regla 1)", async () => {
    const pasajeroId = await crearPasajero(true);
    pasajerosCreados.push(pasajeroId);
    const respuesta = await crearSolicitudApi(pasajeroId);
    expect(respuesta.status).toBe(201);
    expect(respuesta.body).toMatchObject({
      pasajeroId,
      conductorAsignadoId: null,
      estado: "buscando",
      latitudRecogida: punto.latitudRecogida,
      longitudRecogida: punto.longitudRecogida,
      destino,
      expiraEn: null,
      aceptadaEn: null,
      finalizadaEn: null,
    });
    solicitudesCreadas.push(respuesta.body.id);
    expect(await prisma.solicitud.count({ where: { id: respuesta.body.id, eliminadoEn: null } })).toBe(1);
  }, 20000);

  it("obtener candidatos devuelve el top 3 con el DTO del motor", async () => {
    const { solicitudId } = await reclutarConductorYCrearSolicitud();
    solicitudesCreadas.push(solicitudId);
    const respuesta = await request(app).get(`/api/solicitudes/${solicitudId}/candidatos`).set(n8n());
    expect(respuesta.status).toBe(200);
    expect(candidatosDtoSchema.parse(respuesta.body)).toEqual(respuesta.body);
    expect(respuesta.body.candidatos.map(({ conductorId }: { conductorId: string }) => conductorId))
      .toEqual([c1, c2, c3]);
  }, 15000);

  it("seleccionar conductor reserva con ventana de 1 minuto de expiracion (Regla 6)", async () => {
    const { solicitudId } = await reclutarConductorYCrearSolicitud();
    solicitudesCreadas.push(solicitudId);
    await restaurarDisponibles();
    const antes = Date.now();
    const respuesta = await request(app)
      .post(`/api/solicitudes/${solicitudId}/seleccionar-conductor`)
      .set(n8n()).send({ conductorId: c1 });
    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toMatchObject({ estado: "esperando_respuesta", conductorAsignadoId: c1 });
    const expira = new Date(respuesta.body.expiraEn).getTime();
    expect(expira - antes).toBeGreaterThanOrEqual(55_000);
    expect(expira - antes).toBeLessThanOrEqual(65_000);
    const conductor = await prisma.conductor.findUniqueOrThrow({ where: { id: c1 }, select: { estadoDisponibilidad: true } });
    expect(conductor.estadoDisponibilidad).toBe("solicitud_pendiente");
  }, 15000);

  it("el detalle expone conductor y vehiculo sin telefono", async () => {
    const { solicitudId } = await reclutarConductorYCrearSolicitud();
    solicitudesCreadas.push(solicitudId);
    await restaurarDisponibles();
    await request(app).post(`/api/solicitudes/${solicitudId}/seleccionar-conductor`).set(n8n()).send({ conductorId: c1 });
    const respuesta = await request(app).get(`/api/solicitudes/${solicitudId}`).set(n8n());
    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toMatchObject({
      estado: "esperando_respuesta",
      pasajero: { id: expect.any(String), nombre: "Pasajero de solicitudes" },
      conductorAsignado: {
        id: c1,
        nombreCompleto: expect.any(String),
        vehiculo: { placa: expect.any(String), marca: "Toyota" },
      },
    });
    expect(Object.keys(respuesta.body.conductorAsignado).sort())
      .toEqual(["id", "nombreCompleto", "vehiculo"]);
    expect(Object.keys(respuesta.body.conductorAsignado.vehiculo).sort())
      .toEqual(["capacidadPasajeros", "color", "marca", "modelo", "placa"]);
  }, 20000);

  it("aceptar pasa a en_servicio y ponen al conductor en_servicio", async () => {
    const { solicitudId } = await reclutarConductorYCrearSolicitud();
    solicitudesCreadas.push(solicitudId);
    await restaurarDisponibles();
    await request(app).post(`/api/solicitudes/${solicitudId}/seleccionar-conductor`).set(n8n()).send({ conductorId: c1 });
    const respuesta = await request(app)
      .post(`/api/solicitudes/${solicitudId}/responder`)
      .set({ Authorization: token(usuarioDriver.usuarioId) }).send({ acepta: true });
    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toMatchObject({ estado: "en_servicio", aceptadaEn: expect.any(String), expiraEn: null });
    const conductor = await prisma.conductor.findUniqueOrThrow({ where: { id: c1 }, select: { estadoDisponibilidad: true } });
    expect(conductor.estadoDisponibilidad).toBe("en_servicio");
  }, 20000);

  it("finalizar cierra el ciclo y deja disponible al conductor con jornada activa (Regla 11)", async () => {
    const { solicitudId } = await reclutarConductorYCrearSolicitud();
    solicitudesCreadas.push(solicitudId);
    await restaurarDisponibles();
    await request(app).post(`/api/solicitudes/${solicitudId}/seleccionar-conductor`).set(n8n()).send({ conductorId: c1 });
    await request(app)
      .post(`/api/solicitudes/${solicitudId}/responder`)
      .set({ Authorization: token(usuarioDriver.usuarioId) }).send({ acepta: true });
    const respuesta = await request(app)
      .post(`/api/solicitudes/${solicitudId}/finalizar`)
      .set({ Authorization: token(usuarioDriver.usuarioId) }).send({});
    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toMatchObject({ estado: "finalizada", finalizadaEn: expect.any(String) });
    const conductor = await prisma.conductor.findUniqueOrThrow({ where: { id: c1 }, select: { estadoDisponibilidad: true, estadoJornada: true } });
    expect(conductor.estadoJornada).toBe("activa");
    expect(conductor.estadoDisponibilidad).toBe("disponible");
  }, 20000);
});

describe("rechazo y re-busqueda (Regla 7)", () => {
  it("rechazar registra exclusion, libera al conductor y la re-busqueda lo excluye", async () => {
    const { solicitudId } = await reclutarConductorYCrearSolicitud();
    solicitudesCreadas.push(solicitudId);
    await restaurarDisponibles();
    await request(app).post(`/api/solicitudes/${solicitudId}/seleccionar-conductor`).set(n8n()).send({ conductorId: c1 });

    const rechazo = await request(app)
      .post(`/api/solicitudes/${solicitudId}/responder`)
      .set({ Authorization: token(usuarioDriver.usuarioId) }).send({ acepta: false });
    expect(rechazo.status).toBe(200);
    expect(rechazo.body).toMatchObject({ estado: "buscando", conductorAsignadoId: null, expiraEn: null });

    const exclusion = await prisma.solicitudConductorRechazado.findFirst({
      where: { solicitudId, conductorId: c1, motivo: "rechazo" }, select: { id: true },
    });
    expect(exclusion).not.toBeNull();
    const conductor = await prisma.conductor.findUniqueOrThrow({ where: { id: c1 }, select: { estadoDisponibilidad: true } });
    expect(conductor.estadoDisponibilidad).toBe("disponible");

    const candidatos = await request(app).get(`/api/solicitudes/${solicitudId}/candidatos`).set(n8n());
    expect(candidatos.status).toBe(200);
    expect(candidatos.body.candidatos.map(({ conductorId }: { conductorId: string }) => conductorId))
      .toEqual([c2, c3, c4]);
  }, 20000);
});

describe("expiracion (Regla 8) e integridad del job", () => {
  async function sembrarEsperando(expiraEn: Date, conductorId: string) {
    const pasajeroId = await crearPasajero(true);
    const solicitud = await prisma.solicitud.create({
      data: {
        pasajeroId,
        estado: "esperando_respuesta",
        conductorAsignadoId: conductorId,
        latitudRecogida: punto.latitudRecogida,
        longitudRecogida: punto.longitudRecogida,
        expiraEn,
      },
      select: { id: true },
    });
    solicitudesCreadas.push(solicitud.id);
    return solicitud.id;
  }

  it("barridoInicial expira las vencidas: exclusion expiracion y conductor liberado", async () => {
    const conductorEstado = await prisma.conductor.update({
      where: { id: c2 }, data: { estadoDisponibilidad: "solicitud_pendiente" }, select: { id: true },
    });
    const solicitudId = await sembrarEsperando(new Date(Date.now() - 1000), conductorEstado.id);

    await barridoInicial(new Date());

    const solicitud = await prisma.solicitud.findUniqueOrThrow({ where: { id: solicitudId }, select: { estado: true, conductorAsignadoId: true, expiraEn: true } });
    expect(solicitud).toMatchObject({ estado: "buscando", conductorAsignadoId: null, expiraEn: null });
    const exclusion = await prisma.solicitudConductorRechazado.findFirst({
      where: { solicitudId, conductorId: c2, motivo: "expiracion" }, select: { id: true },
    });
    expect(exclusion).not.toBeNull();
    const conductor = await prisma.conductor.findUniqueOrThrow({ where: { id: c2 }, select: { estadoDisponibilidad: true } });
    expect(conductor.estadoDisponibilidad).toBe("disponible");
  }, 20000);

  it("la expiracion es idempotente ante solicitudes ya liberadas", async () => {
    const solicitudId = await sembrarEsperando(new Date(Date.now() - 5000), c3);
    await barridoInicial(new Date());
    await expect(barridoInicial(new Date())).resolves.not.toThrow();
    const solicitud = await prisma.solicitud.findUniqueOrThrow({ where: { id: solicitudId }, select: { estado: true } });
    expect(solicitud.estado).toBe("buscando");
    expect(await prisma.solicitudConductorRechazado.count({ where: { solicitudId } })).toBe(1);
  }, 20000);

  it("barridoInicial reprograma las pendientes sin expirarlas", async () => {
    const pasajeroId = await crearPasajero(true);
    const solicitud = await prisma.solicitud.create({
      data: {
        pasajeroId,
        estado: "esperando_respuesta",
        conductorAsignadoId: c3,
        latitudRecogida: punto.latitudRecogida,
        longitudRecogida: punto.longitudRecogida,
        expiraEn: new Date(Date.now() + 60_000),
      },
      select: { id: true },
    });
    solicitudesCreadas.push(solicitud.id);
    await barridoInicial(new Date());
    const estado = await prisma.solicitud.findUniqueOrThrow({ where: { id: solicitud.id }, select: { estado: true } });
    expect(estado.estado).toBe("esperando_respuesta");
  }, 20000);
});

describe("sin conductor (n8n) y estados terminales", () => {
  it("marcarSinConductor pasa a sin_conductor y permite una nueva solicitud (Regla 1 terminal)", async () => {
    const { pasajeroId, solicitudId } = await reclutarConductorYCrearSolicitud();
    solicitudesCreadas.push(solicitudId);
    const respuesta = await request(app).post(`/api/solicitudes/${solicitudId}/sin-conductor`).set(n8n()).send({});
    expect(respuesta.status).toBe(200);
    expect(respuesta.body).toMatchObject({ estado: "sin_conductor", conductorAsignadoId: null });

    const segunda = await crearSolicitudApi(pasajeroId);
    expect(segunda.status).toBe(201);
    solicitudesCreadas.push(segunda.body.id);
  }, 20000);

  it("crear en estado que no sea buscando responde ESTADO_INVALIDO", async () => {
    const { solicitudId } = await reclutarConductorYCrearSolicitud();
    solicitudesCreadas.push(solicitudId);
    await restaurarDisponibles();
    const respuesta = await request(app)
      .post(`/api/solicitudes/${solicitudId}/seleccionar-conductor`)
      .set(n8n()).send({ conductorId: c2 });
    expect(respuesta.status).toBe(200);
    const segundo = await request(app)
      .post(`/api/solicitudes/${solicitudId}/seleccionar-conductor`)
      .set(n8n()).send({ conductorId: c3 });
    expect(segundo.status).toBe(409);
    expect(segundo.body).toEqual({
      error: { code: "ESTADO_INVALIDO", message: "Transicion no permitida desde el estado actual de la solicitud" },
    });
  }, 30000);

  it("seleccionar a un conductor fuera del radio responde CANDIDATO_INVALIDO", async () => {
    const { solicitudId } = await reclutarConductorYCrearSolicitud();
    solicitudesCreadas.push(solicitudId);
    const respuesta = await request(app)
      .post(`/api/solicitudes/${solicitudId}/seleccionar-conductor`)
      .set(n8n()).send({ conductorId: cFueraRadio });
    expect(respuesta.status).toBe(409);
    expect(respuesta.body).toEqual({
      error: { code: "CANDIDATO_INVALIDO", message: "El conductor no es un candidato elegible" },
    });
  }, 20000);
});

describe("Regla de negocio 0 (aviso de privacidad) y 1 (activa) en la creacion", () => {
  it("pasajero sin aviso aceptado recibe 409 AVISO_NO_ACEPTADO", async () => {
    const respuesta = await crearSolicitudApi(pasajeroSinAvisoId);
    expect(respuesta.status).toBe(409);
    expect(respuesta.body).toEqual({
      error: { code: "AVISO_NO_ACEPTADO", message: "El pasajero no acepto el aviso de privacidad" },
    });
  }, 15000);

  it("pasajero eliminado recibe 404 NOT_FOUND", async () => {
    const respuesta = await crearSolicitudApi(pasajeroEliminadoId);
    expect(respuesta.status).toBe(404);
    expect(respuesta.body).toEqual({ error: { code: "NOT_FOUND", message: "Pasajero no encontrado" } });
  }, 15000);

  it("pasajero con solicitud activa recibe 409 SOLICITUD_ACTIVA", async () => {
    const { pasajeroId } = await reclutarConductorYCrearSolicitud();
    const respuesta = await crearSolicitudApi(pasajeroId);
    expect(respuesta.status).toBe(409);
    expect(respuesta.body).toEqual({
      error: { code: "SOLICITUD_ACTIVA", message: "El pasajero ya tiene una solicitud activa" },
    });
  }, 20000);
});

describe("permisos y saneamiento", () => {
  it("anonimo recibe 401 en crear, detalle, seleccionar, responder y sin-conductor", async () => {
    const { solicitudId } = await reclutarConductorYCrearSolicitud();
    solicitudesCreadas.push(solicitudId);
    const respuestas = [
      await request(app).post("/api/solicitudes").send({
        pasajeroId: pasajeroSinAvisoId, latitudRecogida: punto.latitudRecogida, longitudRecogida: punto.longitudRecogida,
      }),
      await request(app).get(`/api/solicitudes/${solicitudId}`),
      await request(app).post(`/api/solicitudes/${solicitudId}/seleccionar-conductor`).send({ conductorId: c1 }),
      await request(app).post(`/api/solicitudes/${solicitudId}/responder`).send({ acepta: true }),
      await request(app).post(`/api/solicitudes/${solicitudId}/sin-conductor`).send({}),
    ];
    for (const respuesta of respuestas) {
      expect(respuesta.status).toBe(401);
      expect(respuesta.body).toEqual({ error: { code: "UNAUTHORIZED", message: "Credenciales invalidas" } });
    }
  }, 30000);

  it("admin no puede crear ni seleccionar (solo n8n), y conductor no lee detalle", async () => {
    const pasajeroId = await crearPasajero(true);
    const crear = await request(app)
      .post("/api/solicitudes")
      .set({ Authorization: adminJwt })
      .send({ pasajeroId, latitudRecogida: punto.latitudRecogida, longitudRecogida: punto.longitudRecogida });
    expect(crear.status).toBe(403);
    const { solicitudId } = await reclutarConductorYCrearSolicitud();
    solicitudesCreadas.push(solicitudId);
    await restaurarDisponibles();
    const seleccionar = await request(app)
      .post(`/api/solicitudes/${solicitudId}/seleccionar-conductor`)
      .set({ Authorization: adminJwt }).send({ conductorId: c1 });
    expect(seleccionar.status).toBe(403);
    const detalleConductor = await request(app)
      .get(`/api/solicitudes/${solicitudId}`)
      .set({ Authorization: token(usuarioDriver.usuarioId) });
    expect(detalleConductor.status).toBe(403);
  }, 30000);

  it("admin si puede leer el detalle", async () => {
    const { solicitudId } = await reclutarConductorYCrearSolicitud();
    solicitudesCreadas.push(solicitudId);
    const detalle = await request(app)
      .get(`/api/solicitudes/${solicitudId}`)
      .set({ Authorization: adminJwt });
    expect(detalle.status).toBe(200);
  }, 15000);

  it("conductor no asignado recibe 403 al responder", async () => {
    const { solicitudId } = await reclutarConductorYCrearSolicitud();
    solicitudesCreadas.push(solicitudId);
    await restaurarDisponibles();
    await request(app).post(`/api/solicitudes/${solicitudId}/seleccionar-conductor`).set(n8n()).send({ conductorId: c1 });
    const otro = await prisma.conductor.findUniqueOrThrow({ where: { id: c2 }, select: { usuarioId: true } });
    const respuesta = await request(app)
      .post(`/api/solicitudes/${solicitudId}/responder`)
      .set({ Authorization: token(otro.usuarioId) }).send({ acepta: true });
    expect(respuesta.status).toBe(403);
  }, 20000);

  it("UUID invalido devuelve 404 sin consultar al servicio", async () => {
    const detalle = await request(app).get("/api/solicitudes/no-uuid").set(n8n());
    expect(detalle.status).toBe(404);
    expect(detalle.body).toEqual({ error: { code: "NOT_FOUND", message: "Solicitud no encontrada" } });
    const seleccionar = await request(app)
      .post("/api/solicitudes/no-uuid/seleccionar-conductor").set(n8n()).send({ conductorId: c1 });
    expect(seleccionar.status).toBe(404);
  }, 15000);

  it("solicitud inexistente devuelve 404 en detalle y responder", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const detalle = await request(app).get(`/api/solicitudes/${id}`).set(n8n());
    expect(detalle.status).toBe(404);
    const responder = await request(app)
      .post(`/api/solicitudes/${id}/responder`)
      .set({ Authorization: token(usuarioDriver.usuarioId) }).send({ acepta: true });
    expect(responder.status).toBe(404);
  }, 15000);

  it("cuerpo invalido recibe 400 y fallo de base 500 sin detalles internos", async () => {
    const pasajeroId = await crearPasajero(true);
    const invalido = await request(app).post("/api/solicitudes").set(n8n()).send({ pasajeroId });
    expect(invalido.status).toBe(400);
    expect(invalido.body).toEqual({ error: { code: "VALIDATION_ERROR", message: "Entrada invalida" } });

    const spy = vi.spyOn(prisma.solicitud, "findFirst").mockRejectedValueOnce(new Error("SQL connection secret stack"));
    try {
      const { solicitudId } = await reclutarConductorYCrearSolicitud();
      solicitudesCreadas.push(solicitudId);
      const fallo = await request(app).get(`/api/solicitudes/${solicitudId}`).set(n8n());
      expect(fallo.status).toBe(500);
      expect(fallo.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
      expect(JSON.stringify(fallo.body)).not.toMatch(/secret|stack|sql/i);
    } finally {
      spy.mockRestore();
    }
  }, 30000);
});