// src/app.js
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { errorHandler } from "./middleware/error.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import chatRoutes from "./modules/chat/chat.routes.js";

const app = express();

// ---- config
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

// ---- CORS (REST)
app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // پیشنهاد: allowedHeaders رو حذف کن تا preflightها کمتر بشکنن
    // allowedHeaders: ["Content-Type", "Authorization", "Cache-Control", "Pragma"],
  })
);

// ---- parsers
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ---- disable etag caching
app.set("etag", false);

// ---- disable caching for API responses
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

// ---- request logger (safe)
app.use((req, res, next) => {
  const auth = req.headers.authorization || "";
  const authType = auth.startsWith("Bearer ") ? "Bearer" : auth ? "Other" : "None";

  console.log("[REQ]", req.method, req.originalUrl, {
    auth: authType,
    origin: req.headers.origin || null,
  });

  res.on("finish", () => {
    console.log("[RES]", req.method, req.originalUrl, res.statusCode);
  });

  next();
});

// ---- health
app.get("/api/health", (_req, res) => res.status(200).json({ ok: true }));

// ---- routes
app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);


// alias (اگر واقعاً لازمه)
app.use("/api/chatMeetUp", chatRoutes);

// ---- 404 for unknown API routes
app.use("/api", (_req, res) => {
  res.status(404).json({ message: "NOT_FOUND" });
});

// ---- errors (single place)
app.use(errorHandler);

export default app;
