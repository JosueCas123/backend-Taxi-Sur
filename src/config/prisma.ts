import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { env } from "./env";

// El adaptador es propietario del pool; $disconnect() tambien lo cierra.
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});

export const prisma = new PrismaClient({ adapter });
