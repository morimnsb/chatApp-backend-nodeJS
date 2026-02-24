// chat-backend-node\src\modules\auth\auth.service.js
import prisma from "../../prisma.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";

function make6DigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function signAccessToken(user) {
  return jwt.sign(
    { email: user.email, name: user.name },
    process.env.JWT_ACCESS_SECRET,
    { subject: String(user.id), expiresIn: process.env.ACCESS_EXPIRES_IN || "15m" }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    { typ: "refresh" },
    process.env.JWT_REFRESH_SECRET,
    { subject: String(user.id), expiresIn: process.env.REFRESH_EXPIRES_IN || "30d" }
  );
}

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function msFromExpiresIn(expiresIn) {
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

function isExpired(d) {
  if (!d) return true;
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return !Number.isFinite(t) || t < Date.now();
}

function maskEmail(email) {
  const e = String(email || "");
  const [u, d] = e.split("@");
  if (!u || !d) return e;
  const head = u.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, u.length - 2))}@${d}`;
}

function throw422(errors) {
  throw Object.assign(new Error("Validation failed"), { status: 422, errors });
}

function throwEmailNotVerified(user) {
  // ✅ 403 + machine-readable meta (frontend can show verify screen)
  throw Object.assign(new Error("EMAIL_NOT_VERIFIED"), {
    status: 403,
    meta: {
      code: "EMAIL_NOT_VERIFIED",
      email: user?.email ? maskEmail(user.email) : null,
      user_id: user?.id ?? null,
      // helpful for UI
      can_resend: true,
    },
  });
}

/**
 * ✅ REGISTER
 * - creates verify code + expiry (15 min)
 * - NEVER logs in automatically
 * - returns otp ONLY if you want (now we keep it for now; remove later)
 */
export async function register(body) {
  const email = String(body?.email ?? "").trim().toLowerCase();

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

  const password = String(body?.password ?? "");
  let password2 = String(body?.password2 ?? body?.password_confirmation ?? "");
if (!password2 && password) password2 = password; // allow single-field register

  const errors = {};
  if (!first_name) errors.first_name = ["First name is required."];
  if (!last_name) errors.last_name = ["Last name is required."];
  if (!email) errors.email = ["Email is required."];
  if (password.length < 8) errors.password = ["Password must be at least 8 characters."];
  if (!password2) errors.password2 = ["Repeat password is required."];
  if (password && password2 && password !== password2) {
    errors.password2 = ["Passwords do not match."];
  }
  if (Object.keys(errors).length) throw422(errors);

  const exists = await prisma.user.findUnique({ where: { email } });
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
      emailVerifyCode: otp,
      emailVerifyExp: exp,
      emailVerifiedAt: null,
    },
    select: { id: true, name: true, email: true, emailVerifiedAt: true },
  });

  return {
    ok: true,
    message: "Registered successfully. Please verify your email.",
    user,
    // ✅ keep for now (dev/testing). remove later when email sender is ready.
    otp,
  };
}

/**
 * ✅ RESEND VERIFY CODE (NEW)
 * - rate-limit at route level
 * - if user already verified -> ok
 */
export async function resendVerifyCode(body) {
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!email) throw Object.assign(new Error("INVALID_INPUT"), { status: 400 });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
   throw Object.assign(new Error("USER_NOT_FOUND"), {
     status: 404,
    meta: { code: "USER_NOT_FOUND", email },
   });
 }

  if (user.emailVerifiedAt) {
    return { ok: true, message: "ALREADY_VERIFIED" };
  }

  // ✅ generate new code always (simple + safe)
  const otp = make6DigitCode();
  const exp = new Date(Date.now() + 15 * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerifyCode: otp, emailVerifyExp: exp },
  });

  // TODO: send email here (SMTP/provider)
  return {
    ok: true,
    message: "VERIFY_CODE_SENT",
    // keep in dev for now
    otp,
  };
}

export async function login(body) {
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  console.log("\n================ LOGIN DEBUG ================");
  console.log("[AUTH] DATABASE_URL =", process.env.DATABASE_URL);
  console.log("[AUTH] email input =", email);
  console.log("[AUTH] password length =", password.length);

  const user = await prisma.user.findUnique({ where: { email } });

  console.log("[AUTH] user found? =", Boolean(user));
  console.log("[AUTH] user id =", user?.id);
  console.log("[AUTH] emailVerifiedAt =", user?.emailVerifiedAt);
  console.log(
    "[AUTH] stored hash preview =",
    user?.password ? String(user.password).slice(0, 15) : null
  );

  if (!user) {
    console.log("[AUTH] ❌ USER NOT FOUND");
    throw Object.assign(new Error("INVALID_CREDENTIALS"), { status: 401 });
  }

  // اگر hash لاراولی بود
  let storedHash = String(user.password || "");
  if (storedHash.startsWith("$2y$")) {
    console.log("[AUTH] ⚠ converting $2y$ -> $2b$");
    storedHash = "$2b$" + storedHash.slice(4);
  }

  let ok = false;
  try {
    ok = await bcrypt.compare(password, storedHash);
  } catch (err) {
    console.log("[AUTH] ❌ bcrypt.compare threw error =", err.message);
  }

  console.log("[AUTH] bcrypt.compare result =", ok);

  if (!ok) {
    console.log("[AUTH] ❌ PASSWORD MISMATCH");
    throw Object.assign(new Error("INVALID_CREDENTIALS"), { status: 401 });
  }

  // verify check
  if (!user.emailVerifiedAt) {
    console.log("[AUTH] ❌ EMAIL NOT VERIFIED");
    throwEmailNotVerified(user);
  }

  console.log("[AUTH] ✅ LOGIN SUCCESS");

  const access_token = signAccessToken(user);
  const refresh_token = signRefreshToken(user);

  const tokenHash = sha256(refresh_token);
  const refreshMs = msFromExpiresIn(process.env.REFRESH_EXPIRES_IN || "30d");
  const expiresAt = new Date(Date.now() + refreshMs);

  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });

  return {
    ok: true,
    access_token,
    refresh_token,
    refresh_max_age_ms: refreshMs,
    user: { id: user.id, name: user.name, email: user.email },
  };
}

export async function refresh(refresh_token) {
  if (!refresh_token) throw Object.assign(new Error("NO_REFRESH_TOKEN"), { status: 401 });

  let payload;
  try {
    payload = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);
  } catch {
    throw Object.assign(new Error("INVALID_REFRESH_TOKEN"), { status: 401 });
  }

  const userId = Number(payload.sub);
  const tokenHash = sha256(refresh_token);

  const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!row || row.revokedAt) throw Object.assign(new Error("REFRESH_REVOKED"), { status: 401 });
  if (row.expiresAt.getTime() < Date.now()) throw Object.assign(new Error("REFRESH_EXPIRED"), { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, emailVerifiedAt: true, emailVerifyExp: true },
  });
  if (!user) throw Object.assign(new Error("USER_NOT_FOUND"), { status: 401 });

  // ✅ refresh also requires verified email
  if (!user.emailVerifiedAt) {
    throwEmailNotVerified(user);
  }

  const access_token = signAccessToken(user);
  return { ok: true, access_token, user: { id: user.id, name: user.name, email: user.email } };
}

export async function logout(refresh_token) {
  if (!refresh_token) return;

  const tokenHash = sha256(refresh_token);

  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function verifyEmail(body) {
  const email = String(body?.email ?? "").trim().toLowerCase();
  const otpRaw = body?.otp ?? body?.code ?? body?.verify_code ?? "";
  const otp = String(otpRaw).trim();

  // ✅ master otp for now
  const MASTER_OTP = "000000";

  console.log("[verifyEmail] input", {
    email,
    otp,
    otpLen: otp.length,
    otpType: typeof otpRaw,
  });

  if (!email || !otp) {
    throw Object.assign(new Error("INVALID_INPUT"), {
      status: 400,
      meta: { code: "INVALID_INPUT", email, otpPresent: Boolean(otp) },
    });
  }

  const user = await prisma.user.findUnique({ where: { email } });

  console.log("[verifyEmail] user lookup", {
    email,
    found: Boolean(user),
    userId: user?.id,
    emailVerifiedAt: user?.emailVerifiedAt ? user.emailVerifiedAt.toISOString?.() : null,
    dbCode: user?.emailVerifyCode ?? null,
    dbExp: user?.emailVerifyExp ? user.emailVerifyExp.toISOString?.() : null,
    now: new Date().toISOString(),
  });

  if (!user) {
    throw Object.assign(new Error("USER_NOT_FOUND"), {
      status: 400,
      meta: { code: "USER_NOT_FOUND", email },
    });
  }

  // ✅ already verified
  if (user.emailVerifiedAt) {
    const access_token = signAccessToken(user);
    return {
      ok: true,
      access_token,
      token_type: "Bearer",
      user: { id: user.id, name: user.name, email: user.email },
      message: "ALREADY_VERIFIED",
    };
  }

  // ✅ master OTP bypass (temporary)
  if (otp === MASTER_OTP) {
    console.log("[verifyEmail] MASTER OTP used ✅", { email, userId: user.id });

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        emailVerifyCode: null,
        emailVerifyExp: null,
      },
      select: { id: true, name: true, email: true },
    });

    const access_token = signAccessToken(updated);

    return {
      ok: true,
      access_token,
      token_type: "Bearer",
      user: updated,
      message: "VERIFIED_MASTER",
    };
  }

  // ✅ normal OTP flow
  if (!user.emailVerifyCode || !user.emailVerifyExp) {
    throw Object.assign(new Error("NO_VERIFY_REQUEST"), {
      status: 400,
      meta: { code: "NO_VERIFY_REQUEST", email },
    });
  }

  if (user.emailVerifyExp.getTime() < Date.now()) {
    throw Object.assign(new Error("VERIFY_CODE_EXPIRED"), {
      status: 400,
      meta: {
        code: "VERIFY_CODE_EXPIRED",
        email,
        exp: user.emailVerifyExp.toISOString?.(),
      },
    });
  }

  if (String(user.emailVerifyCode).trim() !== otp) {
    console.log("[verifyEmail] OTP mismatch ❌", {
      email,
      provided: otp,
      stored: String(user.emailVerifyCode),
    });

    throw Object.assign(new Error("VERIFY_CODE_INVALID"), {
      status: 400,
      meta: { code: "VERIFY_CODE_INVALID", email },
    });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifiedAt: new Date(),
      emailVerifyCode: null,
      emailVerifyExp: null,
    },
    select: { id: true, name: true, email: true },
  });

  const access_token = signAccessToken(updated);

  return {
    ok: true,
    access_token,
    token_type: "Bearer",
    user: updated,
    message: "VERIFIED",
  };
}


export async function me(userId) {
  const user = await prisma.user.findUnique({
    where: { id: Number(userId) },
    select: { id: true, name: true, email: true, emailVerifiedAt: true },
  });
  if (!user) throw Object.assign(new Error("USER_NOT_FOUND"), { status: 404 });
  return user;
}

export async function listUsers(currentUserId) {
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
