import rateLimit, { ipKeyGenerator } from "express-rate-limit";

export const chatActionsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userId = req.user?.id;
    if (userId) return `chat:${userId}`;
    return `chat:${ipKeyGenerator(req)}`;
  },
});
