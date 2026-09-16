import express from "express";
import cors from "cors";
import { errorHandler, notFound } from "./middlewares/error-handler";
import { authRouter } from "./modules/auth/auth.router";
import { configuracionRouter } from "./modules/configuracion/configuracion.router";
import { conductoresRouter } from "./modules/conductores/conductores.router";
import { motorAsignacionRouter } from "./modules/motor-asignacion/motor-asignacion.router";
import { pasajerosRouter } from "./modules/pasajeros/pasajeros.router";
import { ubicacionesRouter } from "./modules/ubicaciones/ubicaciones.router";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api/configuracion", configuracionRouter);
app.use("/api/conductores", conductoresRouter);
app.use("/api/conductores", ubicacionesRouter);
app.use("/api/pasajeros", pasajerosRouter);
app.use("/api/solicitudes", motorAsignacionRouter);

app.use(notFound);
app.use(errorHandler);

export default app;
