// src/middleware/error.js
const isProd = process.env.NODE_ENV === "production";

export function errorHandler(err, req, res, _next) {
  const status = Number(err?.status || err?.statusCode || 500);

  const payload = {
    message: err?.message || "SERVER_ERROR",
    status,
    ...(err?.errors ? { errors: err.errors } : {}),
    ...(err?.code ? { code: err.code } : {}),
  };

  // log (more detailed in dev)
  if (isProd) {
    console.error("❌ ERROR:", {
      status,
      message: err?.message,
      path: req?.originalUrl,
      method: req?.method,
    });
  } else {
    console.error("❌ ERROR:", {
      status,
      message: err?.message,
      stack: err?.stack,
      code: err?.code,
      meta: err?.meta,
      path: req?.originalUrl,
      method: req?.method,
    });
  }

  // in prod you might want to hide internal messages for 500s
  if (isProd && status >= 500) {
    payload.message = "SERVER_ERROR";
  }

  return res.status(status).json(payload);
}
