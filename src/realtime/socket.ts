// chat-backend-node/src/realtime/socket.ts
import { Server, type Socket } from "socket.io";
import jwt, { type JwtPayload } from "jsonwebtoken";
import type { Server as HttpServer } from "http";

/* ---------------------- env / debug ---------------------- */
const DEV = process.env.NODE_ENV !== "production";
const DEBUG = DEV && String(process.env.SOCKET_DEBUG || "true") === "true";
const log = (...a: any[]) => DEBUG && console.log("[socket]", ...a);

/* ---------------------- types ---------------------- */
type Id = number;

export type AttachWsOptions = {
  corsOrigin?: string;
  socketPath?: string;
};

// inbound from client
type RoomJoinPayload = { roomId: string | number };
type TypingIndicatorPayload = { roomId: string | number; isTyping: boolean };

// outbound to client
type PresenceOnlinePayload = { ids: number[]; count: number };
type PresenceJoinLeavePayload = { userId: number };
type TypingBroadcastPayload = {
  type: "typing_indicator";
  roomId: number;
  room_id: number;
  userId: number;
  user_id: number;
  isTyping: boolean;
  at: number;
  reason?: string;
};

// event maps
type ClientToServerEvents = {
  "room:join": (p: RoomJoinPayload) => void;
  "room:leave": (p: RoomJoinPayload) => void;
  typing_indicator: (p: TypingIndicatorPayload) => void;
  typing: (p: TypingIndicatorPayload) => void;
};

type ServerToClientEvents = {
  "presence:online": (p: PresenceOnlinePayload) => void;
  "presence:join": (p: PresenceJoinLeavePayload) => void;
  "presence:leave": (p: PresenceJoinLeavePayload) => void;

  typing_indicator: (p: TypingBroadcastPayload) => void;

  // generic (payload from services)
  "chat:message": (p: any) => void;
  "chat:notify": (p: any) => void;
};

type InterServerEvents = Record<string, never>;
type SocketData = { user?: { id: Id } };

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type AppIo = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;



/* ---------------------- singleton io ---------------------- */
let _io: AppIo | null = null;

export function getIo(): AppIo | null {
  return _io;
}

/* ---------------------- helpers ---------------------- */
const toInt = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function stripBearer(t: unknown): string {
  return String(t ?? "").replace(/^Bearer\s+/i, "").trim();
}

function getTokenFromHandshake(socket: AppSocket): string {
  const t1 = (socket.handshake as any)?.auth?.token;
  const t2 = socket.handshake?.headers?.authorization;
  return stripBearer(t1 || t2 || "");
}

function toUserIdFromAccessToken(payload: JwtPayload): number | null {
  const sub = (payload as any)?.sub;
  const n = Number(sub);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ---------------------- presence store ---------------------- */
// userId -> Set(socketId)
const online = new Map<number, Set<string>>();

function setOnline(userId: unknown, socketId: string) {
  const uid = toInt(userId);
  if (!uid) return;
  if (!online.has(uid)) online.set(uid, new Set());
  online.get(uid)!.add(socketId);
}

function setOffline(userId: unknown, socketId: string) {
  const uid = toInt(userId);
  if (!uid) return;
  const set = online.get(uid);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) online.delete(uid);
}

function onlineIds(): number[] {
  return Array.from(online.keys()).map(Number);
}

function broadcastPresence() {
  if (!_io) return;
  const ids = onlineIds();
  _io.emit("presence:online", { ids, count: ids.length });
}

/* ---------------------- room presence store (multi-tab safe) ---------------------- */
// roomId -> Map(userId -> countSocketsInRoom)
const roomUsers = new Map<number, Map<number, number>>();
// socketId -> Set(roomId)
const socketRooms = new Map<string, Set<number>>();

function roomMap(rid: number): Map<number, number> {
  if (!roomUsers.has(rid)) roomUsers.set(rid, new Map());
  return roomUsers.get(rid)!;
}

function addUserToRoom(socketId: string, userId: unknown, roomId: unknown) {
  const sid = String(socketId);
  const uid = toInt(userId);
  const rid = toInt(roomId);
  if (!uid || !rid) return;

  const uMap = roomMap(rid);
  uMap.set(uid, (uMap.get(uid) || 0) + 1);

  if (!socketRooms.has(sid)) socketRooms.set(sid, new Set());
  socketRooms.get(sid)!.add(rid);
}

