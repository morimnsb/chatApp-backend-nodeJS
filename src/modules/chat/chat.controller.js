// chat-backend-node/src/modules/chat/chat.controller.js
import * as service from "./chat.service.js";

/**
 * normalize any known service output into an array
 */
function normalizeList(out) {
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

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * optional: normalize kind naming (dm/direct/private, group/grp)
 * keeps frontend simple: only "dm" or "group"
 */
function normalizeKind(v) {
  const s = String(v ?? "").toLowerCase();
  if (s === "dm" || s === "direct" || s === "private") return "dm";
  if (s === "group" || s === "grp" || s === "public") return "group";
  return s || null;
}

function standardizeRoom(room, currentUserId) {
  if (!room || typeof room !== "object") return null;

  // supports different shapes
  const membersRaw = Array.isArray(room.members)
    ? room.members
    : Array.isArray(room.users)
      ? room.users
      : Array.isArray(room.participants)
        ? room.participants
        : [];

  const kind = normalizeKind(room.kind ?? room.type ?? (room.is_private ? "dm" : "group"));

  let title =
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

  const users = membersRaw
    .map((m) => ({
      id: toNum(m?.id),
      name: m?.name ?? m?.full_name ?? m?.email ?? null,
      email: m?.email ?? null,
    }))
    .filter((u) => u.id != null);

  const id = toNum(room.id);
  if (id == null) return null;

  const lastMessage = last
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
    id,
    kind: kind || "group",
    title,
    name: title,
    is_private: kind === "dm",

    // ✅ give both keys to keep frontend compatible
    users,
    members: users.map((u) => ({ id: u.id, name: u.name })),

    last_message: lastMessage,
    last_message_text: lastMessage?.text ?? "",
    last_message_at: lastMessage?.created_at ?? null,

    updated_at: room.updated_at ?? room.updatedAt ?? null,
    unread_count: room.unread_count ?? 0,
  };
}

/**
 * GET /conversations?kind=dm|group
 * Always returns: Array<standardRoom>
 */
export async function listConvos(req, res, next) {
  try {
    const currentUserId = req.user.id;

    const out = await service.listConvos(currentUserId);
    let list = normalizeList(out);

    list = list
      .map((r) => standardizeRoom(r, currentUserId))
      .filter(Boolean);

    const qKind = normalizeKind(req.query?.kind);
    if (qKind === "dm" || qKind === "group") {
      list = list.filter((r) => r.kind === qKind);
    }

    return res.json(list);
  } catch (e) {
    return next(e);
  }
}

export async function createConvo(req, res, next) {
  try {
    const out = await service.createConvo(req.user.id, req.body);

    // ✅ service returns { ok:true, room }
    const roomStd = standardizeRoom(out?.room, req.user.id);

    if (roomStd) return res.json({ ok: true, room: roomStd });
    return res.json(out);
  } catch (e) {
    return next(e);
  }
}

export async function listMessages(req, res, next) {
  try {
    const roomId = Number(req.params.roomId);
    const out = await service.listMessages(req.user.id, roomId);
    return res.json(out);
  } catch (e) {
    return next(e);
  }
}

export async function sendMessage(req, res, next) {
  try {
    const roomId = Number(req.params.roomId);
    const out = await service.sendMessage(req.user.id, roomId, req.body);
    return res.json(out);
  } catch (e) {
    return next(e);
  }
}

/**
 * DEPRECATED alias
 * GET /rooms -> same as /conversations
 */
export async function listRooms(req, res, next) {
  return listConvos(req, res, next);
}

// ✅ /api/chatMeetUp/friendship (match Laravel behavior)
export async function sendFriendship(req, res, next) {
  try {
    console.log("[chat.sendFriendship] hit", {
      fromUserId: req.user?.id,
      to_user_id: req.body?.to_user_id,
    });

    const out = await service.sendFriendship(req.user.id, req.body);
    return res.status(out.status ?? 200).json(out.body);
  } catch (e) {
    return next(e);
  }
}
