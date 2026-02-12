// chat-backend-node/src/modules/chat/chat.routes.js
import { Router } from "express";
import { chatActionsLimiter } from "../../middleware/rateLimit.js";
import { authRequired } from "../../middleware/auth.js";
import * as controller from "./chat.controller.js";

const router = Router();

router.get("/rooms/", authRequired, controller.listRooms);

router.get("/conversations/", authRequired, controller.listConvos);
router.post("/conversations/", authRequired, chatActionsLimiter, controller.createConvo);

router.get("/messages/:roomId/", authRequired, controller.listMessages);
router.post("/messages/:roomId/", authRequired, chatActionsLimiter, controller.sendMessage);


// ✅ match frontend: /api/chatMeetUp/friendship
router.post("/friendship", authRequired, controller.sendFriendship);

export default router;
