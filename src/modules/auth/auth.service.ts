import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
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
