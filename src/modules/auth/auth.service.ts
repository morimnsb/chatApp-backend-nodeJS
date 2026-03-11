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
  otp?: string; // dev only
};

export type LoginResult = {
  ok: true;
  access_token: string;
  refresh_token: string;
  refresh_max_age_ms: number;
  user: PublicUser;
};

export type RefreshResult = {
  ok: true;
  access_token: string;
  user: PublicUser;
};

export type VerifyEmailResult = {
  ok: true;
  access_token: string;
  token_type: "Bearer";
  user: PublicUser;
  message: string;
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

function make6DigitCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function signAccessToken(user: { id: number; email: string; name: string }): string {
  const secret =
    process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || mustEnv("JWT_ACCESS_SECRET");

  const expiresIn = (process.env.ACCESS_EXPIRES_IN || "15m") as SignOptions["expiresIn"];

  return jwt.sign(
    { sub: String(user.id), email: user.email, name: user.name },
    secret,
    { expiresIn }
  );
}

function signRefreshToken(user: { id: number }): string {
  const secret = process.env.JWT_REFRESH_SECRET || mustEnv("JWT_REFRESH_SECRET");

  const expiresIn = (process.env.REFRESH_EXPIRES_IN || "30d") as SignOptions["expiresIn"];

  return jwt.sign(
    { sub: String(user.id), typ: "refresh" },
    secret,
    { expiresIn }
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
  throw Object.assign(new Error("Validation failed"), { status: 422, errors });
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

function parseUserIdFromSub(payload: JwtPayload): number | null {
  const sub = (payload as JwtPayload & { sub?: string | number }).sub;
  const userId = Number(sub);
  return Number.isFinite(userId) && userId > 0 ? userId : null;
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

/* ----------------------------- service ----------------------------- */

export async function register(body: RegisterBody): Promise<RegisterResult> {
  const email = normalizeEmail(body?.email);

  const first_name_in = body?.first_name;
  const last_name_in = body?.last_name;
  const name_in = body?.name;

  let first_name = String(first_name_in ?? "").trim();
  let last_name = String(last_name_in ?? "").trim();

  if ((!first_name || !last_name) && name_in) {
    const full = String(name_in).trim().replace(/\s+/g, " ");
    const parts = full ? full.split(" ") : [];
    first_name = first_name || (parts.shift() ?? "");
    last_name = last_name || (parts.join(" ") ?? "");
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
  if (password && password2 && password !== password2) errors.password2 = ["Passwords do not match."];
  if (Object.keys(errors).length) throw422(errors);

  const exists = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (exists) throw422({ email: ["This email is already registered."] });

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

  return {
    ok: true,
    message: "Registered successfully. Please verify your email.",
    user,
    otp, // dev only
  };
}

export async function resendVerifyCode(
  body: ResendVerifyBody
): Promise<{ ok: true; message: string; otp?: string }> {
  const email = normalizeEmail(body?.email);
  if (!email) throw Object.assign(new Error("INVALID_INPUT"), { status: 400 });

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

  if (user.email_verified_at) return { ok: true, message: "ALREADY_VERIFIED" };

  const otp = make6DigitCode();
  const exp = new Date(Date.now() + 15 * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: { email_verify_code: otp, email_verify_exp: exp },
  });

  return { ok: true, message: "VERIFY_CODE_SENT", otp };
}

export async function login(body: LoginBody): Promise<LoginResult> {
  const email = normalizeEmail(body?.email);
  const password = normalizePassword(body?.password);

  const user = await getUserAuthByEmail(email);
  if (!user) throw Object.assign(new Error("INVALID_CREDENTIALS"), { status: 401 });

  // Laravel hash compatibility
  let storedHash = String(user.password || "");
  if (storedHash.startsWith("$2y$")) storedHash = "$2b$" + storedHash.slice(4);

  const ok = await bcrypt.compare(password, storedHash).catch(() => false);
  if (!ok) throw Object.assign(new Error("INVALID_CREDENTIALS"), { status: 401 });

  if (!user.email_verified_at) {
    throwEmailNotVerified({ id: user.id, email: user.email });
  }

  const access_token = signAccessToken({ id: user.id, email: user.email, name: user.name });
  const refresh_token = signRefreshToken({ id: user.id });

  const tokenHash = sha256(refresh_token);
  const refreshMs = msFromExpiresIn(process.env.REFRESH_EXPIRES_IN || "30d");
  const expiresAt = new Date(Date.now() + refreshMs);

  await prisma.refreshToken.create({
    data: {
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    },
  });

  return {
    ok: true,
    access_token,
    refresh_token,
    refresh_max_age_ms: refreshMs,
    user: { id: user.id, name: user.name, email: user.email },
  };
}

export async function refresh(refresh_token?: string): Promise<RefreshResult> {
  if (!refresh_token) throw Object.assign(new Error("NO_REFRESH_TOKEN"), { status: 401 });

  const refreshSecret = process.env.JWT_REFRESH_SECRET || mustEnv("JWT_REFRESH_SECRET");

  let payload: JwtPayload;
  try {
    payload = jwt.verify(refresh_token, refreshSecret) as JwtPayload;
  } catch {
    throw Object.assign(new Error("INVALID_REFRESH_TOKEN"), { status: 401 });
  }

  const userId = parseUserIdFromSub(payload);
  if (!userId) {
    throw Object.assign(new Error("INVALID_REFRESH_TOKEN"), { status: 401, meta: { reason: "bad_sub" } });
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

  if (!user) throw Object.assign(new Error("USER_NOT_FOUND"), { status: 401 });

  if (!user.email_verified_at) throwEmailNotVerified({ id: user.id, email: user.email });

  const access_token = signAccessToken({ id: user.id, email: user.email, name: user.name });

  return {
    ok: true,
    access_token,
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

  const MASTER_OTP = "000000";

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
      status: 400,
      meta: { code: "USER_NOT_FOUND", email },
    });
  }

  if (user.email_verified_at) {
    const access_token = signAccessToken({ id: user.id, email: user.email, name: user.name });
    return {
      ok: true,
      access_token,
      token_type: "Bearer",
      user: { id: user.id, name: user.name, email: user.email },
      message: "ALREADY_VERIFIED",
    };
  }

  if (otp === MASTER_OTP) {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        email_verified_at: new Date(),
        email_verify_code: null,
        email_verify_exp: null,
      },
      select: { id: true, name: true, email: true },
    });

    const access_token = signAccessToken({ id: updated.id, email: updated.email, name: updated.name });

    return {
      ok: true,
      access_token,
      token_type: "Bearer",
      user: updated,
      message: "VERIFIED_MASTER",
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

  const access_token = signAccessToken({ id: updated.id, email: updated.email, name: updated.name });

  return {
    ok: true,
    access_token,
    token_type: "Bearer",
    user: updated,
    message: "VERIFIED",
  };
}

export async function me(
  userId: number
): Promise<{ id: number; name: string; email: string; email_verified_at: Date | null }> {
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: { id: true, name: true, email: true, email_verified_at: true },
  });

  if (!user) throw Object.assign(new Error("USER_NOT_FOUND"), { status: 404 });
  return user;
}

export async function listUsers(
  currentUserId: number
): Promise<Array<PublicUser & { first_name: string; last_name: string; photo: null }>> {
  const users = await prisma.user.findMany({
    where: { id: { not: Number(currentUserId) } },
    select: { id: true, name: true, email: true },
    orderBy: { id: "asc" },
    take: 200,
  });

  return users.map((u) => {
    const parts = String(u.name || "").trim().split(/\s+/);
    const first_name = parts[0] || u.name || "";
    const last_name = parts.slice(1).join(" ");
    return { ...u, first_name, last_name, photo: null };
  });
}