import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../src/app";
import { env } from "../src/config/env";
import { prisma } from "../src/config/prisma";
import { obtenerUltimaUbicacion, registrarUbicacion } from "../src/modules/ubicaciones/ubicaciones.service";

vi.mock("../src/config/env", () => ({ env: {
  JWT_SECRET: "unit-test-only-jwt-secret-not-for-deployment",
  N8N_API_TOKEN: "unit-test-only-internal-secret-not-for-deployment",
} }));
vi.mock("../src/config/prisma", () => ({ prisma: { usuario: { findUnique: vi.fn() } } }));
vi.mock("../src/modules/ubicaciones/ubicaciones.service", () => ({
  registrarUbicacion: vi.fn(), obtenerUltimaUbicacion: vi.fn(),
}));

const registrar = vi.mocked(registrarUbicacion);
const obtener = vi.mocked(obtenerUltimaUbicacion);
const lookup = vi.mocked(prisma.usuario.findUnique);

const conductorId = "d9428888-122b-4e1f-b85c-61cd3cbb3210";
const usuarioConductor = "8e7acf6d-0e5b-4e6a-9f2a-1c2b3d4e5f60";
const usuarioAdmin = "4d3c2b1a-9f8e-4a6b-8c1d-2e3f4a5b6c7d";
const input = { latitud: -17.7833, longitud: -63.1821 };
const dto = {
  id: "42", ...input, horaRegistro: "2026-09-15T14:00:00.000Z", esValida: true,
};
const path = `/api/conductores/${conductorId}/ubicacion`;
const invalid = { error: { code: "VALIDATION_ERROR", message: "Entrada invalida" } };

const bearer = (subject: string) => `Bearer ${jwt.sign({}, env.JWT_SECRET, { subject, expiresIn: "1h" })}`;

function usuarioAutenticado(rol: "admin" | "conductor", id: string) {
  lookup.mockResolvedValue({ id, rol, eliminadoEn: null } as Awaited<ReturnType<typeof prisma.usuario.findUnique>>);
}

beforeEach(() => { vi.resetAllMocks(); });

describe("POST /api/conductores/:id/ubicacion", () => {
  it("propietario aprobado recibe 201 con el DTO y entrega auth al servicio", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    registrar.mockResolvedValue({ ok: true, ubicacion: dto });
    const response = await request(app).post(path)
      .set("Authorization", bearer(usuarioConductor)).send(input);
    expect(response.status).toBe(201);
    expect(response.body).toEqual(dto);
    expect(registrar).toHaveBeenCalledExactlyOnceWith(
      conductorId, input, { source: "jwt", userId: usuarioConductor, rol: "conductor" },
    );
  });

  it("conductor ajeno recibe 403 FORBIDDEN sin revelar datos del destino", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    registrar.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    const response = await request(app).post(path)
      .set("Authorization", bearer(usuarioConductor)).send(input);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: { code: "FORBIDDEN", message: "Permiso denegado" } });
  });

  it("propietario no aprobado recibe 403 CONDUCTOR_NO_APROBADO", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    registrar.mockResolvedValue({ ok: false, code: "CONDUCTOR_NO_APROBADO" });
    const response = await request(app).post(path)
      .set("Authorization", bearer(usuarioConductor)).send(input);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: { code: "CONDUCTOR_NO_APROBADO", message: "Conductor no aprobado" } });
  });

  it("admin recibe 403 y n8n 403; ambos sin insertar", async () => {
    usuarioAutenticado("admin", usuarioAdmin);
    registrar.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    const admin = await request(app).post(path).set("Authorization", bearer(usuarioAdmin)).send(input);
    expect(admin.status).toBe(403);
    expect(admin.body.error.code).toBe("FORBIDDEN");

    const n8n = await request(app).post(path).set("X-N8N-Token", env.N8N_API_TOKEN).send(input);
    expect(n8n.status).toBe(403);
    expect(n8n.body.error.code).toBe("FORBIDDEN");
    expect(registrar).toHaveBeenCalledTimes(2);
  });

  it("sin credenciales o token invalido recibe 401 antes de tocar el recurso", async () => {
    for (const headers of [{}, { Authorization: "Bearer invalid" }, { "X-N8N-Token": "invalid" }]) {
      const response = await request(app).post(path).set(headers).send(input);
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    }
    expect(registrar).not.toHaveBeenCalled();
  });

  it("UUID invalido recibe 404 sin consultar el servicio", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    const response = await request(app).post(`/api/conductores/no-uuid/ubicacion`)
      .set("Authorization", bearer(usuarioConductor)).send(input);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "NOT_FOUND", message: "Conductor no encontrado" } });
    expect(registrar).not.toHaveBeenCalled();
  });

  it("conductor inexistente o eliminado recibe 404 del servicio", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    registrar.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    const response = await request(app).post(path)
      .set("Authorization", bearer(usuarioConductor)).send(input);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "NOT_FOUND", message: "Conductor no encontrado" } });
  });

  it.each([
    undefined, {}, [], { latitud: "0", longitud: 0 }, { latitud: 90.0001, longitud: 0 },
    { latitud: 0, longitud: -180.0001 }, { latitud: 0 }, null,
    { latitud: -17.7833, longitud: -63.1821, horaRegistro: dto.horaRegistro },
    { latitud: -17.7833, longitud: -63.1821, conductorId },
    { latitud: -17.7833, longitud: -63.1821, extra: true },
    { latitud: Number.NaN, longitud: 0 },
    { latitud: 0, longitud: Number.POSITIVE_INFINITY },
  ])("rechaza cuerpo invalido %j con 400 sin llamar al servicio", async (body) => {
    const response = await request(app).post(path)
      .set("X-N8N-Token", env.N8N_API_TOKEN).send(body);
    expect(response.status).toBe(400);
    expect(response.body).toEqual(invalid);
    expect(registrar).not.toHaveBeenCalled();
  });

  it.each(["null", '{"secret":'])("conserva rechazo global de JSON malformado", async (body) => {
    const response = await request(app).post(path)
      .set("Content-Type", "application/json").set("X-N8N-Token", env.N8N_API_TOKEN).send(body);
    expect(response.status).toBe(400);
    expect(response.body).toEqual(invalid);
    expect(registrar).not.toHaveBeenCalled();
  });

  it("fallo del servicio se convierte en 500 generico sin detalles internos", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    registrar.mockRejectedValueOnce(new Error("SQL connection secret stack"));
    const response = await request(app).post(path)
      .set("Authorization", bearer(usuarioConductor)).send(input);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
  });
});

