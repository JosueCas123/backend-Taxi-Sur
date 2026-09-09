import bcrypt from "bcrypt";
import dotenv from "dotenv";
import { Prisma } from "@prisma/client";
import { z } from "zod";

export async function createAdmin(): Promise<number> {
  let prisma: typeof import("../config/prisma").prisma | undefined;
  let exitCode = 1;
  try {
    dotenv.config({ quiet: true });
    const credentials = z.object({
      ADMIN_EMAIL: z.email(),
      ADMIN_PHONE: z.string().refine((value) => value.trim().length > 0),
      ADMIN_PASSWORD: z.string().refine((value) =>
        Array.from(value).length >= 12 && Buffer.byteLength(value, "utf8") <= 72),
    }).safeParse(process.env);

    if (!credentials.success) {
      console.error("Credenciales invalidas: correo valido, telefono requerido y contrasena de al menos 12 caracteres y hasta 72 bytes UTF-8.");
      return 1;
    }

    prisma = (await import("../config/prisma")).prisma;
    const hashContrasena = await bcrypt.hash(credentials.data.ADMIN_PASSWORD, 12);
    // La unicidad de PostgreSQL incluye soft delete y arbitra carreras sin actualizar cuentas.
    await prisma.usuario.create({
      data: {
        rol: "admin",
        correoElectronico: credentials.data.ADMIN_EMAIL,
        telefono: credentials.data.ADMIN_PHONE,
        hashContrasena,
      },
      select: { id: true },
    });
    exitCode = 0;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      console.error("Ya existe una cuenta con ese correo o telefono.");
    } else {
      console.error("No se pudo crear el administrador.");
    }
  } finally {
    if (prisma) {
      try {
        await prisma.$disconnect();
      } catch {
        console.error("No se pudo cerrar la conexion del administrador.");
        exitCode = 1;
      }
    }
  }
  if (exitCode === 0) console.info("Administrador creado.");
  return exitCode;
}

if (require.main === module) {
  void createAdmin().then((exitCode) => { process.exitCode = exitCode; });
}
