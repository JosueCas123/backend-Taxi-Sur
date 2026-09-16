import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import { env } from "../src/config/env";
import { prisma } from "../src/config/prisma";
import { obtenerCandidatos } from "../src/modules/motor-asignacion/motor-asignacion.service";

vi.mock("../src/config/env", () => ({ env: {
  JWT_SECRET: "unit-test-only-jwt-secret-not-for-deployment",
  N8N_API_TOKEN: "unit-test-only-internal-secret-not-for-deployment",
} }));
vi.mock("../src/config/prisma", () => ({ prisma: { usuario: { findUnique: vi.fn() } } }));
vi.mock("../src/modules/motor-asignacion/motor-asignacion.service", () => ({
  obtenerCandidatos: vi.fn(),
}));

const obtener = vi.mocked(obtenerCandidatos);
const lookup = vi.mocked(prisma.usuario.findUnique);

const solicitudId = "d9428888-122b-4e1f-b85c-61cd3cbb3210";
const usuarioConductor = "8e7acf6d-0e5b-4e6a-9f2a-1c2b3d4e5f60";
const usuarioAdmin = "4d3c2b1a-9f8e-4a6b-8c1d-2e3f4a5b6c7d";
const candidatos = {
  candidatos: [{
    conductorId: "4c3f2b1a-9e8d-4a6b-8c1d-2e3f4a5b6c7d",
    nombreCompleto: "Juan Perez",
    distanciaKm: 2.35,
    vehiculo: {
      placa: "1234ABC", marca: "Toyota", modelo: "Corolla", color: "Blanco", capacidadPasajeros: 4,
    },
  }],
};
const path = `/api/solicitudes/${solicitudId}/candidatos`;

const bearer = (subject: string) => `Bearer ${jwt.sign({}, env.JWT_SECRET, { subject, expiresIn: "1h" })}`;

function usuarioAutenticado(rol: "admin" | "conductor", id: string) {
  lookup.mockResolvedValue({ id, rol, eliminadoEn: null } as Awaited<ReturnType<typeof prisma.usuario.findUnique>>);
}

beforeEach(() => { vi.resetAllMocks(); });

describe("GET /api/solicitudes/:id/candidatos (exclusivo de n8n)", () => {
  it("n8n con token valido recibe 200 con el DTO de candidatos", async () => {
    obtener.mockResolvedValue({ ok: true, candidatos: candidatos.candidatos });
    const response = await request(app).get(path).set("X-N8N-Token", env.N8N_API_TOKEN);
    expect(response.status).toBe(200);
    expect(response.body).toEqual(candidatos);
    expect(obtener).toHaveBeenCalledExactlyOnceWith(solicitudId, expect.any(Date));
  });

  it("admin y conductor con JWT valido reciben 403 FORBIDDEN sin consultar el servicio", async () => {
    for (const { rol, id } of [
      { rol: "admin" as const, id: usuarioAdmin },
      { rol: "conductor" as const, id: usuarioConductor },
    ]) {
      usuarioAutenticado(rol, id);
      const response = await request(app).get(path).set("Authorization", bearer(id));
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: { code: "FORBIDDEN", message: "Permiso denegado" } });
    }
    expect(obtener).not.toHaveBeenCalled();
  });

  it("sin credenciales o con token invalido recibe 401 antes de tocar el recurso", async () => {
    for (const headers of [{}, { Authorization: "Bearer invalid" }, { "X-N8N-Token": "invalid" }]) {
      const response = await request(app).get(path).set(headers);
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    }
    expect(obtener).not.toHaveBeenCalled();
  });

  it("UUID invalido recibe 404 sin consultar el servicio", async () => {
    const response = await request(app).get("/api/solicitudes/no-uuid/candidatos")
      .set("X-N8N-Token", env.N8N_API_TOKEN);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "NOT_FOUND", message: "Solicitud no encontrada" } });
    expect(obtener).not.toHaveBeenCalled();
  });

  it("solicitud inexistente o eliminada recibe 404 del servicio", async () => {
    obtener.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    const response = await request(app).get(path).set("X-N8N-Token", env.N8N_API_TOKEN);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "NOT_FOUND", message: "Solicitud no encontrada" } });
  });

  it("sin candidatos elegibles recibe 200 con lista vacia", async () => {
    obtener.mockResolvedValue({ ok: true, candidatos: [] });
    const response = await request(app).get(path).set("X-N8N-Token", env.N8N_API_TOKEN);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ candidatos: [] });
  });

  it("fallo inesperado del servicio recibe 500 generico sin detalles internos", async () => {
    obtener.mockRejectedValueOnce(new Error("SQL connection secret stack"));
    const response = await request(app).get(path).set("X-N8N-Token", env.N8N_API_TOKEN);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
  });
});