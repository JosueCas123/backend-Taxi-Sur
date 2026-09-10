import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { randomBytes, randomInt } from "node:crypto";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

let dummyHash: Promise<string> | undefined;

export async function loginAdmin(correo: string, password: string) {
  // Mantener trabajo bcrypt incluso cuando la cuenta no es autenticable.
  dummyHash ??= bcrypt.hash(randomBytes(32).toString("hex"), 12);
  const fallbackHash = await dummyHash;
  const user = await prisma.usuario.findUnique({
    where: { correoElectronico: correo },
    select: { id: true, rol: true, eliminadoEn: true, hashContrasena: true },
  });
  const eligible = user?.rol === "admin" && user.eliminadoEn === null && !!user.hashContrasena;
  // bcrypt trunca a 72 bytes: una extension de la clave no debe autenticar.
  const withinLimit = Buffer.byteLength(password, "utf8") <= 72;
  const matches = await bcrypt.compare(
    withinLimit ? password : "invalid-overlong-password",
    eligible && withinLimit ? user.hashContrasena! : fallbackHash,
  );
  if (!eligible || !withinLimit || !matches) return null;

  const expiresIn = 8 * 60 * 60;
  const token = jwt.sign({}, env.JWT_SECRET, {
    algorithm: "HS256", subject: user.id, expiresIn,
  });
  return { token, tokenType: "Bearer", expiresIn };
}

export async function loginConductor(telefono: string, pin: string) {
  dummyHash ??= bcrypt.hash(randomBytes(32).toString("hex"), 12);
  const fallbackHash = await dummyHash;
  const user = await prisma.usuario.findUnique({
    where: { telefono },
    select: { id: true, rol: true, eliminadoEn: true, hashContrasena: true },
  });
  const eligible = user?.rol === "conductor" && user.eliminadoEn === null && !!user.hashContrasena;
  // bcrypt trunca a 72 bytes: una extension del PIN no debe autenticar.
  const withinLimit = Buffer.byteLength(pin, "utf8") <= 72;
  const matches = await bcrypt.compare(
    withinLimit ? pin : "invalid-overlong-password",
    eligible && withinLimit ? user.hashContrasena! : fallbackHash,
  );
  if (!eligible || !withinLimit || !matches) return null;

  const expiresIn = 8 * 60 * 60;
  const token = jwt.sign({}, env.JWT_SECRET, {
    algorithm: "HS256", subject: user.id, expiresIn,
  });
  return { token, tokenType: "Bearer", expiresIn };
}

export type ResetearPinResult =
  | { ok: true; pin: string }
  | { ok: false; code: "NOT_FOUND" }
  | { ok: false; code: "VALIDATION_ERROR" };

export async function resetearPin(usuarioId: string): Promise<ResetearPinResult> {
  const user = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: { id: true, rol: true, eliminadoEn: true },
  });
  if (!user || user.eliminadoEn !== null) return { ok: false, code: "NOT_FOUND" };
  if (user.rol !== "conductor") return { ok: false, code: "VALIDATION_ERROR" };

  const pin = randomInt(100000, 999999).toString();
  const hash = await bcrypt.hash(pin, 12);
  await prisma.usuario.update({
    where: { id: user.id },
    data: { hashContrasena: hash },
  });
  return { ok: true, pin };
}