describe("GET /api/conductores/:id/ubicacion", () => {
  it("admin recibe 200 con el DTO de la ultima ubicacion", async () => {
    usuarioAutenticado("admin", usuarioAdmin);
    obtener.mockResolvedValue({ ok: true, ubicacion: dto });
    const response = await request(app).get(path).set("Authorization", bearer(usuarioAdmin));
    expect(response.status).toBe(200);
    expect(response.body).toEqual(dto);
    expect(obtener).toHaveBeenCalledTimes(1);
    expect(obtener.mock.calls[0][0]).toBe(conductorId);
    expect(obtener.mock.calls[0][1]).toBeInstanceOf(Date);
  });

  it("conductor recibe 403: el GET exige admin", async () => {
    usuarioAutenticado("conductor", usuarioConductor);
    const response = await request(app).get(path).set("Authorization", bearer(usuarioConductor));
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(obtener).not.toHaveBeenCalled();
  });

  it("n8n recibe 401: requireAdmin solo reconoce JWT Bearer", async () => {
    const response = await request(app).get(path).set("X-N8N-Token", env.N8N_API_TOKEN);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
    expect(obtener).not.toHaveBeenCalled();
  });

  it("sin credenciales o token invalido recibe 401", async () => {
    for (const headers of [{}, { Authorization: "Bearer invalid" }]) {
      const response = await request(app).get(path).set(headers);
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHORIZED");
    }
    expect(obtener).not.toHaveBeenCalled();
  });

  it("UUID invalido recibe 404 sin consultar el servicio", async () => {
    usuarioAutenticado("admin", usuarioAdmin);
    const response = await request(app).get("/api/conductores/no-uuid/ubicacion")
      .set("Authorization", bearer(usuarioAdmin));
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "NOT_FOUND", message: "Conductor no encontrado" } });
    expect(obtener).not.toHaveBeenCalled();
  });

  it("conductor inexistente, eliminado o sin ubicaciones recibe 404 del servicio", async () => {
    usuarioAutenticado("admin", usuarioAdmin);
    obtener.mockResolvedValue({ ok: false, code: "NOT_FOUND" });
    const response = await request(app).get(path).set("Authorization", bearer(usuarioAdmin));
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "NOT_FOUND", message: "Conductor no encontrado" } });
  });

  it("fallo del servicio se convierte en 500 generico sin detalles internos", async () => {
    usuarioAutenticado("admin", usuarioAdmin);
    obtener.mockRejectedValueOnce(new Error("SQL connection secret stack"));
    const response = await request(app).get(path).set("Authorization", bearer(usuarioAdmin));
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
  });
});