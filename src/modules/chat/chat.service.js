// chat-backend-node/src/modules/chat/chat.service.js
import prisma from "../../prisma.js";
import { randomUUID } from "crypto";

// ✅ room broadcast + notify absent members
import {
  broadcastRoomAndNotifyAbsent,
  broadcastToRoom,
  broadcastToUser,
} from "../../realtime/socket.js";

const toInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/* ------------------------- rooms (db fetch) ------------------------- */
export async function listRooms(userId) {
  const uid = toInt(userId);
  if (!uid) throw Object.assign(new Error("BAD_REQUEST"), { status: 400 });

  return prisma.chatRoom.findMany({
    where: { members: { some: { userId: uid } } },
    orderBy: { updatedAt: "desc" },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });
}

/* ------------------------- conversations (standard) ------------------------- */
export async function listConvos(userId) {
  const uid = toInt(userId);
  if (!uid) throw Object.assign(new Error("BAD_REQUEST"), { status: 400 });

  const rooms = await listRooms(uid);

  return rooms.map((r) => {
    const lastMsg = r.messages?.[0] || null;

    const users = (r.members || [])
      .map((m) => m.user)
      .filter(Boolean)
      .map((u) => ({ id: u.id, name: u.name, email: u.email }));

    const kind = r.isGroup ? "group" : "dm";
    const is_private = kind === "dm";

    const partner =
      kind === "dm" ? users.find((u) => Number(u.id) !== uid) || null : null;

    const title =
      kind === "group" ? r.name ?? null : partner?.name ?? partner?.email ?? null;

    return {
      id: r.id,
      kind,
      is_private,
      title,
      name: title,
      users,

      last_message: lastMsg
        ? {
            id: lastMsg.id,
            content: lastMsg.content ?? null,
            text: lastMsg.content ?? null,
            kind: lastMsg.kind ?? "text",
            user_id: lastMsg.userId,
            created_at: lastMsg.createdAt?.toISOString?.() ?? lastMsg.createdAt,
            user: lastMsg.user
              ? {
                  id: lastMsg.user.id,
                  name: lastMsg.user.name,
                  email: lastMsg.user.email,
                }
              : undefined,
          }
        : null,

      last_message_text: lastMsg?.content ?? "",
      last_message_at:
        lastMsg?.createdAt?.toISOString?.() ?? lastMsg?.createdAt ?? null,
      updated_at: r.updatedAt?.toISOString?.() ?? r.updatedAt,

      isGroup: Boolean(r.isGroup),
      is_group: Boolean(r.isGroup),

      partnerId: partner?.id ?? null,
      partner_id: partner?.id ?? null,

      unread_count: 0,
    };
  });
}

/* ------------------------- create convo ------------------------- */
export async function createConvo(userId, body) {
  const uid = toInt(userId);
  if (!uid) throw Object.assign(new Error("BAD_REQUEST"), { status: 400 });

  const isGroup = Boolean(body?.is_group ?? body?.isGroup);
  const name = body?.name ?? null;

  const memberIds = Array.isArray(body?.member_ids)
    ? body.member_ids.map(toInt).filter(Boolean)
    : [];

  const privateKey = !isGroup ? randomUUID() : null;

  const room = await prisma.chatRoom.create({
    data: {
      name,
      isGroup,
      privateKey,
      members: {
        create: [{ userId: uid }, ...memberIds.map((id) => ({ userId: id }))],
      },
    },
  });

  return { ok: true, room };
}

