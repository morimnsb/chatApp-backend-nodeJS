// chat-backend-node/src/server.ts
import "dotenv/config";
import { createServer, type Server as HttpServer } from "http";
import type { AddressInfo } from "net";

import app from "./app.js";
import { attachWs } from "./realtime/socket.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = String(process.env.HOST ?? "0.0.0.0");
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:5173";
const SOCKET_PATH = process.env.SOCKET_PATH ?? "/socket.io";

const server: HttpServer = createServer(app);

// attach socket.io/ws
const io = attachWs(server, { corsOrigin: CORS_ORIGIN, socketPath: SOCKET_PATH });

// start listening
server.listen(PORT, HOST, () => {
  const addr = server.address() as AddressInfo | null;
  const actualPort = addr?.port ?? PORT;

  const hostPrintable = HOST === "0.0.0.0" ? "localhost" : HOST;
  const base = `http://${hostPrintable}:${actualPort}`;

  console.log(`API running on ${base}`);
  console.log(`Health: ${base}/api/health`);
  console.log(`Socket.IO: ws://${hostPrintable}:${actualPort}${SOCKET_PATH}`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") console.error(`❌ Port ${PORT} is already in use.`);
  else console.error("❌ Server error:", err);
  process.exit(1);
});

// graceful shutdown
const shutdown = async (signal: NodeJS.Signals) => {
  console.log(`\n${signal} received. Shutting down...`);

  try {
    if (io && typeof io.close === "function") {
      await new Promise<void>((resolve) => io.close(() => resolve()));
    }

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });

    console.log("✅ Shutdown complete.");
    process.exit(0);
  } catch (e) {
    console.error("❌ Error during shutdown:", e);
    process.exit(1);
  }
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));