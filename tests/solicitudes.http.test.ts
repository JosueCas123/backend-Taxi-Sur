import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import { env } from "../src/config/env";
import { prisma } from "../src/config/prisma";
import * as solicitudesService from "../src/modules/solicitudes/solicitudes.service";

vi.mock("../src/config/env", () => ({ env: {
  JWT_SECRET: "unit-test-only-jwt-secret-not-for-deployment",
  N8N_API_TOKEN: "unit-test-only-internal-secret-not-for-deployment",
} }));
vi.mock("../src/config/prisma", () => ({ prisma: { usuario: { findUnique: vi.fn() } } }));
vi.mock("../src/modules/solicitudes/solicitudes.service", () => ({
  crearSolicitud: vi.fn(),
  seleccionarConductor: vi.fn(),
  responderSolicitud: vi.fn(),
  finalizarSolicitud: vi.fn(),
  marcarSinConductor: vi.fn(),
  obtenerSolicitud: vi.fn(),
}));

const crear = vi.mocked(solicitudesService.crearSolicitud);
const seleccionar = vi.mocked(solicitudesService.seleccionarConductor);
const responder = vi.mocked(solicitudesService.responderSolicitud);
const finalizar = vi.mocked(solicitudesService.finalizarSolicitud);
const sinConductor = vi.mocked(solicitudesService.marcarSinConductor);
const obtener = vi.mocked(solicitudesService.obtenerSolicitud);
const lookup = vi.mocked(prisma.usuario.findUnique);

const solicitudId = "d9428888-122b-4e1f-b85c-61cd3cbb3210";
const pasajeroId = "6a5b4c3d-2e1f-4a0b-9c8d-7f6e5d4c3b2a";
const conductorId = "4c3f2b1a-9e8d-4a6b-8c1d-2e3f4a5b6c7d";
const usuarioConductor = "8e7acf6d-0e5b-4e6a-9f2a-1c2b3d4e5f60";
const usuarioOtroConductor = "3a2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d";
const usuarioAdmin = "4d3c2b1a-9f8e-4a6b-8c1d-2e3f4a5b6c7d";

const coordenadas = { latitudRecogida: -17.7833, longitudRecogida: -63.1821 };
const crearBody = { pasajeroId, ...coordenadas, destino: "Plaza 24 de Septiembre" };
const seleccionarBody = { conductorId };
const respondidoEn = "2026-09-16T12:00:00.000Z";

const solicitudDto = {
  id: solicitudId,
  pasajeroId,
  conductorAsignadoId: null,
  estado: "buscando",
  ...coordenadas,
  destino: "Plaza 24 de Septiembre",
  expiraEn: null,
  aceptadaEn: null,
  finalizadaEn: null,
  creadoEn: respondidoEn,
};
const solicitudDetalleDto = { ...solicitudDto, pasajero: { id: pasajeroId, nombre: "Maria Gomez" }, conductorAsignado: null };

const n8n = { "X-N8N-Token": env.N8N_API_TOKEN };
const bearer = (subject: string) => ({ Authorization: `Bearer ${jwt.sign({}, env.JWT_SECRET, { subject, expiresIn: "1h" })}` });

function usuarioAutenticado(rol: "admin" | "conductor", id: string) {
  lookup.mockResolvedValue({ id, rol, eliminadoEn: null } as Awaited<ReturnType<typeof prisma.usuario.findUnique>>);
}

function esperarServicioSinLlamar(mock: ReturnType<typeof vi.fn>) {
  expect(mock).not.toHaveBeenCalled();
}

const unauthorized = { error: { code: "UNAUTHORIZED", message: "Credenciales invalidas" } };
const forbidden = { error: { code: "FORBIDDEN", message: "Permiso denegado" } };
const notFoundSolicitud = { error: { code: "NOT_FOUND", message: "Solicitud no encontrada" } };
const internalError = { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } };

beforeEach(() => { vi.resetAllMocks(); });