/* ------------------------- list messages ------------------------- */
export async function listMessages(userId, roomId) {
  const uid = toInt(userId);
  const rid = toInt(roomId);
  if (!uid || !rid) throw Object.assign(new Error("BAD_REQUEST"), { status: 400 });

  const isMember = await prisma.chatRoomMember.findFirst({
    where: { roomId: rid, userId: uid },
  });
  if (!isMember) throw Object.assign(new Error("FORBIDDEN"), { status: 403 });

  const messages = await prisma.message.findMany({
    where: { roomId: rid },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  return messages;
}

/* ------------------------- send message (ROOM + GLOBAL NOTIFY) ------------------------- */
export async function sendMessage(userId, roomId, body) {
  const uid = toInt(userId);
  const rid = toInt(roomId);
  if (!uid || !rid) throw Object.assign(new Error("BAD_REQUEST"), { status: 400 });

  const isMember = await prisma.chatRoomMember.findFirst({
    where: { roomId: rid, userId: uid },
  });
  if (!isMember) throw Object.assign(new Error("FORBIDDEN"), { status: 403 });

  const text =
    typeof body?.text === "string" ? body.text.trim().slice(0, 2000) : "";
  if (!text) throw Object.assign(new Error("INVALID_TEXT"), { status: 400 });

  const created = await prisma.message.create({
    data: {
      roomId: rid,
      userId: uid,
      content: text,
      kind: body?.kind ?? "text",
    },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  await prisma.chatRoom.update({
    where: { id: rid },
    data: { updatedAt: new Date() },
  });

  // ✅ members (for notify absent)
  const members = await prisma.chatRoomMember.findMany({
    where: { roomId: rid },
    select: { userId: true },
  });
  const memberIds = members.map((m) => m.userId);

  // ✅ wsRouter-friendly payload
  const payload = {
    type: "message",
    room_id: rid,
    roomId: rid,
    message: {
      id: created.id,
      room_id: rid,
      chat_room_id: rid,
      user_id: created.userId,
      sender_id: created.userId,
      content: created.content,
      text: created.content,
      kind: created.kind ?? null,
      created_at: created.createdAt.toISOString(),
      updated_at: created.updatedAt.toISOString(),
      user: created.user
        ? { id: created.user.id, name: created.user.name, email: created.user.email }
        : undefined,
    },
  };

  // ✅ 1) room: chat:message
  // ✅ 2) absent users: chat:notify
  broadcastRoomAndNotifyAbsent(rid, payload, memberIds, uid);

  // ✅ IMPORTANT FIX:
  // Sender might NOT be joined to room yet, so also push a direct notify to sender
  // BUT in Node we must use "chat:notify" (not "direct.message")
  broadcastToUser(
    uid,
    { type: "notify", room_id: rid, roomId: rid, message: payload.message },
    "chat:notify"
  );

  // ✅ stop typing immediately
  broadcastToRoom(
    rid,
    {
      type: "typing_indicator",
      room_id: rid,
      roomId: rid,
      user_id: uid,
      userId: uid,
      isTyping: false,
      at: Date.now(),
      reason: "sent_message",
    },
    "typing_indicator"
  );

  return { ok: true, ...payload };
}

/* ------------------------- ensure DM room ------------------------- */
export async function ensureDmRoom(userA, userB) {
  const a = toInt(userA);
  const b = toInt(userB);
  if (!a || !b) throw Object.assign(new Error("BAD_REQUEST"), { status: 400 });

  const existing = await prisma.chatRoom.findFirst({
    where: {
      isGroup: false,
      AND: [{ members: { some: { userId: a } } }, { members: { some: { userId: b } } }],
    },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });
  if (existing) return existing;

  const room = await prisma.chatRoom.create({
    data: {
      name: null,
      isGroup: false,
      privateKey: randomUUID(),
      members: { create: [{ userId: a }, { userId: b }] },
    },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });

  return room;
}

/* ------------------------- friendship ------------------------- */
export async function sendFriendship(fromUserId, { to_user_id, content }) {
  const fromId = toInt(fromUserId);
  const toId = toInt(to_user_id);
  if (!fromId || !toId) return { status: 400, body: { message: "BAD_REQUEST" } };

  const toUser = await prisma.user.findUnique({ where: { id: toId } });
  if (!toUser) return { status: 404, body: { message: "User not found" } };

  if (fromId === toId) {
    return { status: 422, body: { message: "نمی‌توانید خودتان را اضافه کنید." } };
  }

  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { fromUserId: fromId, toUserId: toId },
        { fromUserId: toId, toUserId: fromId },
      ],
    },
  });

  const room = await ensureDmRoom(fromId, toId);

  const text = (content || "").trim() || "سلام! من برایت درخواست دوستی فرستادم 🙌";

  const dmMessage = await prisma.message.create({
    data: {
      roomId: room.id,
      userId: fromId,
      content: text,
      kind: "friend_request",
    },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  await prisma.chatRoom.update({
    where: { id: room.id },
    data: { updatedAt: new Date() },
  });

  // ✅ payload like sendMessage (wsRouter-friendly)
  const payload = {
    type: "message",
    room_id: room.id,
    roomId: room.id,
    message: {
      id: dmMessage.id,
      room_id: room.id,
      chat_room_id: room.id,
      user_id: dmMessage.userId,
      sender_id: dmMessage.userId,
      content: dmMessage.content,
      text: dmMessage.content,
      kind: dmMessage.kind ?? "friend_request",
      created_at: dmMessage.createdAt.toISOString(),
      updated_at: dmMessage.updatedAt.toISOString(),
      user: dmMessage.user
        ? { id: dmMessage.user.id, name: dmMessage.user.name, email: dmMessage.user.email }
        : undefined,
    },
  };

  // ✅ (1) room broadcast (for anyone joined) -> ChatMessagesList updates
  broadcastToRoom(room.id, payload, "chat:message");

  // ✅ (2) receiver notify (ConversationList updates even if not in room)
  broadcastToUser(
    toId,
    { type: "notify", room_id: room.id, roomId: room.id, message: payload.message },
    "chat:notify"
  );

  // ✅ (3) sender notify too (covers sender not joined yet)
  broadcastToUser(
    fromId,
    { type: "notify", room_id: room.id, roomId: room.id, message: payload.message },
    "chat:notify"
  );

  let friendship = existing;
  let status = 200;

  if (!existing) {
    const [minId, maxId] = fromId < toId ? [fromId, toId] : [toId, fromId];

    friendship = await prisma.friendship.create({
      data: { fromUserId: minId, toUserId: maxId, status: "pending" },
    });
    status = 201;
  }

  const roomFull = await prisma.chatRoom.findUnique({
    where: { id: room.id },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });

  return {
    status,
    body: {
      message: existing ? "درخواست دوستی قبلاً ثبت شده است." : "Friend request sent.",
      friendship,
      room: roomFull,
      dm_message: {
        id: dmMessage.id,
        chat_room_id: dmMessage.roomId,
        user_id: dmMessage.userId,
        content: dmMessage.content,
        kind: dmMessage.kind,
        created_at: dmMessage.createdAt,
        user: dmMessage.user,
      },
    },
  };
}
