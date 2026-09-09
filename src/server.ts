import { createServer } from "node:http";
import app from "./app";

async function start() {
  const { env } = await import("./config/env");
  const { prisma } = await import("./config/prisma");
  const server = createServer(app);
  let closing = false;

  async function shutdown() {
    if (closing) return;
    closing = true;

    const timeout = setTimeout(() => {
      console.error("Se agoto el tiempo de cierre del backend.");
      process.exit(1);
    }, 10000);
    timeout.unref();

    try {
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      }
    } finally {
      try {
        await prisma.$disconnect();
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  const stop = () => {
    void shutdown().catch(() => {
      console.error("No se pudieron cerrar los recursos del backend.");
      process.exitCode = 1;
    });
  };

  try {
    // Inicializa el pool sin consultar la base: health es liveness, no readiness.
    await prisma.$connect();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    server.on("error", () => {
      console.error("No se pudo iniciar o mantener el servidor HTTP.");
      process.exitCode = 1;
      stop();
    });
    server.listen(env.PORT, () => {
      console.log(`Backend corriendo en http://localhost:${env.PORT}`);
    });
  } catch {
    await shutdown();
    throw new Error("Fallo de inicializacion del backend.");
  }
}

void start().catch(() => {
  console.error("No se pudo iniciar el backend. Revisa la configuracion y los recursos.");
  process.exitCode = 1;
});
