import { it, expect } from "vitest";

it("Prisma consulta PostgreSQL real y la migracion existente esta aplicada", async () => {
  const { prisma } = await import("../src/config/prisma");
  try {
    const migrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM public._prisma_migrations
      WHERE migration_name = '20260909113507_init'
        AND finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    expect(migrations).toEqual([{ migration_name: "20260909113507_init" }]);
    // Comprobar acceso al esquema sin leer ni crear datos de negocio.
    await prisma.$queryRaw`SELECT id FROM public.usuarios LIMIT 0`;
  } catch {
    throw new Error("No se pudo verificar Prisma y la migracion en PostgreSQL de pruebas");
  } finally {
    try {
      await prisma.$disconnect();
    } catch {
      throw new Error("No se pudo cerrar Prisma de pruebas");
    }
  }
});
