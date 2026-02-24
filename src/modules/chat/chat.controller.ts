// chat-backend-node/src/modules/chat/chat.controller.ts
import type { Request, Response, NextFunction } from "express";
import * as service from "./chat.service.js";

/* ----------------------------- helpers ----------------------------- */

type AnyObj = Record<string, any>;

function normalizeList(out: any): any[] {
  if (Array.isArray(out)) return out;

  const list =
    out?.results ??
    out?.data ??
    out?.items ??
    out?.conversations ??
    out?.rooms ??
    out?.rows ??
    [];

  return Array.isArray(list) ? list : [];
}

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * normalize kind to only "dm" | "group"
 */
type RoomKind = "dm" | "group";
function normalizeKind(v: unknown): RoomKind | null {
  const s = String(v ?? "").toLowerCase();
  if (s === "dm" || s === "direct" || s === "private") return "dm";
  if (s === "group" || s === "grp" || s === "public") return "group";
  return null;
}

type StdUser = { id: number; name: string | null; email: string | null };

type StdMessage = {
  id: number | null;
  text: string | null;
  content: string | null;
  kind: string;
  user_id: number | null;
  created_at: string | null;
};

export type StandardRoom = {
  id: number;
  kind: RoomKind;
  title: string | null;
  name: string | null;
  is_private: boolean;

  users: StdUser[];
  members: Array<{ id: number; name: string | null }>;

  last_message: StdMessage | null;
  last_message_text: string;
  last_message_at: string | null;

  updated_at: string | null;
  unread_count: number;
};

function standardizeRoom(room: any, currentUserId: number): StandardRoom | null {
  if (!room || typeof room !== "object") return null;

  const membersRaw: any[] = Array.isArray(room.members)
    ? room.members
    : Array.isArray(room.users)
      ? room.users
      : Array.isArray(room.participants)
        ? room.participants
        : [];

  const kind: RoomKind =
    normalizeKind(room.kind ?? room.type ?? (room.is_private ? "dm" : "group")) || "group";

  let title: string | null =
    room.title ??
    room.name ??
    room.display_name ??
    null;

  if (!title && kind === "dm" && membersRaw.length) {
    const other = membersRaw.find((m) => Number(m?.id) !== Number(currentUserId));
    title = other?.name ?? other?.full_name ?? other?.email ?? null;
  }

  const last =
    room.last_message ??
    room.lastMessage ??
    room.last_msg ??
    null;

  const users: StdUser[] = membersRaw
    .map((m) => ({
      id: toNum(m?.id),
      name: m?.name ?? m?.full_name ?? m?.email ?? null,
      email: m?.email ?? null,
    }))
    .filter((u): u is { id: number; name: string | null; email: string | null } => u.id != null)
    .map((u) => ({ ...u, id: Number(u.id) }));

  const id = toNum(room.id);
  if (id == null) return null;

  const lastMessage: StdMessage | null = last
    ? {
        id: toNum(last?.id),
        text: last?.text ?? last?.content ?? null,
        content: last?.content ?? last?.text ?? null,
        kind: last?.kind ?? "text",
        user_id: toNum(last?.user_id ?? last?.sender_id ?? last?.userId),
        created_at: last?.created_at ?? last?.createdAt ?? null,
      }
    : null;

  return {
    id: Number(id),
    kind,
    title,
    name: title,
    is_private: kind === "dm",

    users,
    members: users.map((u) => ({ id: u.id, name: u.name })),

    last_message: lastMessage,
    last_message_text: lastMessage?.text ?? "",
    last_message_at: lastMessage?.created_at ?? null,

    updated_at: room.updated_at ?? room.updatedAt ?? null,
    unread_count: Number(room.unread_count ?? 0) || 0,
  };
}

function requireUserId(req: Request, res: Response): number | null {
  const raw = req.user?.id;
  const userId = Number(raw);
  if (!Number.isFinite(userId) || userId <= 0) {
    res.status(401).json({ message: "UNAUTHORIZED" });
    return null;
  }
  return userId;
}

function requireRoomId(req: Request, res: Response): number | null {
  const raw = (req.params as AnyObj)?.roomId;
  const rid = Number(raw);
  if (!Number.isFinite(rid) || rid <= 0) {
    res.status(400).json({ message: "BAD_ROOM_ID" });
    return null;
  }
  return rid;
}

/* ----------------------------- handlers ----------------------------- */

export async function listConvos(req: Request, res: Response, next: NextFunction) {
  try {
    const currentUserId = requireUserId(req, res);
    if (!currentUserId) return;

    const out = await service.listConvos(currentUserId);
    let list = normalizeList(out);

    list = list
      .map((r) => standardizeRoom(r, currentUserId))
      .filter((x): x is StandardRoom => Boolean(x));

    const qKindRaw = (req.query as AnyObj)?.kind;
    const qKind = normalizeKind(qKindRaw);
    if (qKind === "dm" || qKind === "group") {
      list = list.filter((r) => r.kind === qKind);
    }

    return res.json(list);
  } catch (e) {
    return next(e);
  }
}

export async function createConvo(req: Request, res: Response, next: NextFunction) {
  try {
    const currentUserId = requireUserId(req, res);
    if (!currentUserId) return;

    const out = await service.createConvo(currentUserId, req.body as AnyObj);

    const roomStd = standardizeRoom((out as any)?.room, currentUserId);
    if (roomStd) return res.json({ ok: true, room: roomStd });

    return res.json(out);
  } catch (e) {
    return next(e);
  }
}

export async function listMessages(req: Request, res: Response, next: NextFunction) {
  try {
    const currentUserId = requireUserId(req, res);
    if (!currentUserId) return;

    const roomId = requireRoomId(req, res);
    if (!roomId) return;

    const out = await service.listMessages(currentUserId, roomId);
    return res.json(out);
  } catch (e) {
    return next(e);
  }
}

export async function sendMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const currentUserId = requireUserId(req, res);
    if (!currentUserId) return;

    const roomId = requireRoomId(req, res);
    if (!roomId) return;

    const out = await service.sendMessage(currentUserId, roomId, req.body as AnyObj);
    return res.json(out);
  } catch (e) {
    return next(e);
  }
}

/**
 * DEPRECATED alias
 * GET /rooms -> same as /conversations
 */
export async function listRooms(req: Request, res: Response, next: NextFunction) {
  return listConvos(req, res, next);
}

export async function sendFriendship(req: Request, res: Response, next: NextFunction) {
  try {
    const currentUserId = requireUserId(req, res);
    if (!currentUserId) return;

    console.log("[chat.sendFriendship] hit", {
      fromUserId: currentUserId,
      to_user_id: (req.body as AnyObj)?.to_user_id,
    });

    const out = await service.sendFriendship(currentUserId, req.body as AnyObj);
    const status = Number((out as any)?.status ?? 200);

    return res.status(status).json((out as any)?.body ?? out);
  } catch (e) {
    return next(e);
  }
}