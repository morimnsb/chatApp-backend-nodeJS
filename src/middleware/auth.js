// src/middleware/auth.js
import jwt from "jsonwebtoken";

export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;

  console.log("[authRequired] hit", {
    path: req.originalUrl,
    hasAuthHeader: Boolean(header),
    authPrefix: header ? header.slice(0, 12) : null,
  });

  if (!token) {
    return res.status(401).json({ message: "UNAUTHORIZED" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    req.user = { id: Number(payload.sub) };
    return next();
  } catch (e) {
    console.log("[authRequired] invalid token", { message: e?.message });
    return res.status(401).json({ message: "INVALID_TOKEN" });
  }
}
