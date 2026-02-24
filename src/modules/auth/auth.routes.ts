// chat-backend-node/src/modules/auth/auth.routes.ts
import { Router, type RequestHandler } from "express";

import * as controller from "./auth.controller.js";
import { authRequired } from "../../middleware/auth.js";

const router = Router();

/* -------------------- public -------------------- */

router.post("/register", controller.register as RequestHandler);
router.post("/verify-email", controller.verifyEmail as RequestHandler);
router.post("/login", controller.login as RequestHandler);
router.post("/refresh", controller.refresh as RequestHandler);
router.post("/resend-verify", controller.resendVerifyCode as RequestHandler);

/* -------------------- protected -------------------- */

router.post("/logout", authRequired, controller.logout as RequestHandler);

router.get("/me", authRequired, controller.me as RequestHandler);
router.get("/users", authRequired, controller.listUsers as RequestHandler);

export { router as authRoutes };