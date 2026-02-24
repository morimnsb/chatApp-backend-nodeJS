// chat-backend-node/src/middleware/rateLimit.ts
import rateLimit from "express-rate-limit";
import type { Request, RequestHandler } from "express";

const windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000); // 1 min
const max = Number(process.env.RATE_LIMIT_MAX ?? 10); // 10 req / window

function firstForwardedFor(req: Request): string | null {
  const xff = req.headers["x-forwarded-for"];
  if (!xff) return null;

  const raw = Array.isArray(xff) ? xff[0] : String(xff);
  const first = raw.split(",")[0]?.trim();
  return first || null;
}

function safeIp(req: Request): string {
  // express populates req.ip (trust proxy affects it)
  const ip = (req.ip && String(req.ip).trim()) || "";
  if (ip) return ip;

  const xff = firstForwardedFor(req);
  if (xff) return xff;

  const ra = req.socket?.remoteAddress ? String(req.socket.remoteAddress).trim() : "";
  return ra || "unknown";
}

export const chatActionsLimiter: RequestHandler = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "RATE_LIMITED" },

  // ✅ MUST return string (or Promise<string>) - never undefined
  keyGenerator: (req: Request): string => {
    const uid = (req as any)?.user?.id as number | undefined;
    if (uid && Number.isFinite(uid) && uid > 0) return `u:${uid}`;
    return `ip:${safeIp(req)}`;
  },
});