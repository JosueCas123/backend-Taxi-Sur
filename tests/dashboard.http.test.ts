import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import { env } from "../src/config/env";
import { prisma } from "../src/config/prisma";
import * as dashboardService from "../src/modules/dashboard/dashboard.service";

vi.mock("../src/config/env", () => ({ env: {
  JWT_SECRET: "unit-test-only-jwt-secret-not-for-deployment",
  N8N_API_TOKEN: "unit-test-only-internal-secret-not-for-deployment",
} }));
vi.mock("../src/config/prisma", () => ({ prisma: { usuario: { findUnique: vi.fn() } } }));
vi.mock("../src/modules/dashboard/dashboard.service", () => ({
  obtenerConductoresParaMapa: vi.fn(),
  obtenerSolicitudesActivas: vi.fn(),
  obtenerIndicadores: vi.fn(),
}));

const mapa = vi.mocked(dashboardService.obtenerConductoresParaMapa);
const solicitudesActivas = vi.mocked(dashboardService.obtenerSolicitudesActivas);
const indicadores = vi.mocked(dashboardService.obtenerIndicadores);
const lookup = vi.mocked(prisma.usuario.findUnique);

const usuarioAdmin = "4d3c2b1a-9f8e-4a6b-8c1d-2e3f4a5b6c7d";
const usuarioConductor = "8e7acf6d-0e5b-4e6a-9f2a-1c2b3d4e5f60";

const conductorDto = {
  id: "8e7acf6d-0e5b-4e6a-9f2a-1c2b3d4e5f60",
  nombreCompleto: "Juan Perez",
  estado: "aprobado",
  estadoJornada: "activa",
  estadoDisponibilidad: "disponible",
  vehiculo: { placa: "1234ABC", marca: "Toyota", modelo: "Corolla", color: "Blanco" },
  ubicacion: { latitud: -17.7833, longitud: -63.1821, horaRegistro: "2026-09-21T14:00:00.000Z" },
  ultimaUbicacionRegistradaEn: "2026-09-21T14:00:00.000Z",
};

const solicitudDto = {
  id: "7a1f2c4e-0000-4000-8000-000000000000",
  estado: "buscando",
  pasajero: { id: "d9428888-122b-4e1f-b85c-61cd3cbb3210", nombre: "Ana Perez" },
  conductorAsignado: null,
  latitudRecogida: -17.7833,
  longitudRecogida: -63.1821,
  destino: "Terminal",
  expiraEn: null,
  creadoEn: "2026-09-21T14:00:00.000Z",
};

const indicadoresDto = {
  conductoresDisponibles: 3,
  conductoresEnServicio: 2,
  solicitudesActivas: 5,
  solicitudesCompletadasHoy: 7,
};

const n8n = { "X-N8N-Token": env.N8N_API_TOKEN };
const n8nIncorrecto = { "X-N8N-Token": "wrong-n8n-token" };
const bearer = (subject: string) => ({ Authorization: `Bearer ${jwt.sign({}, env.JWT_SECRET, { subject, expiresIn: "1h" })}` });

function usuarioAutenticado(rol: "admin" | "conductor", id: string) {
  lookup.mockResolvedValue({ id, rol, eliminadoEn: null } as Awaited<ReturnType<typeof prisma.usuario.findUnique>>);
}

function esperarServicioSinLlamar(mocks: ReadonlyArray<ReturnType<typeof vi.fn>>) {
  for (const mock of mocks) expect(mock).not.toHaveBeenCalled();
}

const unauthorized = { error: { code: "UNAUTHORIZED", message: "Credenciales invalidas" } };
const forbidden = { error: { code: "FORBIDDEN", message: "Permiso denegado" } };
const validationError = { error: { code: "VALIDATION_ERROR", message: "Entrada invalida" } };
const internalError = { error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } };

beforeEach(() => { vi.resetAllMocks(); });

const rutas = [
  { path: "/api/dashboard/conductores-mapa", servicio: mapa, dto: [conductorDto] },
  { path: "/api/dashboard/solicitudes-activas", servicio: solicitudesActivas, dto: [solicitudDto] },
  { path: "/api/dashboard/indicadores", servicio: indicadores, dto: indicadoresDto },
] as const;

