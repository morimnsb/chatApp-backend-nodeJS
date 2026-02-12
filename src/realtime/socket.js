// src/realtime/socket.js
import { Server } from "socket.io";
import jwt from "jsonwebtoken";

const DEV = process.env.NODE_ENV !== "production";
const DEBUG = DEV && String(process.env.SOCKET_DEBUG || "true") === "true";
const log = (...a) => DEBUG && console.log("[socket]", ...a);

// ---------------------- singleton io ----------------------
let _io = null;
export function getIo() {
  return _io;
}

// ---------------------- helpers ----------------------
const toInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function stripBearer(t) {
  return String(t || "").replace(/^Bearer\s+/i, "").trim();
}

function getTokenFromHandshake(socket) {
  const t1 = socket.handshake?.auth?.token; // socketClient auth:{token}
  const t2 = socket.handshake?.headers?.authorization; // Bearer ...
  return stripBearer(t1 || t2 || "");
}

function toUserIdFromAccessToken(payload) {
  const sub = payload?.sub ?? null;
  const n = Number(sub);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ---------------------- presence store ----------------------
// userId -> Set(socketId)
const online = new Map();

function setOnline(userId, socketId) {
  const uid = toInt(userId);
  if (!uid) return;
  if (!online.has(uid)) online.set(uid, new Set());
  online.get(uid).add(socketId);
}

function setOffline(userId, socketId) {
  const uid = toInt(userId);
  if (!uid) return;
  const set = online.get(uid);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) online.delete(uid);
}

function onlineIds() {
  return Array.from(online.keys()).map(Number);
}

function broadcastPresence() {
  if (!_io) return;
  const ids = onlineIds();
  _io.emit("presence:online", { ids, count: ids.length });
}

// ---------------------- room presence store (FIXED for multi-tab) ----------------------
// roomId -> Map(userId -> countSocketsInRoom)
const roomUsers = new Map();
// socketId -> Set(roomId)
const socketRooms = new Map();

function roomMap(rid) {
  if (!roomUsers.has(rid)) roomUsers.set(rid, new Map());
  return roomUsers.get(rid);
}

function addUserToRoom(socketId, userId, roomId) {
  const sid = String(socketId);
  const uid = toInt(userId);
  const rid = toInt(roomId);
  if (!uid || !rid) return;

  const uMap = roomMap(rid);
  uMap.set(uid, (uMap.get(uid) || 0) + 1);

  if (!socketRooms.has(sid)) socketRooms.set(sid, new Set());
  socketRooms.get(sid).add(rid);
}

function removeUserFromRoom(socketId, userId, roomId) {
  const sid = String(socketId);
  const uid = toInt(userId);
  const rid = toInt(roomId);
  if (!uid || !rid) return;

  const uMap = roomUsers.get(rid);
  if (uMap) {
    const nextCount = (uMap.get(uid) || 0) - 1;
    if (nextCount <= 0) uMap.delete(uid);
    else uMap.set(uid, nextCount);
    if (uMap.size === 0) roomUsers.delete(rid);
  }

  const rSet = socketRooms.get(sid);
  if (rSet) {
    rSet.delete(rid);
    if (rSet.size === 0) socketRooms.delete(sid);
  }
}

function cleanupSocketRooms(socketId, userId) {
  const sid = String(socketId);
  const uid = toInt(userId);
  const rSet = socketRooms.get(sid);
  if (!rSet || !uid) return;

  for (const rid of rSet) {
    const uMap = roomUsers.get(rid);
    if (!uMap) continue;

    const nextCount = (uMap.get(uid) || 0) - 1;
    if (nextCount <= 0) uMap.delete(uid);
    else uMap.set(uid, nextCount);

    if (uMap.size === 0) roomUsers.delete(rid);
  }

  socketRooms.delete(sid);
}

export function isUserInRoom(roomId, userId) {
  const rid = toInt(roomId);
  const uid = toInt(userId);
  if (!rid || !uid) return false;

  const uMap = roomUsers.get(rid);
  return Boolean(uMap && uMap.has(uid));
}

// ---------------------- typing indicator store ----------------------
// key: `${roomId}:${userId}` -> timeoutId
const typingTimers = new Map();

function typingKey(roomId, userId) {
  const rid = toInt(roomId);
  const uid = toInt(userId);
  if (!rid || !uid) return null;
  return `${rid}:${uid}`;
}

function clearTypingTimer(roomId, userId) {
  const key = typingKey(roomId, userId);
  if (!key) return;
  const t = typingTimers.get(key);
  if (t) clearTimeout(t);
  typingTimers.delete(key);
}

// ---------------------- JSON safety (fix parse error) ----------------------
function jsonSafe(obj) {
  return JSON.parse(
    JSON.stringify(obj, (k, v) => {
      if (typeof v === "bigint") {
        const n = Number(v);
        return Number.isSafeInteger(n) ? n : v.toString();
      }
      if (v instanceof Date) return v.toISOString();
      if (typeof v === "undefined") return null;
      return v;
    })
  );
}

// ---------------------- broadcast helpers ----------------------
export function broadcastToRoom(roomId, payload, eventName = "chat:message") {
  if (!_io) return false;
  const rid = toInt(roomId);
  if (!rid) return false;

  _io.to(`room:${rid}`).emit(eventName, jsonSafe(payload));
  return true;
}

export function broadcastToUser(userId, payload, eventName = "chat:message") {
  if (!_io) return false;
  const uid = toInt(userId);
  if (!uid) return false;

  _io.to(`user:${uid}`).emit(eventName, jsonSafe(payload));
  return true;
}

