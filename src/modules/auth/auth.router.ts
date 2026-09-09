import { Router } from "express";
import { loginAdmin } from "./auth.controller";

export const authRouter = Router();
authRouter.post("/admin/login", loginAdmin);
