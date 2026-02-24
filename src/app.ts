// chat-backend-node/src/app.ts
import express, { type Request, type Response, type NextFunction } from "express";
import cors, { type CorsOptions } from "cors";
import cookieParser from "cookie-parser";

import { errorHandler } from "./middleware/error.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import chatRoutes from "./modules/chat/chat.routes.js";

const app = express();

/* -------------------- config -------------------- */
const DEFAULT_ORIGIN = "http://localhost:5173";

/**
 * CORS_ORIGIN supported formats:
 * 1) single: "http://localhost:5173"
 * 2) list: "http://localhost:5173,http://127.0.0.1:5173"
 * 3) wildcard shortcuts:
 *    - "localhost"  -> allows http://localhost:anyPort and http://127.0.0.1:anyPort
 *    - "*"          -> allows any origin (NOT recommended with credentials)
 */
const CORS_ORIGIN_RAW = String(process.env.CORS_ORIGIN ?? DEFAULT_ORIGIN).trim();

/** Parse comma-separated origins into string[] or string */
function parseOriginList(raw: string): string | string[] {
  const s = String(raw || "").trim();
  if (!s) return DEFAULT_ORIGIN;

  // shortcut: allow localhost on any port
  if (s === "localhost") {
    return [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ];
  }

  if (!s.includes(",")) return s;

  const list = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  return list.length ? list : DEFAULT_ORIGIN;
}

/**
 * Build a "custom origin" checker so we can support:
 * - string
 * - string[]
 * - regex patterns (localhost:anyPort)
 * - null/undefined origin for non-browser clients
 */
function buildCorsOrigin(raw: string): CorsOptions["origin"] {
  const parsed = parseOriginList(raw);

  // NOTE: when credentials=true, using "*" is invalid in browsers.
  // But cors package can still accept it. We choose to "allow all" in dev if user explicitly sets "*".
  if (raw === "*") {
    return (origin, cb) => cb(null, true);
  }

  // Allow localhost:anyPort (dev convenience)
  const localhostAnyPort = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

  // Turn parsed into a Set for fast lookup
  const allowSet = new Set<string>(
    Array.isArray(parsed) ? parsed : [parsed]
  );

  return (origin, cb) => {
    // origin can be undefined for curl/postman/same-origin
    if (!origin) return cb(null, true);

    // exact allowlist
    if (allowSet.has(origin)) return cb(null, true);

    // dev-friendly allow localhost:* even if not explicitly listed
    if (localhostAnyPort.test(origin)) return cb(null, true);

    // otherwise block
    return cb(new Error(`CORS_BLOCKED: ${origin}`));
  };
}

const ENABLE_CHATMEETUP_ALIAS =
  String(process.env.ENABLE_CHATMEETUP_ALIAS || "true") === "true";

/* -------------------- CORS (REST) -------------------- */
const corsOptions: CorsOptions = {
  origin: buildCorsOrigin(CORS_ORIGIN_RAW),
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
};

app.use(cors(corsOptions));

// ✅ preflight: Express 5 با "*" تو بعضی نسخه‌ها/پکیج‌ها مشکل path-to-regexp میده
// پس به جای app.options("*", ...) از middleware عمومی استفاده می‌کنیم
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    return cors(corsOptions)(req, res, next);
  }
  next();
});

/* -------------------- parsers -------------------- */
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* -------------------- caching -------------------- */
app.set("etag", false);

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
});

/* -------------------- request logger (safe) -------------------- */
app.use((req: Request, res: Response, next: NextFunction) => {
  const auth = String(req.headers.authorization || "");
  const authType = auth.startsWith("Bearer ") ? "Bearer" : auth ? "Other" : "None";

  console.log("[REQ]", req.method, req.originalUrl, {
    auth: authType,
    origin: req.headers.origin ?? null,
  });

  res.on("finish", () => {
    console.log("[RES]", req.method, req.originalUrl, res.statusCode);
  });

  next();
});

/* -------------------- health -------------------- */
app.get("/api/health", (_req: Request, res: Response) => {
  return res.status(200).json({ ok: true });
});

/* -------------------- routes -------------------- */
app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);

if (ENABLE_CHATMEETUP_ALIAS) {
  app.use("/api/chatMeetUp", chatRoutes);
}

/* -------------------- 404 -------------------- */
app.use("/api", (_req: Request, res: Response) => {
  return res.status(404).json({ message: "NOT_FOUND" });
});

/* -------------------- errors (single place) -------------------- */
app.use(errorHandler);

export default app;