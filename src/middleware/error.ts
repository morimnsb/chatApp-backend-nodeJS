// chat-backend-node/src/middleware/error.ts
import type { ErrorRequestHandler, Request } from "express";

const isProd = process.env.NODE_ENV === "production";

/** Optional structured error shape used across app */
export type AppErrorLike = {
  message?: string;
  name?: string;
  stack?: string;

  status?: number;
  statusCode?: number;

  code?: string | number;
  errors?: unknown;
  meta?: unknown;
};

type ErrorPayload = {
  message: string;
  status: number;
  errors?: unknown;
  code?: string | number;
};

/* ------------------------- helpers ------------------------- */
function getReqMeta(req: Request) {
  return {
    path: req?.originalUrl,
    method: req?.method,
  };
}

function toAppError(err: unknown): AppErrorLike {
  if (err instanceof Error) return err as any;

  if (err && typeof err === "object") {
    const o = err as any;
    return {
      message: typeof o.message === "string" ? o.message : undefined,
      name: typeof o.name === "string" ? o.name : undefined,
      stack: typeof o.stack === "string" ? o.stack : undefined,

      status: typeof o.status === "number" ? o.status : undefined,
      statusCode: typeof o.statusCode === "number" ? o.statusCode : undefined,

      code: o.code,
      errors: o.errors,
      meta: o.meta,
    };
  }

  // string / number / boolean
  return { message: typeof err === "string" ? err : String(err) };
}

function clampStatus(n: unknown): number {
  const s = Number(n);
  if (!Number.isFinite(s)) return 500;
  if (s < 100) return 500;
  if (s > 599) return 500;
  return s;
}

/* ------------------------- middleware ------------------------- */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const e = toAppError(err);

  const status = clampStatus(e.status ?? e.statusCode ?? 500);

  const payload: ErrorPayload = {
    message: e.message || "SERVER_ERROR",
    status,
    ...(e.errors ? { errors: e.errors } : {}),
    ...(e.code ? { code: e.code } : {}),
  };

  // log (more detailed in dev)
  if (isProd) {
    console.error("❌ ERROR:", {
      status,
      message: e.message,
      ...getReqMeta(req),
    });
  } else {
    console.error("❌ ERROR:", {
      status,
      message: e.message,
      stack: e.stack,
      code: e.code,
      meta: e.meta,
      ...getReqMeta(req),
    });
  }

  // in prod hide internal messages for 500s
  if (isProd && status >= 500) {
    payload.message = "SERVER_ERROR";
  }

  return res.status(status).json(payload);
};