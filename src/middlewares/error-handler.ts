import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Ruta inexistente" } });
};

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const invalidJson = error instanceof SyntaxError
    && "type" in error && error.type === "entity.parse.failed";
  if (invalidJson || error instanceof ZodError) {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Entrada invalida" },
    });
    return;
  }

  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Error interno del servidor" },
  });
};