describe("POST /api/solicitudes (crear, solo n8n)", () => {
  const path = "/api/solicitudes";

  it("n8n valido crea y responde 201 con el DTO", async () => {
    crear.mockResolvedValue({ ok: true, solicitud: solicitudDto });
    const response = await request(app).post(path).set(n8n).send(crearBody);
    expect(response.status).toBe(201);
    expect(response.body).toEqual(solicitudDto);
    expect(crear).toHaveBeenCalledExactlyOnceWith(crearBody, expect.any(Date));
  });

  it("anomalo anonimo recibe 401 sin consultar el servicio", async () => {
    const response = await request(app).post(path).send(crearBody);
    expect(response.status).toBe(401);
    expect(response.body).toEqual(unauthorized);
    esperarServicioSinLlamar(crear);
  });

  it.each([
    { rol: "admin" as const, id: usuarioAdmin },
    { rol: "conductor" as const, id: usuarioConductor },
  ])("JWT valido de $rol recibe 403 FORBIDDEN sin consultar el servicio", async ({ rol, id }) => {
    usuarioAutenticado(rol, id);
    const response = await request(app).post(path).set(bearer(id)).send(crearBody);
    expect(response.status).toBe(403);
    expect(response.body).toEqual(forbidden);
    esperarServicioSinLlamar(crear);
  });

  it("cuerpo invalido recibe 400 VALIDATION_ERROR", async () => {
    const response = await request(app).post(path).set(n8n).send({ pasajeroId });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: { code: "VALIDATION_ERROR", message: "Entrada invalida" } });
    esperarServicioSinLlamar(crear);
  });

  it("pasajero inexistente o eliminado recibe 404 NOT_FOUND", async () => {
    crear.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    const response = await request(app).post(path).set(n8n).send(crearBody);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "NOT_FOUND", message: "Pasajero no encontrado" } });
  });

  it.each([
    { code: "AVISO_NO_ACEPTADO", message: "El pasajero no acepto el aviso de privacidad" },
    { code: "SOLICITUD_ACTIVA", message: "El pasajero ya tiene una solicitud activa" },
  ] as const)("conflicto $code recibe 409", async ({ code, message }) => {
    crear.mockResolvedValue({ ok: false, code });
    const response = await request(app).post(path).set(n8n).send(crearBody);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: { code, message } });
  });

  it("fallo inesperado recibe 500 generico sin detalles internos", async () => {
    crear.mockRejectedValueOnce(new Error("SQL connection secret stack"));
    const response = await request(app).post(path).set(n8n).send(crearBody);
    expect(response.status).toBe(500);
    expect(response.body).toEqual(internalError);
  });
});

describe("POST /api/solicitudes/:id/seleccionar-conductor (solo n8n)", () => {
  const path = `/api/solicitudes/${solicitudId}/seleccionar-conductor`;

  it("n8n valido asigna y responde 200 con el DTO", async () => {
    seleccionar.mockResolvedValue({ ok: true, solicitud: { ...solicitudDto, estado: "esperando_respuesta" } });
    const response = await request(app).post(path).set(n8n).send(seleccionarBody);
    expect(response.status).toBe(200);
    expect(response.body.estado).toBe("esperando_respuesta");
    expect(seleccionar).toHaveBeenCalledExactlyOnceWith(solicitudId, conductorId, expect.any(Date));
  });

  it("anonimo recibe 401 sin consultar el servicio", async () => {
    const response = await request(app).post(path).send(seleccionarBody);
    expect(response.status).toBe(401);
    expect(response.body).toEqual(unauthorized);
    esperarServicioSinLlamar(seleccionar);
  });

  it.each([
    { rol: "admin" as const, id: usuarioAdmin },
    { rol: "conductor" as const, id: usuarioConductor },
  ])("JWT valido de $rol recibe 403 FORBIDDEN sin consultar el servicio", async ({ rol, id }) => {
    usuarioAutenticado(rol, id);
    const response = await request(app).post(path).set(bearer(id)).send(seleccionarBody);
    expect(response.status).toBe(403);
    expect(response.body).toEqual(forbidden);
    esperarServicioSinLlamar(seleccionar);
  });

  it("UUID invalido recibe 404 sin consultar el servicio", async () => {
    const response = await request(app).post("/api/solicitudes/no-uuid/seleccionar-conductor")
      .set(n8n).send(seleccionarBody);
    expect(response.status).toBe(404);
    expect(response.body).toEqual(notFoundSolicitud);
    esperarServicioSinLlamar(seleccionar);
  });

  it("cuerpo invalido recibe 400 VALIDATION_ERROR", async () => {
    const response = await request(app).post(path).set(n8n).send({});
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: { code: "VALIDATION_ERROR", message: "Entrada invalida" } });
    esperarServicioSinLlamar(seleccionar);
  });

  it("solicitud inexistente o eliminada recibe 404 del servicio", async () => {
    seleccionar.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    const response = await request(app).post(path).set(n8n).send(seleccionarBody);
    expect(response.status).toBe(404);
    expect(response.body).toEqual(notFoundSolicitud);
  });

  it.each([
    { code: "CANDIDATO_INVALIDO", message: "El conductor no es un candidato elegible" },
    { code: "ESTADO_INVALIDO", message: "Transicion no permitida desde el estado actual de la solicitud" },
    { code: "SOLICITUD_ACTIVA", message: "El pasajero ya tiene una solicitud activa" },
  ] as const)("conflicto $code recibe 409", async ({ code, message }) => {
    seleccionar.mockResolvedValue({ ok: false, code });
    const response = await request(app).post(path).set(n8n).send(seleccionarBody);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: { code, message } });
  });

  it("fallo inesperado recibe 500 generico", async () => {
    seleccionar.mockRejectedValueOnce(new Error("SQL connection secret stack"));
    const response = await request(app).post(path).set(n8n).send(seleccionarBody);
    expect(response.status).toBe(500);
    expect(response.body).toEqual(internalError);
  });
});

