// C:\Users\31687\Desktop\chat-backend-node\src\modules\auth\auth.service.ts
import prisma from "../../prisma.js";
import bcrypt from "bcryptjs";
import { type JwtPayload } from "jsonwebtoken";
import crypto from "crypto";
import jwt, { type SignOptions } from "jsonwebtoken";

/* ----------------------------- types ----------------------------- */

type AnyObj = Record<string, unknown>;

export type RegisterBody = {
  email?: string;
  password?: string;
  password2?: string;
  password_confirmation?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
} & AnyObj;

export type LoginBody = {
  email?: string;
  password?: string;
} & AnyObj;

export type VerifyEmailBody = {
  email?: string;
  otp?: string | number;
  code?: string | number;
  verify_code?: string | number;
} & AnyObj;

export type ResendVerifyBody = {
  email?: string;
} & AnyObj;

export type PublicUser = { id: number; name: string; email: string };

export type RegisterResult = {
  ok: true;
  message: string;
  user: { id: number; name: string; email: string; email_verified_at: Date | null };
  otp?: string;
};

export type LoginResult = {
  ok: true;
  access_token: string;
  refresh_token: string;
  refresh_max_age_ms: number;
  user: PublicUser;
  access: string;
  refresh: string;
};

export type RefreshResult = {
  ok: true;
  access_token: string;
  access: string;
  user: PublicUser;
};

export type VerifyEmailResult = {
  ok: true;
  access_token: string;
  refresh_token: string;
  refresh_max_age_ms: number;
  token_type: "Bearer";
  user: PublicUser;
  message: string;
  access: string;
  refresh: string;
};

type ValidationErrors = Record<string, string[]>;

type UserAuthRow = {
  id: number;
  name: string;
  email: string;
  password: string;
  email_verified_at: Date | null;
  email_verify_code: string | null;
  email_verify_exp: Date | null;
};

type FriendshipLite = {
  id: number;
  from_user_id: number;
  to_user_id: number;
  status: string;
};

type IssuedTokens = {
  access_token: string;
  refresh_token: string;
  refresh_max_age_ms: number;
  access: string;
  refresh: string;
};

/* ----------------------------- helpers ----------------------------- */

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw Object.assign(new Error("SERVER_MISCONFIG"), {
      status: 500,
      meta: { code: "SERVER_MISCONFIG", missing: name },
    });
  }
  return v;
}

function asBool(v: unknown, fallback = false): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return fallback;
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function shouldShowDevOtp(): boolean {
  return asBool(process.env.AUTH_SHOW_DEV_OTP, false);
}

function make6DigitCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function signAccessToken(user: { id: number; email: string; name: string }): string {
  const secret =
    process.env.JWT_ACCESS_SECRET ||
    process.env.JWT_SECRET ||
    mustEnv("JWT_ACCESS_SECRET");

  const issuer = process.env.JWT_ISSUER || "chatapp";
  const audience = process.env.JWT_AUDIENCE || "chatapp";
  const expiresIn = (process.env.ACCESS_EXPIRES_IN || "15m") as SignOptions["expiresIn"];

  return jwt.sign(
    {
      sub: String(user.id),
      uid: user.id,
      email: user.email,
      name: user.name,
    },
    secret,
    {
      algorithm: "HS256",
      expiresIn,
      issuer,
      audience,
    }
  );
}

