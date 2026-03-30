// C:\Users\31687\Desktop\chat-backend-node\src\modules\chat\chat.service.ts
import prisma from "../../prisma.js";
import { randomUUID } from "crypto";
import {
  broadcastRoomAndNotifyAbsent,
  broadcastToRoom,
  broadcastToUser,
} from "../../realtime/socket.js";

/* ------------------------- helpers ------------------------- */

const toInt = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const asIso = (d: unknown): string | null => {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString();
  const t = new Date(String(d));
  return Number.isFinite(t.getTime()) ? t.toISOString() : String(d);
};

type PublicUser = { id: number; name: string; email: string };

type PublicMember = { id: number; name: string };

type WsMessage = {
  id: number;
  room_id: number;
  chat_room_id: number;
  user_id: number;
  sender_id: number;
  content: string | null;
  text: string | null;
  kind: string | null;
  created_at: string;
  updated_at: string;
  createdAt: string;
  updatedAt: string;
  user?: PublicUser;
};

type ConversationShape = {
  id: number;
  kind: "dm" | "group";
  is_private: boolean;
  title: string | null;
  name: string | null;
  users: PublicUser[];
  members: PublicMember[];
  last_message: WsMessage | null;
  last_message_text: string;
  last_message_at: string | null;
  updated_at: string | null;
  isGroup: boolean;
  is_group: boolean;
  partnerId: number | null;
  partner_id: number | null;
  unread_count: number;
};

type WsPacket =
  | {
      ok?: true;
      type: "message" | "notify";
      room_id: number;
      roomId: number;
      message: WsMessage;
    }
  | {
      type: "typing_indicator";
      room_id: number;
      roomId: number;
      user_id: number;
      userId: number;
      isTyping: boolean;
      at: number;
      reason?: string;
    };

type CreateConvoBody = {
  is_group?: boolean;
  isGroup?: boolean;
  name?: string | null;
  member_ids?: unknown[];
  members?: unknown[];
};

function shapeUser(
  user: { id: number; name: string; email: string } | null | undefined
): PublicUser | undefined {
  if (!user) return undefined;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
}

function shapeMessage(m: {
  id: number;
  room_id: number;
  user_id: number;
  content: string | null;
  kind: string | null;
  created_at: Date;
  updated_at: Date;
  user?: { id: number; name: string; email: string } | null;
}): WsMessage {
  const created = m.created_at.toISOString();
  const updated = m.updated_at.toISOString();

  return {
    id: m.id,
    room_id: m.room_id,
    chat_room_id: m.room_id,
    user_id: m.user_id,
    sender_id: m.user_id,
    content: m.content ?? null,
    text: m.content ?? null,
    kind: m.kind ?? "text",
    created_at: created,
    updated_at: updated,
    createdAt: created,
    updatedAt: updated,
    user: shapeUser(m.user),
  };
}

function shapeConversation(
  room: {
    id: number;
    name: string | null;
    is_group: boolean;
    updated_at: Date;
    members?: Array<{
      user?: { id: number; name: string; email: string } | null;
    }>;
    messages?: Array<{
      id: number;
      room_id: number;
      user_id: number;
      content: string | null;
      kind: string | null;
      created_at: Date;
      updated_at: Date;
      user?: { id: number; name: string; email: string } | null;
    }>;
  },
  currentUserId: number
): ConversationShape {
  const users: PublicUser[] = (room.members ?? [])
    .map((m) => m.user)
    .filter((u): u is { id: number; name: string; email: string } => Boolean(u))
    .map((u) => ({ id: u.id, name: u.name, email: u.email }));

  const members: PublicMember[] = users.map((u) => ({
    id: u.id,
    name: u.name,
  }));

  const kind: "dm" | "group" = room.is_group ? "group" : "dm";
  const is_private = kind === "dm";

  const partner =
    kind === "dm"
      ? users.find((u) => Number(u.id) !== Number(currentUserId)) ?? null
      : null;

  const title =
    kind === "group"
      ? (room.name ?? null)
      : (partner?.name ?? partner?.email ?? null);

  const lastRaw = room.messages?.[0] ?? null;
  const last_message = lastRaw ? shapeMessage(lastRaw) : null;

  return {
    id: room.id,
    kind,
    is_private,
    title,
    name: title,
    users,
    members,
    last_message,
    last_message_text: last_message?.text ?? "",
    last_message_at: last_message?.created_at ?? null,
    updated_at: asIso(room.updated_at),
    isGroup: Boolean(room.is_group),
    is_group: Boolean(room.is_group),
    partnerId: partner?.id ?? null,
    partner_id: partner?.id ?? null,
    unread_count: 0,
  };
}