describe("POST /api/solicitudes/:id/responder (conductor asignado)", () => {
  const path = `/api/solicitudes/${solicitudId}/responder`;

  it("conductor asignado acepta y responde 200 con el DTO", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    responder.mockResolvedValue({ ok: true, solicitud: { ...solicitudDto, estado: "en_servicio" } });
    const response = await request(app).post(path).set(bearer(usuarioConductor)).send({ acepta: true });
    expect(response.status).toBe(200);
    expect(response.body.estado).toBe("en_servicio");
    expect(responder).toHaveBeenCalledExactlyOnceWith(solicitudId, usuarioConductor, true, expect.any(Date));
  });

  it("anonimo recibe 401 sin consultar el servicio", async () => {
    const response = await request(app).post(path).send({ acepta: true });
    expect(response.status).toBe(401);
    expect(response.body).toEqual(unauthorized);
    esperarServicioSinLlamar(responder);
  });

  it("n8n no es propietario: la propiedad se descarta en el servicio y responde 403", async () => {
    responder.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    const response = await request(app).post(path).set(n8n).send({ acepta: true });
    expect(response.status).toBe(403);
    expect(response.body).toEqual(forbidden);
    expect(responder).toHaveBeenCalledExactlyOnceWith(solicitudId, "", true, expect.any(Date));
  });

  it("admin no es propietario: responde 403 del servicio", async () => {
    usuarioAutenticado("admin", usuarioAdmin);
    responder.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    const response = await request(app).post(path).set(bearer(usuarioAdmin)).send({ acepta: true });
    expect(response.status).toBe(403);
    expect(response.body).toEqual(forbidden);
    expect(responder).toHaveBeenCalledExactlyOnceWith(solicitudId, usuarioAdmin, true, expect.any(Date));
  });

  it("conductor no asignado recibe 403 del servicio", async () => {
    usuarioAutenticado("conductor", usuarioOtroConductor);
    responder.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    const response = await request(app).post(path).set(bearer(usuarioOtroConductor)).send({ acepta: false });
    expect(response.status).toBe(403);
    expect(response.body).toEqual(forbidden);
    expect(responder).toHaveBeenCalledExactlyOnceWith(solicitudId, usuarioOtroConductor, false, expect.any(Date));
  });

  it("UUID invalido recibe 404 sin consultar el servicio", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    const response = await request(app).post("/api/solicitudes/no-uuid/responder")
      .set(bearer(usuarioConductor)).send({ acepta: true });
    expect(response.status).toBe(404);
    expect(response.body).toEqual(notFoundSolicitud);
    esperarServicioSinLlamar(responder);
  });

  it("cuerpo invalido recibe 400 VALIDATION_ERROR", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    const response = await request(app).post(path).set(bearer(usuarioConductor)).send({ acepta: "si" });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: { code: "VALIDATION_ERROR", message: "Entrada invalida" } });
    esperarServicioSinLlamar(responder);
  });

  it("solicitud inexistente o eliminada recibe 404 del servicio", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    responder.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    const response = await request(app).post(path).set(bearer(usuarioConductor)).send({ acepta: true });
    expect(response.status).toBe(404);
    expect(response.body).toEqual(notFoundSolicitud);
  });

  it("conflicto de estado recibe 409", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    responder.mockResolvedValue({ ok: false, code: "ESTADO_INVALIDO" });
    const response = await request(app).post(path).set(bearer(usuarioConductor)).send({ acepta: true });
    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: { code: "ESTADO_INVALIDO", message: "Transicion no permitida desde el estado actual de la solicitud" },
    });
  });

  it("fallo inesperado recibe 500 generico", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    responder.mockRejectedValueOnce(new Error("SQL connection secret stack"));
    const response = await request(app).post(path).set(bearer(usuarioConductor)).send({ acepta: true });
    expect(response.status).toBe(500);
    expect(response.body).toEqual(internalError);
  });
});

