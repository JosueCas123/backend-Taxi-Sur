import { timingSafeEqual } from "node:crypto";
import jwt, { TokenExpiredError } from "jsonwebtoken";
import type { Request, RequestHandler } from "express";
import type { RolUsuario } from "@prisma/client";
import { prisma } from "../config/prisma";
import { env } from "../config/env";

export type AuthSource = "jwt" | "n8n";

export interface AuthContext {
  source: AuthSource;
  userId: string | null;
  rol: RolUsuario | null;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

const unauthorized = { error: { code: "UNAUTHORIZED", message: "Credenciales invalidas" } };
const forbidden = { error: { code: "FORBIDDEN", message: "Permiso denegado" } };

function tokensMatch(candidate: string, expected: string) {
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  if (candidateBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(candidateBytes, expectedBytes);
}

function extractBearer(authorization: string | undefined) {
  if (!authorization) return null;
  const [scheme, token, extra] = authorization.split(" ");
  if (scheme !== "Bearer" || !token || extra !== undefined) return null;
  return token;
}

async function resolveByJwt(token: string) {
  let payload: jwt.JwtPayload;
  try {
    const verified = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] });
    payload = typeof verified === "string" ? {} : verified;
  } catch (error) {
    if (error instanceof TokenExpiredError) return { status: 401 as const };
    return { status: 401 as const };
  }

  const userId = payload.sub;
  if (typeof userId !== "string" || userId.length === 0) return { status: 401 as const };

  let user;
  try {
    user = await prisma.usuario.findUnique({
      where: { id: userId },
      select: { id: true, rol: true, eliminadoEn: true },
    });
  } catch (error) {
    return { error };
  }

  if (!user || user.eliminadoEn !== null) return { status: 401 as const };
  return { auth: { source: "jwt" as const, userId: user.id, rol: user.rol } };
}

function resolveByN8nToken(xN8nToken: unknown) {
  if (typeof xN8nToken !== "string" || xN8nToken.length === 0) return null;
  return tokensMatch(xN8nToken, env.N8N_API_TOKEN)
    ? { auth: { source: "n8n" as const, userId: null, rol: null } }
    : { status: 401 as const };
}

async function resolveCredentials(req: AuthenticatedRequest) {
  const n8n = resolveByN8nToken(req.headers["x-n8n-token"]);
  if (n8n) return n8n;

  const token = extractBearer(req.headers.authorization);
  if (!token) return { status: 401 as const };
  return resolveByJwt(token);
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const resolution = await resolveCredentials(req);
  if (resolution === undefined) {
    res.status(401).json(unauthorized);
    return;
  }
  if ("status" in resolution) {
    if (resolution.status === 401) res.status(401).json(unauthorized);
    return;
  }
  if ("error" in resolution) {
    next(resolution.error);
    return;
  }
  (req as AuthenticatedRequest).auth = resolution.auth;
  next();
};

export const requireAdmin: RequestHandler = async (req, res, next) => {
  const token = extractBearer(req.headers.authorization);
  if (!token) {
    res.status(401).json(unauthorized);
    return;
  }
  const resolution = await resolveByJwt(token);
  if ("error" in resolution) {
    next(resolution.error);
    return;
  }
  if ("status" in resolution) {
    res.status(401).json(unauthorized);
    return;
  }
  if (resolution.auth.rol !== "admin") {
    res.status(403).json(forbidden);
    return;
  }
  (req as AuthenticatedRequest).auth = resolution.auth;
  next();
};