export function broadcastRoomAndNotifyAbsent(roomId, payload, memberUserIds = [], senderId = null) {
  const rid = toInt(roomId);
  if (!rid) return false;

  broadcastToRoom(rid, payload, "chat:message");

  const sid = toInt(senderId);
  for (const u of memberUserIds || []) {
    const uid = toInt(u);
    if (!uid) continue;
    if (sid && uid === sid) continue;

    if (!isUserInRoom(rid, uid)) {
      broadcastToUser(uid, payload, "chat:notify");
    }
  }

  return true;
}

// ---------------------- typing emitter ----------------------
function buildTypingPayload({ rid, userId, isTyping, reason = null }) {
  return {
    type: "typing_indicator",
    roomId: rid,
    room_id: rid,
    userId,
    user_id: userId,
    isTyping: Boolean(isTyping),
    at: Date.now(),
    ...(reason ? { reason } : {}),
  };
}

function emitTypingToRoom({ rid, userId, isTyping, reason = null }) {
  if (!_io) return;
  _io.to(`room:${rid}`).emit("typing_indicator", buildTypingPayload({ rid, userId, isTyping, reason }));
}

// ---------------------- attach socket.io ----------------------
export function attachWs(
  server,
  {
    corsOrigin = process.env.CORS_ORIGIN || "http://localhost:5173",
    socketPath = process.env.SOCKET_PATH || "/socket.io",
  } = {}
) {
  const io = new Server(server, {
    path: socketPath,
    cors: {
      origin: corsOrigin,
      methods: ["GET", "POST"],
      credentials: true,
      // ✅ do NOT hard-lock allowedHeaders (avoid preflight breaks)
    },
  });

  _io = io;

  // ---------- auth middleware ----------
  io.use((socket, next) => {
    const token = getTokenFromHandshake(socket);
    const accessSecret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || "";

    if (DEBUG) {
      log("handshake", {
        hasToken: Boolean(token),
        tokenLen: token ? token.length : 0,
        origin: socket.handshake?.headers?.origin || null,
        accessSecretSet: Boolean(accessSecret),
        path: socketPath,
      });
    }

    if (!token) {
      const err = new Error("UNAUTHORIZED");
      err.data = { reason: "missing_token" };
      return next(err);
    }

    if (!accessSecret) {
      const err = new Error("UNAUTHORIZED");
      err.data = { reason: "missing_JWT_ACCESS_SECRET" };
      return next(err);
    }

    try {
      const payload = jwt.verify(token, accessSecret);
      const userId = toUserIdFromAccessToken(payload);

      if (!userId) {
        const err = new Error("UNAUTHORIZED");
        err.data = { reason: "bad_payload_no_sub", keys: Object.keys(payload || {}) };
        return next(err);
      }

      socket.user = { id: userId };
      return next();
    } catch (e) {
      if (DEBUG) log("jwt verify failed", { name: e?.name, message: e?.message });
      const err = new Error("UNAUTHORIZED");
      err.data = { reason: "jwt_verify_failed", name: e?.name, message: e?.message };
      return next(err);
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.user?.id;
    log("connected", { socketId: socket.id, userId });

    setOnline(userId, socket.id);
    socket.join(`user:${userId}`);

    // initial presence snapshot
    socket.emit("presence:online", { ids: onlineIds(), count: online.size });

    socket.broadcast.emit("presence:join", { userId });
    broadcastPresence();

    // join room
    socket.on("room:join", ({ roomId }) => {
      const rid = toInt(roomId);
      if (!rid) return;

      const already = socketRooms.get(String(socket.id))?.has(rid);
      if (already) return;

      socket.join(`room:${rid}`);
      addUserToRoom(socket.id, userId, rid);

      log("room:join", { userId, roomId: rid });
    });

    // leave room
    socket.on("room:leave", ({ roomId }) => {
      const rid = toInt(roomId);
      if (!rid) return;

      const joined = socketRooms.get(String(socket.id))?.has(rid);
      if (!joined) return;

      socket.leave(`room:${rid}`);
      removeUserFromRoom(socket.id, userId, rid);

      // stop typing for this room if leaving
      clearTypingTimer(rid, userId);
      emitTypingToRoom({ rid, userId, isTyping: false, reason: "leave" });

      log("room:leave", { userId, roomId: rid });
    });

    // typing indicator (standard)
    socket.on("typing_indicator", ({ roomId, isTyping }) => {
      const rid = toInt(roomId);
      if (!rid) return;

      const typing = Boolean(isTyping);

      clearTypingTimer(rid, userId);
      emitTypingToRoom({ rid, userId, isTyping: typing });

      if (typing) {
        const key = typingKey(rid, userId);
        if (!key) return;

        const timeoutId = setTimeout(() => {
          typingTimers.delete(key);
          emitTypingToRoom({ rid, userId, isTyping: false, reason: "timeout" });
        }, 3000);

        typingTimers.set(key, timeoutId);
      }
    });

    // backward compatibility: legacy "typing"
    socket.on("typing", ({ roomId, isTyping }) => {
      const rid = toInt(roomId);
      if (!rid) return;
      // route to new behavior
      socket.emit("typing_indicator", { roomId: rid, isTyping: Boolean(isTyping) });
    });

    socket.on("disconnect", (reason) => {
      log("disconnect", { socketId: socket.id, userId, reason });

      const joined = socketRooms.get(String(socket.id));
      if (joined) {
        for (const rid of joined) {
          clearTypingTimer(rid, userId);
          emitTypingToRoom({ rid, userId, isTyping: false, reason: "disconnect" });
        }
      }

      cleanupSocketRooms(socket.id, userId);
      setOffline(userId, socket.id);

      socket.broadcast.emit("presence:leave", { userId });
      broadcastPresence();
    });
  });

  return io;
}
