import express from "express";
import cors from "cors";
import { errorHandler, notFound } from "./middlewares/error-handler";
import { authRouter } from "./modules/auth/auth.router";
import { configuracionRouter } from "./modules/configuracion/configuracion.router";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api/configuracion", configuracionRouter);

app.use(notFound);
app.use(errorHandler);

export default app;