function signRefreshToken(user: { id: number }): string {
  const secret = process.env.JWT_REFRESH_SECRET || mustEnv("JWT_REFRESH_SECRET");
  const issuer = process.env.JWT_ISSUER || "chatapp";
  const audience = process.env.JWT_AUDIENCE || "chatapp";
  const expiresIn = (process.env.REFRESH_EXPIRES_IN || "30d") as SignOptions["expiresIn"];

  return jwt.sign(
    {
      sub: String(user.id),
      typ: "refresh",
    },
    secret,
    {
      algorithm: "HS256",
      expiresIn,
      issuer,
      audience,
    }
  );
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function msFromExpiresIn(expiresIn: string): number {
  const m = String(expiresIn).match(/^(\d+)([smhd])$/);
  if (!m) return 30 * 24 * 60 * 60 * 1000;

  const n = Number(m[1]);
  const unit = m[2];

  const mult =
    unit === "s" ? 1000 :
    unit === "m" ? 60e3 :
    unit === "h" ? 3600e3 :
    86400e3;

  return n * mult;
}

function maskEmail(email: unknown): string {
  const e = String(email || "");
  const [u, d] = e.split("@");
  if (!u || !d) return e;
  const head = u.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, u.length - 2))}@${d}`;
}

function throw422(errors: ValidationErrors): never {
  throw Object.assign(new Error("Validation failed."), {
    status: 422,
    errors,
  });
}

function throwEmailNotVerified(user: { id?: number; email?: string }): never {
  throw Object.assign(new Error("EMAIL_NOT_VERIFIED"), {
    status: 403,
    meta: {
      code: "EMAIL_NOT_VERIFIED",
      email: user?.email ? maskEmail(user.email) : null,
      user_id: user?.id ?? null,
      can_resend: true,
    },
  });
}

function normalizeEmail(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function normalizePassword(v: unknown): string {
  return String(v ?? "");
}

function splitName(fullName: unknown): [string, string] {
  const full = String(fullName ?? "").trim().replace(/\s+/g, " ");
  if (!full) return ["", ""];
  const parts = full.split(" ");
  const first = parts.shift() ?? "";
  const last = parts.join(" ");
  return [first, last];
}

function parseUserIdFromSub(payload: JwtPayload): number | null {
  const sub = (payload as JwtPayload & { sub?: string | number }).sub;
  const userId = Number(sub);
  return Number.isFinite(userId) && userId > 0 ? userId : null;
}

function maybeAttachOtp<T extends Record<string, unknown>>(payload: T, otp: string): T & { otp?: string } {
  if (shouldShowDevOtp()) {
    return { ...payload, otp };
  }
  return payload;
}

async function getUserAuthByEmail(email: string): Promise<UserAuthRow | null> {
  return prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      password: true,
      email_verified_at: true,
      email_verify_code: true,
      email_verify_exp: true,
    },
  });
}

async function issueLoginTokens(user: PublicUser): Promise<IssuedTokens> {
  const access_token = signAccessToken(user);
  const refresh_token = signRefreshToken({ id: user.id });

  const tokenHash = sha256(refresh_token);
  const refresh_max_age_ms = msFromExpiresIn(process.env.REFRESH_EXPIRES_IN || "30d");
  const expiresAt = new Date(Date.now() + refresh_max_age_ms);

  await prisma.refreshToken.create({
    data: {
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    },
  });

  return {
    access_token,
    refresh_token,
    refresh_max_age_ms,
    access: access_token,
    refresh: refresh_token,
  };
}

/* ----------------------------- service ----------------------------- */

export async function register(body: RegisterBody): Promise<RegisterResult> {
  const email = normalizeEmail(body?.email);

  const first_name_in = body?.first_name;
  const last_name_in = body?.last_name;
  const name_in = body?.name;

  let first_name = String(first_name_in ?? "").trim();
  let last_name = String(last_name_in ?? "").trim();

  if ((!first_name || !last_name) && name_in) {
    const [n1, n2] = splitName(name_in);
    first_name = first_name || n1;
    last_name = last_name || n2;
  }

  const password = normalizePassword(body?.password);
  let password2 = String(body?.password2 ?? body?.password_confirmation ?? "");
  if (!password2 && password) password2 = password;

  const errors: ValidationErrors = {};

  if (!first_name) errors.first_name = ["First name is required."];
  if (!last_name) errors.last_name = ["Last name is required."];
  if (!email) errors.email = ["Email is required."];
  if (password.length < 8) errors.password = ["Password must be at least 8 characters."];
  if (!password2) errors.password2 = ["Repeat password is required."];
  if (password && password2 && password !== password2) {
    errors.password2 = ["Passwords do not match."];
  }

  if (Object.keys(errors).length) throw422(errors);

  const exists = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (exists) {
    throw422({ email: ["This email is already registered."] });
  }

  const name = `${first_name} ${last_name}`.trim();
  const passwordHash = await bcrypt.hash(password, 10);

  const otp = make6DigitCode();
  const exp = new Date(Date.now() + 15 * 60 * 1000);

  const user = await prisma.user.create({
    data: {
      name,
      email,
      password: passwordHash,
      email_verify_code: otp,
      email_verify_exp: exp,
      email_verified_at: null,
    },
    select: { id: true, name: true, email: true, email_verified_at: true },
  });

  return maybeAttachOtp({
    ok: true,
    message: "Registered successfully. Please verify your email.",
    user,
  }, otp);
}

export async function resendVerifyCode(
  body: ResendVerifyBody
): Promise<{ ok: true; message: string; otp?: string }> {
  const email = normalizeEmail(body?.email);

  if (!email) {
    throw Object.assign(new Error("INVALID_INPUT"), {
      status: 400,
      meta: { code: "INVALID_INPUT" },
    });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email_verified_at: true },
  });

  if (!user) {
    throw Object.assign(new Error("USER_NOT_FOUND"), {
      status: 404,
      meta: { code: "USER_NOT_FOUND", email },
    });
  }

  if (user.email_verified_at) {
    return { ok: true, message: "ALREADY_VERIFIED" };
  }

  const otp = make6DigitCode();
  const exp = new Date(Date.now() + 15 * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      email_verify_code: otp,
      email_verify_exp: exp,
    },
  });

  return maybeAttachOtp({
    ok: true,
    message: "VERIFY_CODE_SENT",
  }, otp);
}

export async function login(body: LoginBody): Promise<LoginResult> {
  const email = normalizeEmail(body?.email);
  const password = normalizePassword(body?.password);

  const user = await getUserAuthByEmail(email);
  if (!user) {
    throw Object.assign(new Error("INVALID_CREDENTIALS"), { status: 401 });
  }

  let storedHash = String(user.password || "");
  if (storedHash.startsWith("$2y$")) {
    storedHash = "$2b$" + storedHash.slice(4);
  }

  const ok = await bcrypt.compare(password, storedHash).catch(() => false);
  if (!ok) {
    throw Object.assign(new Error("INVALID_CREDENTIALS"), { status: 401 });
  }

  if (!user.email_verified_at) {
    throwEmailNotVerified({ id: user.id, email: user.email });
  }

  const tokens = await issueLoginTokens({
    id: user.id,
    name: user.name,
    email: user.email,
  });

  return {
    ok: true,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    refresh_max_age_ms: tokens.refresh_max_age_ms,
    user: { id: user.id, name: user.name, email: user.email },
    access: tokens.access,
    refresh: tokens.refresh,
  };
}

export async function refresh(refresh_token?: string): Promise<RefreshResult> {
  if (!refresh_token) {
    throw Object.assign(new Error("NO_REFRESH_TOKEN"), { status: 401 });
  }

  const refreshSecret = process.env.JWT_REFRESH_SECRET || mustEnv("JWT_REFRESH_SECRET");
  const issuer = process.env.JWT_ISSUER || "chatapp";
  const audience = process.env.JWT_AUDIENCE || "chatapp";

  let payload: JwtPayload;
  try {
    payload = jwt.verify(refresh_token, refreshSecret, {
      algorithms: ["HS256"],
      issuer,
      audience,
    }) as JwtPayload;
  } catch {
    throw Object.assign(new Error("INVALID_REFRESH_TOKEN"), { status: 401 });
  }

  const typ = String((payload as JwtPayload & { typ?: string }).typ || "");
  if (typ !== "refresh") {
    throw Object.assign(new Error("INVALID_REFRESH_TOKEN"), { status: 401 });
  }

  const userId = parseUserIdFromSub(payload);
  if (!userId) {
    throw Object.assign(new Error("INVALID_REFRESH_TOKEN"), {
      status: 401,
      meta: { reason: "bad_sub" },
    });
  }

  const tokenHash = sha256(refresh_token);

  const row = await prisma.refreshToken.findUnique({
    where: { token_hash: tokenHash },
    select: {
      token_hash: true,
      revoked_at: true,
      expires_at: true,
    },
  });

  if (!row || row.revoked_at) {
    throw Object.assign(new Error("REFRESH_REVOKED"), { status: 401 });
  }

  if (row.expires_at.getTime() < Date.now()) {
    throw Object.assign(new Error("REFRESH_EXPIRED"), { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, email_verified_at: true },
  });

  if (!user) {
    throw Object.assign(new Error("USER_NOT_FOUND"), { status: 401 });
  }

  if (!user.email_verified_at) {
    throwEmailNotVerified({ id: user.id, email: user.email });
  }

  const access_token = signAccessToken({
    id: user.id,
    email: user.email,
    name: user.name,
  });

  return {
    ok: true,
    access_token,
    access: access_token,
    user: { id: user.id, name: user.name, email: user.email },
  };
}

export async function logout(refresh_token?: string): Promise<void> {
  if (!refresh_token) return;

  const tokenHash = sha256(refresh_token);

  await prisma.refreshToken.updateMany({
    where: {
      token_hash: tokenHash,
      revoked_at: null,
    },
    data: {
      revoked_at: new Date(),
    },
  });
}

export async function verifyEmail(body: VerifyEmailBody): Promise<VerifyEmailResult> {
  const email = normalizeEmail(body?.email);
  const otpRaw = body?.otp ?? body?.code ?? body?.verify_code ?? "";
  const otp = String(otpRaw).trim();

  const MASTER_OTP_ENABLED = asBool(process.env.AUTH_MASTER_OTP_ENABLED, false);
  const MASTER_OTP = String(process.env.AUTH_MASTER_OTP || "000000");

  if (!email || !otp) {
    throw Object.assign(new Error("INVALID_INPUT"), {
      status: 400,
      meta: { code: "INVALID_INPUT", email, otpPresent: Boolean(otp) },
    });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      email_verified_at: true,
      email_verify_code: true,
      email_verify_exp: true,
    },
  });

  if (!user) {
    throw Object.assign(new Error("USER_NOT_FOUND"), {
      status: 404,
      meta: { code: "USER_NOT_FOUND", email },
    });
  }

  if (user.email_verified_at) {
    const tokens = await issueLoginTokens({
      id: user.id,
      name: user.name,
      email: user.email,
    });

    return {
      ok: true,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      refresh_max_age_ms: tokens.refresh_max_age_ms,
      token_type: "Bearer",
      user: { id: user.id, name: user.name, email: user.email },
      message: "ALREADY_VERIFIED",
      access: tokens.access,
      refresh: tokens.refresh,
    };
  }

  if (MASTER_OTP_ENABLED && otp === MASTER_OTP) {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        email_verified_at: new Date(),
        email_verify_code: null,
        email_verify_exp: null,
      },
      select: { id: true, name: true, email: true },
    });

    const tokens = await issueLoginTokens({
      id: updated.id,
      name: updated.name,
      email: updated.email,
    });

    return {
      ok: true,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      refresh_max_age_ms: tokens.refresh_max_age_ms,
      token_type: "Bearer",
      user: updated,
      message: "VERIFIED_MASTER",
      access: tokens.access,
      refresh: tokens.refresh,
    };
  }

  if (!user.email_verify_code || !user.email_verify_exp) {
    throw Object.assign(new Error("NO_VERIFY_REQUEST"), {
      status: 400,
      meta: { code: "NO_VERIFY_REQUEST", email },
    });
  }

  if (user.email_verify_exp.getTime() < Date.now()) {
    throw Object.assign(new Error("VERIFY_CODE_EXPIRED"), {
      status: 400,
      meta: { code: "VERIFY_CODE_EXPIRED", email, exp: user.email_verify_exp.toISOString() },
    });
  }

  if (String(user.email_verify_code).trim() !== otp) {
    throw Object.assign(new Error("VERIFY_CODE_INVALID"), {
      status: 400,
      meta: { code: "VERIFY_CODE_INVALID", email },
    });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      email_verified_at: new Date(),
      email_verify_code: null,
      email_verify_exp: null,
    },
    select: { id: true, name: true, email: true },
  });

  const tokens = await issueLoginTokens({
    id: updated.id,
    name: updated.name,
    email: updated.email,
  });

  return {
    ok: true,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    refresh_max_age_ms: tokens.refresh_max_age_ms,
    token_type: "Bearer",
    user: updated,
    message: "VERIFIED",
    access: tokens.access,
    refresh: tokens.refresh,
  };
}

export async function me(
  userId: number
): Promise<{ id: number; name: string; email: string; email_verified_at: Date | null }> {
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: { id: true, name: true, email: true, email_verified_at: true },
  });

  if (!user) {
    throw Object.assign(new Error("USER_NOT_FOUND"), { status: 404 });
  }

  return user;
}

export async function listUsers(
  currentUserId: number
): Promise<
  Array<
    PublicUser & {
      first_name: string;
      last_name: string;
      photo: null;
      friendship_status: string;
      friendship_direction: "incoming" | "outgoing" | null;
      friendship_id: number | null;
    }
  >
> {
  const currentId = Number(currentUserId);

  const users = await prisma.user.findMany({
    where: { id: { not: currentId } },
    select: { id: true, name: true, email: true },
    orderBy: { id: "asc" },
    take: 200,
  });

  const otherUserIds = users.map((u) => u.id);

  let friendships: FriendshipLite[] = [];
  if (otherUserIds.length > 0) {
    friendships = await prisma.friendship.findMany({
      where: {
        OR: [
          {
            from_user_id: currentId,
            to_user_id: { in: otherUserIds },
          },
          {
            to_user_id: currentId,
            from_user_id: { in: otherUserIds },
          },
        ],
      },
      select: {
        id: true,
        from_user_id: true,
        to_user_id: true,
        status: true,
      },
    });
  }

  const friendshipIndex = new Map<
    number,
    {
      id: number;
      status: string;
      direction: "incoming" | "outgoing";
      raw: string;
    }
  >();

  for (const fs of friendships) {
    const outgoing = fs.from_user_id === currentId;
    const otherId = outgoing ? fs.to_user_id : fs.from_user_id;
    const direction: "incoming" | "outgoing" = outgoing ? "outgoing" : "incoming";

    const base = String(fs.status || "");
    let statusCode = "none";

    if (base === "accepted") {
      statusCode = "accepted";
    } else if (base === "pending") {
      statusCode = direction === "outgoing" ? "pending_outgoing" : "pending_incoming";
    } else {
      statusCode = base || "none";
    }

    friendshipIndex.set(otherId, {
      id: fs.id,
      status: statusCode,
      direction,
      raw: base,
    });
  }

  return users.map((u) => {
    const [first_name_raw, last_name] = splitName(u.name);
    const info = friendshipIndex.get(u.id);

    return {
      ...u,
      first_name: first_name_raw || u.name || "",
      last_name,
      photo: null,
      friendship_status: info?.status ?? "none",
      friendship_direction: info?.direction ?? null,
      friendship_id: info?.id ?? null,
    };
  });
}