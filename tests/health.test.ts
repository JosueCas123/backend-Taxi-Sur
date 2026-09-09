import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { errorHandler } from "../src/middlewares/error-handler";

describe("HTTP sin PostgreSQL", () => {
  it("importar app no llama listen y health es liveness", async () => {
    const listen = vi.spyOn(express.application, "listen");
    const { default: app } = await import("../src/app");
    expect(listen).not.toHaveBeenCalled();
    listen.mockRestore();
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("JSON malformado devuelve 400 seguro", async () => {
    const { default: app } = await import("../src/app");
    const response = await request(app).post("/health")
      .set("Content-Type", "application/json").send('{"secret":');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: { code: "VALIDATION_ERROR", message: "Entrada invalida" } });
  });

  it("ruta inexistente devuelve 404 JSON", async () => {
    const { default: app } = await import("../src/app");
    const response = await request(app).get("/missing");
    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toMatch(/json/);
    expect(response.body).toEqual({ error: { code: "NOT_FOUND", message: "Ruta inexistente" } });
  });

  it("errores internos asincronos no exponen detalles", async () => {
    const app = express();
    app.get("/failure", async () => { throw new Error("SQL connection secret stack"); });
    app.use(errorHandler);
    const response = await request(app).get("/failure");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" } });
  });

  it("entrada Zod invalida devuelve 400", async () => {
    const app = express();
    app.get("/validation", () => { z.string().parse(null); });
    app.use(errorHandler);
    const response = await request(app).get("/validation");
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});