function removeUserFromRoom(socketId: string, userId: unknown, roomId: unknown) {
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

function cleanupSocketRooms(socketId: string, userId: unknown) {
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

export function isUserInRoom(roomId: unknown, userId: unknown): boolean {
  const rid = toInt(roomId);
  const uid = toInt(userId);
  if (!rid || !uid) return false;

  const uMap = roomUsers.get(rid);
  return Boolean(uMap && uMap.has(uid));
}

// ✅ only broadcast typing if there is at least one OTHER user in room
function hasOtherUsersInRoom(roomId: unknown, senderUserId: unknown): boolean {
  const rid = toInt(roomId);
  const sid = toInt(senderUserId);
  if (!rid || !sid) return false;

  const uMap = roomUsers.get(rid);
  if (!uMap || uMap.size === 0) return false;

  for (const [uid, count] of uMap.entries()) {
    if (Number(uid) !== sid && Number(count) > 0) return true;
  }
  return false;
}

/* ---------------------- typing indicator store ---------------------- */
const typingTimers = new Map<string, NodeJS.Timeout>();

function typingKey(roomId: unknown, userId: unknown): string | null {
  const rid = toInt(roomId);
  const uid = toInt(userId);
  if (!rid || !uid) return null;
  return `${rid}:${uid}`;
}

function clearTypingTimer(roomId: unknown, userId: unknown) {
  const key = typingKey(roomId, userId);
  if (!key) return;
  const t = typingTimers.get(key);
  if (t) clearTimeout(t);
  typingTimers.delete(key);
}

/* ---------------------- JSON safety ---------------------- */
function jsonSafe<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_k, v) => {
      if (typeof v === "bigint") {
        const n = Number(v);
        return Number.isSafeInteger(n) ? n : v.toString();
      }
      if (v instanceof Date) return v.toISOString();
      if (typeof v === "undefined") return null;
      return v;
    })
  ) as T;
}

/* ---------------------- broadcast helpers ---------------------- */
/* ---------------------- broadcast helpers ---------------------- */
type KnownServerEvent = keyof ServerToClientEvents;

// overloads
export function broadcastToRoom<E extends KnownServerEvent>(
  roomId: unknown,
  payload: Parameters<ServerToClientEvents[E]>[0],
  eventName: E
): boolean;
export function broadcastToRoom<E extends KnownServerEvent>(
  roomId: unknown,
  payload: Parameters<ServerToClientEvents[E]>[0],
  eventName: E
): boolean;
export function broadcastToRoom(
  roomId: unknown,
  payload: any,
  eventName?: string
): boolean;

export function broadcastToRoom(
  roomId: unknown,
  payload: any,
  eventName: string = "chat:message"
): boolean {
  if (!_io) return false;
  const rid = toInt(roomId);
  if (!rid) return false;

  (_io.to(`room:${rid}`) as any).emit(eventName, jsonSafe(payload));
  return true;
}

export function broadcastToUser<E extends KnownServerEvent>(
  userId: unknown,
  payload: Parameters<ServerToClientEvents[E]>[0],
  eventName: E
): boolean;
export function broadcastToUser(
  userId: unknown,
  payload: any,
  eventName?: string
): boolean;

export function broadcastToUser(
  userId: unknown,
  payload: any,
  eventName: string = "chat:message"
): boolean {
  if (!_io) return false;
  const uid = toInt(userId);
  if (!uid) return false;

  (_io.to(`user:${uid}`) as any).emit(eventName, jsonSafe(payload));
  return true;
}

