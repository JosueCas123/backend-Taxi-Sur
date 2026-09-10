import { Router } from "express";
import type { RequestHandler } from "express";
import { loginAdmin, loginConductor, resetearPin } from "./auth.controller";

const requireAdminLazy: RequestHandler = (req, res, next) => {
  void import("../../middlewares/auth").then(({ requireAdmin }) => requireAdmin(req, res, next)).catch(next);
};

export const authRouter = Router();
authRouter.post("/admin/login", loginAdmin);
authRouter.post("/conductor/login", loginConductor);
authRouter.patch("/conductor/:id/resetear-pin", requireAdminLazy, resetearPin);
