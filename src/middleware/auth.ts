// chat-backend-node/src/middleware/auth.ts
import type { RequestHandler } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";

export type AuthedUser = { id: number };

function stripBearer(v: unknown): string {
  return String(v ?? "").replace(/^Bearer\s+/i, "").trim();
}

function parseUserIdFromSub(payload: JwtPayload): number | null {
  const sub = (payload as any)?.sub;
  const userId = Number(sub);
  if (!Number.isFinite(userId) || userId <= 0) return null;
  return userId;
}

export const authRequired: RequestHandler = (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = stripBearer(header);

  console.log("[authRequired] hit", {
    path: req.originalUrl,
    hasAuthHeader: Boolean(header),
    authPrefix: header ? header.slice(0, 12) : null,
  });

  if (!token) return res.status(401).json({ message: "UNAUTHORIZED" });

  const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || "";
  if (!secret) {
    return res.status(500).json({
      message: "SERVER_MISCONFIG",
      reason: "missing JWT_ACCESS_SECRET",
    });
  }

  try {
    const payload = jwt.verify(token, secret) as JwtPayload;

    const userId = parseUserIdFromSub(payload);
    if (!userId) {
      return res.status(401).json({ message: "INVALID_TOKEN", reason: "bad_sub" });
    }

    // ✅ type-safe
    req.user = { id: userId } satisfies AuthedUser;

    return next();
  } catch (e: any) {
    console.log("[authRequired] invalid token", { message: e?.message || String(e) });
    return res.status(401).json({ message: "INVALID_TOKEN" });
  }
};