/* ------------------------- rooms (db fetch) ------------------------- */

export async function listRooms(userId: unknown) {
  const uid = toInt(userId);
  if (!uid) throw Object.assign(new Error("BAD_REQUEST"), { status: 400 });

  return prisma.chatRoom.findMany({
    where: { members: { some: { user_id: uid } } },
    orderBy: { updated_at: "desc" },
    include: {
      members: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
      messages: {
        orderBy: { created_at: "desc" },
        take: 1,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
}

/* ------------------------- conversations (standard) ------------------------- */

export async function listConvos(userId: unknown) {
  const uid = toInt(userId);
  if (!uid) throw Object.assign(new Error("BAD_REQUEST"), { status: 400 });

  const rooms = await listRooms(uid);
  return rooms.map((room) => shapeConversation(room, uid));
}

/* ------------------------- create convo ------------------------- */

export async function createConvo(userId: unknown, body: CreateConvoBody) {
  const uid = toInt(userId);
  if (!uid) throw Object.assign(new Error("BAD_REQUEST"), { status: 400 });

  const isGroup = Boolean(body?.is_group ?? body?.isGroup);
  const name = body?.name ?? null;

  const rawMemberIds = Array.isArray(body?.member_ids)
    ? body.member_ids
    : Array.isArray(body?.members)
      ? body.members
      : [];

  const memberIds = rawMemberIds
    .map(toInt)
    .filter((x): x is number => Boolean(x));

  const uniq = Array.from(new Set(memberIds)).filter((id) => id !== uid);
  const privateKey = !isGroup ? randomUUID() : null;

  const room = await prisma.chatRoom.create({
    data: {
      name,
      is_group: isGroup,
      private_key: privateKey,
      members: {
        create: [{ user_id: uid }, ...uniq.map((id) => ({ user_id: id }))],
      },
    },
    include: {
      members: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
      messages: {
        orderBy: { created_at: "desc" },
        take: 1,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  return {
    ok: true,
    room: shapeConversation(room, uid),
  };
}

/* ------------------------- list messages ------------------------- */

export async function listMessages(userId: unknown, roomId: unknown) {
  const uid = toInt(userId);
  const rid = toInt(roomId);
  if (!uid || !rid) throw Object.assign(new Error("BAD_REQUEST"), { status: 400 });

  const isMember = await prisma.chatRoomMember.findFirst({
    where: { room_id: rid, user_id: uid },
  });

  if (!isMember) {
    throw Object.assign(new Error("FORBIDDEN"), { status: 403 });
  }

  const messages = await prisma.message.findMany({
    where: { room_id: rid },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { created_at: "asc" },
    take: 200,
  });

  return messages.map(shapeMessage);
}

/* ------------------------- send message ------------------------- */

export async function sendMessage(userId: unknown, roomId: unknown, body: any) {
  const uid = toInt(userId);
  const rid = toInt(roomId);
  if (!uid || !rid) throw Object.assign(new Error("BAD_REQUEST"), { status: 400 });

  const isMember = await prisma.chatRoomMember.findFirst({
    where: { room_id: rid, user_id: uid },
  });

  if (!isMember) {
    throw Object.assign(new Error("FORBIDDEN"), { status: 403 });
  }

  const text = String(body?.text ?? body?.content ?? "")
    .trim()
    .slice(0, 2000);

  if (!text) {
    throw Object.assign(new Error("INVALID_TEXT"), { status: 400 });
  }

  const created = await prisma.message.create({
    data: {
      room_id: rid,
      user_id: uid,
      content: text,
      kind: body?.kind ?? "text",
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });

  await prisma.chatRoom.update({
    where: { id: rid },
    data: { updated_at: new Date() },
  });

  const members = await prisma.chatRoomMember.findMany({
    where: { room_id: rid },
    select: { user_id: true },
  });

  const memberIds = members.map((m) => m.user_id);
  const msg = shapeMessage(created);

  const roomPayload: WsPacket = {
    ok: true,
    type: "message",
    room_id: rid,
    roomId: rid,
    message: msg,
  };

  const selfNotifyPayload: WsPacket = {
    ok: true,
    type: "notify",
    room_id: rid,
    roomId: rid,
    message: msg,
  };

  broadcastRoomAndNotifyAbsent(rid, roomPayload, memberIds, uid);

  broadcastToUser(uid, selfNotifyPayload, "chat:notify");

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

  return roomPayload;
}

/* ------------------------- ensure DM room ------------------------- */

export async function ensureDmRoom(userA: unknown, userB: unknown) {
  const a = toInt(userA);
  const b = toInt(userB);
  if (!a || !b) throw Object.assign(new Error("BAD_REQUEST"), { status: 400 });

  const existing = await prisma.chatRoom.findFirst({
    where: {
      is_group: false,
      AND: [
        { members: { some: { user_id: a } } },
        { members: { some: { user_id: b } } },
      ],
    },
    include: {
      members: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
      messages: {
        orderBy: { created_at: "desc" },
        take: 1,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  if (existing) return existing;

  return prisma.chatRoom.create({
    data: {
      name: null,
      is_group: false,
      private_key: randomUUID(),
      members: { create: [{ user_id: a }, { user_id: b }] },
    },
    include: {
      members: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
      messages: {
        orderBy: { created_at: "desc" },
        take: 1,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
}

/* ------------------------- friendship ------------------------- */

export async function sendFriendship(
  fromUserId: unknown,
  input: { to_user_id?: unknown; content?: unknown }
) {
  const fromId = toInt(fromUserId);
  const toId = toInt(input?.to_user_id);
  if (!fromId || !toId) return { status: 400, body: { message: "BAD_REQUEST" } };

  const toUser = await prisma.user.findUnique({ where: { id: toId } });
  if (!toUser) return { status: 404, body: { message: "User not found" } };

  if (fromId === toId) {
    return { status: 422, body: { message: "نمی‌توانید خودتان را اضافه کنید." } };
  }

  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { from_user_id: fromId, to_user_id: toId },
        { from_user_id: toId, to_user_id: fromId },
      ],
    },
  });

  const room = await ensureDmRoom(fromId, toId);

  const text =
    (typeof input?.content === "string" ? input.content : "").trim() ||
    "سلام! من برایت درخواست دوستی فرستادم 🙌";

  const dmMessage = await prisma.message.create({
    data: {
      room_id: room.id,
      user_id: fromId,
      content: text,
      kind: "friend_request",
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });

  await prisma.chatRoom.update({
    where: { id: room.id },
    data: { updated_at: new Date() },
  });

  const msg = shapeMessage(dmMessage);

  const roomPayload: WsPacket = {
    ok: true,
    type: "message",
    room_id: room.id,
    roomId: room.id,
    message: msg,
  };

  const notifyPayload: WsPacket = {
    ok: true,
    type: "notify",
    room_id: room.id,
    roomId: room.id,
    message: msg,
  };

  broadcastToRoom(room.id, roomPayload, "chat:message");
  broadcastToUser(toId, notifyPayload, "chat:notify");
  broadcastToUser(fromId, notifyPayload, "chat:notify");

  let friendship = existing;
  let status = 200;

  if (!existing) {
    const [minId, maxId] = fromId < toId ? [fromId, toId] : [toId, fromId];
    friendship = await prisma.friendship.create({
      data: {
        from_user_id: minId,
        to_user_id: maxId,
        status: "pending",
      },
    });
    status = 201;
  }

  const roomFull = await prisma.chatRoom.findUnique({
    where: { id: room.id },
    include: {
      members: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
      messages: {
        orderBy: { created_at: "desc" },
        take: 1,
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  return {
    status,
    body: {
      message: existing ? "درخواست دوستی قبلاً ثبت شده است." : "Friend request sent.",
      friendship,
      room: roomFull ? shapeConversation(roomFull, fromId) : null,
      dm_message: msg,
    },
  };
}