export function broadcastRoomAndNotifyAbsent(
  roomId: unknown,
  payload: any,
  memberUserIds: unknown[] = [],
  senderId: unknown = null
): boolean {
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

/* ---------------------- typing emitter ---------------------- */
function buildTypingPayload(args: {
  rid: number;
  userId: number;
  isTyping: boolean;
  reason?: string | null;
}): TypingBroadcastPayload {
  const { rid, userId, isTyping, reason } = args;
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

function emitTypingToRoom(args: {
  rid: number;
  userId: number;
  isTyping: boolean;
  reason?: string | null;
  excludeSocketId?: string | null;
}) {
  if (!_io) return;

  const { rid, userId, isTyping, reason = null, excludeSocketId = null } = args;

  // ✅ do NOT send typing if nobody else is in the room
  if (!hasOtherUsersInRoom(rid, userId)) return;

  const payload = buildTypingPayload({ rid, userId, isTyping, reason });

  if (excludeSocketId) {
    _io.to(`room:${rid}`).except(excludeSocketId).emit("typing_indicator", payload);
  } else {
    _io.to(`room:${rid}`).emit("typing_indicator", payload);
  }
}

/* ---------------------- attach socket.io ---------------------- */
export function attachWs(
  server: HttpServer,
  {
    corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173",
    socketPath = process.env.SOCKET_PATH ?? "/socket.io",
  }: AttachWsOptions = {}
): AppIo {
  const io: AppIo = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(server, {
    path: socketPath,
    cors: {
      origin: corsOrigin,
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  _io = io;

  // ---------- auth middleware ----------
  io.use((socket: AppSocket, next) => {
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
      const err = new Error("UNAUTHORIZED") as any;
      err.data = { reason: "missing_token" };
      return next(err);
    }

    if (!accessSecret) {
      const err = new Error("UNAUTHORIZED") as any;
      err.data = { reason: "missing_JWT_ACCESS_SECRET" };
      return next(err);
    }

    try {
      const payload = jwt.verify(token, accessSecret) as JwtPayload;
      const userId = toUserIdFromAccessToken(payload);

      if (!userId) {
        const err = new Error("UNAUTHORIZED") as any;
        err.data = { reason: "bad_payload_no_sub", keys: Object.keys(payload || {}) };
        return next(err);
      }

      socket.data.user = { id: userId };
      return next();
    } catch (e: any) {
      if (DEBUG) log("jwt verify failed", { name: e?.name, message: e?.message });
      const err = new Error("UNAUTHORIZED") as any;
      err.data = { reason: "jwt_verify_failed", name: e?.name, message: e?.message };
      return next(err);
    }
  });

  io.on("connection", (socket: AppSocket) => {
    const userId = socket.data.user?.id;
    log("connected", { socketId: socket.id, userId });

    if (!userId) {
      socket.disconnect(true);
      return;
    }

    setOnline(userId, socket.id);
    socket.join(`user:${userId}`);

    // initial presence snapshot
    const ids = onlineIds();
socket.emit("presence:online", { ids, count: ids.length });

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

      // stop typing for this room if leaving (exclude sender)
      clearTypingTimer(rid, userId);
      emitTypingToRoom({
        rid,
        userId,
        isTyping: false,
        reason: "leave",
        excludeSocketId: socket.id,
      });

      log("room:leave", { userId, roomId: rid });
    });

    // typing indicator (standard)
    socket.on("typing_indicator", ({ roomId, isTyping }) => {
      const rid = toInt(roomId);
      if (!rid) return;

      const typing = Boolean(isTyping);

      clearTypingTimer(rid, userId);

      emitTypingToRoom({
        rid,
        userId,
        isTyping: typing,
        excludeSocketId: socket.id, // ✅ sender excluded
      });

      if (typing) {
        const key = typingKey(rid, userId);
        if (!key) return;

        const timeoutId = setTimeout(() => {
          typingTimers.delete(key);
          emitTypingToRoom({
            rid,
            userId,
            isTyping: false,
            reason: "timeout",
            excludeSocketId: socket.id, // ✅ sender excluded
          });
        }, 3000);

        typingTimers.set(key, timeoutId);
      }
    });

    // backward compatibility: legacy "typing"
    socket.on("typing", ({ roomId, isTyping }) => {
      // ✅ DON'T socket.emit (that goes to client)
      // ✅ reuse the same behavior
      const rid = toInt(roomId);
      if (!rid) return;

      const typing = Boolean(isTyping);

      clearTypingTimer(rid, userId);

      emitTypingToRoom({
        rid,
        userId,
        isTyping: typing,
        excludeSocketId: socket.id,
      });

      if (typing) {
        const key = typingKey(rid, userId);
        if (!key) return;

        const timeoutId = setTimeout(() => {
          typingTimers.delete(key);
          emitTypingToRoom({
            rid,
            userId,
            isTyping: false,
            reason: "timeout",
            excludeSocketId: socket.id,
          });
        }, 3000);

        typingTimers.set(key, timeoutId);
      }
    });

    socket.on("disconnect", (reason) => {
      log("disconnect", { socketId: socket.id, userId, reason });

      const joined = socketRooms.get(String(socket.id));
      if (joined) {
        for (const rid of joined) {
          clearTypingTimer(rid, userId);
          emitTypingToRoom({
            rid,
            userId,
            isTyping: false,
            reason: "disconnect",
            excludeSocketId: socket.id, // ✅ sender excluded
          });
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