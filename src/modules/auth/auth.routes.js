import { Router } from "express";
import * as controller from "./auth.controller.js";
import { authRequired } from "../../middleware/auth.js";

const router = Router();

router.post("/register", controller.register);
router.post("/verify-email", controller.verifyEmail);
router.post("/login", controller.login);
router.post("/refresh", controller.refresh);
router.post("/logout", authRequired, controller.logout);

router.get("/me", authRequired, controller.me);          // ✅
router.get("/users", authRequired, controller.listUsers); // ✅ این مهمه
router.post("/resend-verify", controller.resendVerifyCode);

export { router as authRoutes };