describe("POST /api/solicitudes/:id/finalizar (conductor asignado)", () => {
  const path = `/api/solicitudes/${solicitudId}/finalizar`;

  it("conductor asignado finaliza y responde 200 con el DTO", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    finalizar.mockResolvedValue({ ok: true, solicitud: { ...solicitudDto, estado: "finalizada" } });
    const response = await request(app).post(path).set(bearer(usuarioConductor)).send({});
    expect(response.status).toBe(200);
    expect(response.body.estado).toBe("finalizada");
    expect(finalizar).toHaveBeenCalledExactlyOnceWith(solicitudId, usuarioConductor, expect.any(Date));
  });

  it("anonimo recibe 401 sin consultar el servicio", async () => {
    const response = await request(app).post(path).send({});
    expect(response.status).toBe(401);
    expect(response.body).toEqual(unauthorized);
    esperarServicioSinLlamar(finalizar);
  });

  it("n8n no es propietario: responde 403 del servicio", async () => {
    finalizar.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    const response = await request(app).post(path).set(n8n).send({});
    expect(response.status).toBe(403);
    expect(response.body).toEqual(forbidden);
    expect(finalizar).toHaveBeenCalledExactlyOnceWith(solicitudId, "", expect.any(Date));
  });

  it("admin no es propietario: responde 403 del servicio", async () => {
    usuarioAutenticado("admin", usuarioAdmin);
    finalizar.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    const response = await request(app).post(path).set(bearer(usuarioAdmin)).send({});
    expect(response.status).toBe(403);
    expect(response.body).toEqual(forbidden);
  });

  it("conductor no asignado recibe 403 del servicio", async () => {
    usuarioAutenticado("conductor", usuarioOtroConductor);
    finalizar.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    const response = await request(app).post(path).set(bearer(usuarioOtroConductor)).send({});
    expect(response.status).toBe(403);
    expect(response.body).toEqual(forbidden);
  });

  it("UUID invalido recibe 404 sin consultar el servicio", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    const response = await request(app).post("/api/solicitudes/no-uuid/finalizar")
      .set(bearer(usuarioConductor)).send({});
    expect(response.status).toBe(404);
    expect(response.body).toEqual(notFoundSolicitud);
    esperarServicioSinLlamar(finalizar);
  });

  it("cuerpo invalido (array) recibe 400 VALIDATION_ERROR", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    const response = await request(app).post(path).set(bearer(usuarioConductor)).send([1, 2]);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: { code: "VALIDATION_ERROR", message: "Entrada invalida" } });
    esperarServicioSinLlamar(finalizar);
  });

  it("solicitud inexistente o eliminada recibe 404 del servicio", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    finalizar.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    const response = await request(app).post(path).set(bearer(usuarioConductor)).send({});
    expect(response.status).toBe(404);
    expect(response.body).toEqual(notFoundSolicitud);
  });

  it("conflicto de estado recibe 409", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    finalizar.mockResolvedValue({ ok: false, code: "ESTADO_INVALIDO" });
    const response = await request(app).post(path).set(bearer(usuarioConductor)).send({});
    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: { code: "ESTADO_INVALIDO", message: "Transicion no permitida desde el estado actual de la solicitud" },
    });
  });

  it("fallo inesperado recibe 500 generico", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    finalizar.mockRejectedValueOnce(new Error("SQL connection secret stack"));
    const response = await request(app).post(path).set(bearer(usuarioConductor)).send({});
    expect(response.status).toBe(500);
    expect(response.body).toEqual(internalError);
  });
});

