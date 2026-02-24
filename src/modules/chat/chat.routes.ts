// chat-backend-node/src/modules/chat/chat.routes.ts
import { Router } from "express";

import { chatActionsLimiter } from "../../middleware/rateLimit.js";
import { authRequired } from "../../middleware/auth.js";
import * as controller from "./chat.controller.js";

const router = Router();

/**
 * Rooms
 * - support both /rooms and /rooms/
 */
router.get("/rooms", authRequired, controller.listRooms);
router.get("/rooms/", authRequired, controller.listRooms);

/**
 * Conversations
 * - support both /conversations and /conversations/
 */
router.get("/conversations", authRequired, controller.listConvos);
router.get("/conversations/", authRequired, controller.listConvos);

router.post("/conversations", authRequired, chatActionsLimiter, controller.createConvo);
router.post("/conversations/", authRequired, chatActionsLimiter, controller.createConvo);

/**
 * Messages
 * ✅ Frontend expects: /chat/rooms/:roomId/messages
 * ✅ Legacy supported: /messages/:roomId/
 */
router.get("/rooms/:roomId/messages", authRequired, controller.listMessages);
router.post("/rooms/:roomId/messages", authRequired, chatActionsLimiter, controller.sendMessage);

// legacy
router.get("/messages/:roomId", authRequired, controller.listMessages);
router.get("/messages/:roomId/", authRequired, controller.listMessages);

router.post("/messages/:roomId", authRequired, chatActionsLimiter, controller.sendMessage);
router.post("/messages/:roomId/", authRequired, chatActionsLimiter, controller.sendMessage);

/**
 * Friendship
 * ✅ match frontend: /api/chat/friendship
 */
router.post("/friendship", authRequired, controller.sendFriendship);

export default router;