describe("dashboard (solo admin, matriz 3.2)", () => {
  it.each(rutas)("GET $path: admin valido responde 200 con Cache-Control no-store", async ({ path, servicio, dto }) => {
    usuarioAutenticado("admin", usuarioAdmin);
    servicio.mockResolvedValue(dto as never);
    const response = await request(app).get(path).set(bearer(usuarioAdmin));
    expect(response.status).toBe(200);
    expect(response.body).toEqual(dto);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it.each(rutas)("GET $path: conductor valido recibe 403 sin consultar el servicio", async ({ path, servicio }) => {
    usuarioAutenticado("conductor", usuarioConductor);
    const response = await request(app).get(path).set(bearer(usuarioConductor));
    expect(response.status).toBe(403);
    expect(response.body).toEqual(forbidden);
    esperarServicioSinLlamar([servicio]);
  });

  it.each(rutas)("GET $path: solo n8n valido recibe 401 sin consultar el servicio", async ({ path, servicio }) => {
    const response = await request(app).get(path).set(n8n);
    expect(response.status).toBe(401);
    expect(response.body).toEqual(unauthorized);
    esperarServicioSinLlamar([servicio]);
  });

  it.each(rutas)("GET $path: anonimo recibe 401 sin consultar el servicio", async ({ path, servicio }) => {
    const response = await request(app).get(path);
    expect(response.status).toBe(401);
    expect(response.body).toEqual(unauthorized);
    esperarServicioSinLlamar([servicio]);
  });

  it.each(rutas)("GET $path: n8n invalido con JWT admin valido responde 200 (requireAdmin ignora el header n8n)", async ({ path, servicio, dto }) => {
    usuarioAutenticado("admin", usuarioAdmin);
    servicio.mockResolvedValue(dto as never);
    const response = await request(app).get(path).set(n8nIncorrecto).set(bearer(usuarioAdmin));
    expect(response.status).toBe(200);
    expect(response.body).toEqual(dto);
  });

  it.each(rutas)("GET $path: n8n valido con JWT conductor valido recibe 403", async ({ path, servicio }) => {
    usuarioAutenticado("conductor", usuarioConductor);
    const response = await request(app).get(path).set(n8n).set(bearer(usuarioConductor));
    expect(response.status).toBe(403);
    expect(response.body).toEqual(forbidden);
    esperarServicioSinLlamar([servicio]);
  });

  it.each(rutas)("GET $path: JWT invalido recibe 401 sin consultar el servicio", async ({ path, servicio }) => {
    const response = await request(app).get(path).set({ Authorization: "Bearer token-invalido" });
    expect(response.status).toBe(401);
    expect(response.body).toEqual(unauthorized);
    esperarServicioSinLlamar([servicio]);
  });

  it.each(rutas)("GET $path: usuario eliminado recibe 401 sin consultar el servicio", async ({ path, servicio }) => {
    lookup.mockResolvedValue({ id: usuarioAdmin, rol: "admin", eliminadoEn: new Date() } as never);
    const response = await request(app).get(path).set(bearer(usuarioAdmin));
    expect(response.status).toBe(401);
    expect(response.body).toEqual(unauthorized);
    esperarServicioSinLlamar([servicio]);
  });

  it.each(rutas)("GET $path: query no vacia recibe 400 sin consultar el servicio", async ({ path, servicio }) => {
    usuarioAutenticado("admin", usuarioAdmin);
    const response = await request(app).get(path).set(bearer(usuarioAdmin)).query({ pagina: "1" });
    expect(response.status).toBe(400);
    expect(response.body).toEqual(validationError);
    esperarServicioSinLlamar([servicio]);
  });

  it.each(rutas)("GET $path: fallo inesperado recibe 500 generico sin detalles internos", async ({ path, servicio }) => {
    usuarioAutenticado("admin", usuarioAdmin);
    servicio.mockRejectedValueOnce(new Error("SQL connection secret stack"));
    const response = await request(app).get(path).set(bearer(usuarioAdmin));
    expect(response.status).toBe(500);
    expect(response.body).toEqual(internalError);
    expect(response.headers["cache-control"]).toBeUndefined();
  });
});