describe("POST /api/solicitudes/:id/sin-conductor (solo n8n)", () => {
  const path = `/api/solicitudes/${solicitudId}/sin-conductor`;

  it("n8n valido marca sin conductor y responde 200 con el DTO", async () => {
    sinConductor.mockResolvedValue({ ok: true, solicitud: { ...solicitudDto, estado: "sin_conductor" } });
    const response = await request(app).post(path).set(n8n).send({});
    expect(response.status).toBe(200);
    expect(response.body.estado).toBe("sin_conductor");
    expect(sinConductor).toHaveBeenCalledExactlyOnceWith(solicitudId);
  });

  it("anonimo recibe 401 sin consultar el servicio", async () => {
    const response = await request(app).post(path).send({});
    expect(response.status).toBe(401);
    expect(response.body).toEqual(unauthorized);
    esperarServicioSinLlamar(sinConductor);
  });

  it("JWT de conductor recibe 403 FORBIDDEN sin consultar el servicio", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    const response = await request(app).post(path).set(bearer(usuarioConductor)).send({});
    expect(response.status).toBe(403);
    expect(response.body).toEqual(forbidden);
    esperarServicioSinLlamar(sinConductor);
  });

  it("UUID invalido recibe 404 sin consultar el servicio", async () => {
    const response = await request(app).post("/api/solicitudes/no-uuid/sin-conductor").set(n8n).send({});
    expect(response.status).toBe(404);
    expect(response.body).toEqual(notFoundSolicitud);
    esperarServicioSinLlamar(sinConductor);
  });

  it("solicitud inexistente o eliminada recibe 404 del servicio", async () => {
    sinConductor.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    const response = await request(app).post(path).set(n8n).send({});
    expect(response.status).toBe(404);
    expect(response.body).toEqual(notFoundSolicitud);
  });

  it("conflicto de estado recibe 409", async () => {
    sinConductor.mockResolvedValue({ ok: false, code: "ESTADO_INVALIDO" });
    const response = await request(app).post(path).set(n8n).send({});
    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: { code: "ESTADO_INVALIDO", message: "Transicion no permitida desde el estado actual de la solicitud" },
    });
  });

  it("fallo inesperado recibe 500 generico", async () => {
    sinConductor.mockRejectedValueOnce(new Error("SQL connection secret stack"));
    const response = await request(app).post(path).set(n8n).send({});
    expect(response.status).toBe(500);
    expect(response.body).toEqual(internalError);
  });
});

describe("GET /api/solicitudes/:id (detalle, n8n o admin)", () => {
  const path = `/api/solicitudes/${solicitudId}`;

  it("n8n valido obtiene el detalle con 200", async () => {
    obtener.mockResolvedValue({ ok: true, solicitud: solicitudDetalleDto });
    const response = await request(app).get(path).set(n8n);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(solicitudDetalleDto);
    expect(obtener).toHaveBeenCalledExactlyOnceWith(solicitudId);
  });

  it("admin con JWT valido obtiene el detalle con 200", async () => {
    usuarioAutenticado("admin", usuarioAdmin);
    obtener.mockResolvedValue({ ok: true, solicitud: solicitudDetalleDto });
    const response = await request(app).get(path).set(bearer(usuarioAdmin));
    expect(response.status).toBe(200);
    expect(response.body.pasajero.nombre).toBe("Maria Gomez");
  });

  it("conductor con JWT valido recibe 403 FORBIDDEN sin consultar el servicio", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    const response = await request(app).get(path).set(bearer(usuarioConductor));
    expect(response.status).toBe(403);
    expect(response.body).toEqual(forbidden);
    esperarServicioSinLlamar(obtener);
  });

  it("anonimo recibe 401 sin consultar el servicio", async () => {
    const response = await request(app).get(path);
    expect(response.status).toBe(401);
    expect(response.body).toEqual(unauthorized);
    esperarServicioSinLlamar(obtener);
  });

  it("UUID invalido recibe 404 sin consultar el servicio", async () => {
    const response = await request(app).get("/api/solicitudes/no-uuid").set(n8n);
    expect(response.status).toBe(404);
    expect(response.body).toEqual(notFoundSolicitud);
    esperarServicioSinLlamar(obtener);
  });

  it("solicitud inexistente o eliminada recibe 404 del servicio", async () => {
    obtener.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    const response = await request(app).get(path).set(n8n);
    expect(response.status).toBe(404);
    expect(response.body).toEqual(notFoundSolicitud);
  });

  it("fallo inesperado recibe 500 generico sin detalles internos", async () => {
    obtener.mockRejectedValueOnce(new Error("SQL connection secret stack"));
    const response = await request(app).get(path).set(n8n);
    expect(response.status).toBe(500);
    expect(response.body).toEqual(internalError);
  });

  it("GET /:id/candidatos del motor no es capturado por el detalle", async () => {
    obtener.mockResolvedValue({ ok: true, solicitud: solicitudDetalleDto });
    const response = await request(app).get(`/api/solicitudes/${solicitudId}/candidatos`).set(n8n);
    expect(obtener).not.toHaveBeenCalled();
    expect(response.status).not.toBe(200);
  });
});