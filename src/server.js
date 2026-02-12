// src/server.js
import "dotenv/config";
import http from "http";
import app from "./app.js";
import { attachWs } from "./realtime/socket.js";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";

const server = http.createServer(app);

// attach socket.io/ws
const io = attachWs(server, { corsOrigin: CORS_ORIGIN });

// start listening
server.listen(PORT, HOST, () => {
  const base = `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`;
  console.log(`API running on ${base}`);
  console.log(`Health: ${base}/api/health`);
  console.log(`Socket.IO: ws://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}/socket.io`);
});

// better error handling for startup
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`❌ Port ${PORT} is already in use.`);
  } else {
    console.error("❌ Server error:", err);
  }
  process.exit(1);
});

// graceful shutdown (CTRL+C, docker stop, etc.)
const shutdown = async (signal) => {
  console.log(`\n${signal} received. Shutting down...`);

  // close socket first if you return io from attachWs
  if (io?.close) {
    await new Promise((res) => io.close(res));
  }

  server.close((err) => {
    if (err) {
      console.error("❌ Error during shutdown:", err);
      process.exit(1);
    }
    console.log("✅ Shutdown complete.");
    process.exit(0);
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
