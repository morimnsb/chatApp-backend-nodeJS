// chat-backend-node/src/modules/auth/auth.controller.js
import * as service from "./auth.service.js";

const DEV = process.env.NODE_ENV !== "production";

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: !DEV,         // ✅ true in production (https)
    path: "/api/auth",
    maxAge,
  };
}

export async function register(req, res, next) {
  try {
    if (DEV) console.log("[REGISTER BODY]", req.body);
    const out = await service.register(req.body);
    res.json(out);
  } catch (e) {
    next(e);
  }
}

export async function login(req, res, next) {
  try {
    const out = await service.login(req.body);

    res.cookie("refresh_token", out.refresh_token, cookieOptions(out.refresh_max_age_ms));

    // ✅ do not return refresh_token to client (cookie only)
    res.json({ ok: true, access_token: out.access_token, user: out.user });
  } catch (e) {
    next(e);
  }
}

export async function refresh(req, res, next) {
  try {
    const token = req.cookies?.refresh_token;
    const out = await service.refresh(token);
    res.json({ ok: true, access_token: out.access_token, user: out.user });
  } catch (e) {
    next(e);
  }
}

export async function logout(req, res, next) {
  try {
    const token = req.cookies?.refresh_token;
    await service.logout(token);

    // ✅ clear با همان config
    res.clearCookie("refresh_token", cookieOptions(0));

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}


export async function verifyEmail(req, res, next) {
  try {
    const out = await service.verifyEmail(req.body);
    res.json(out);
  } catch (e) {
    next(e);
  }
}

export async function me(req, res, next) {
  try {
    const out = await service.me(req.user.id);
    res.json(out);
  } catch (e) {
    next(e);
  }
}

export async function listUsers(req, res, next) {
  try {
    const out = await service.listUsers(req.user.id);
    res.json(out);
  } catch (e) {
    next(e);
  }
}
export async function resendVerifyCode(req, res, next) {
  try {
    const out = await service.resendVerifyCode(req.body);
    res.json(out);
  } catch (e) {
    next(e);
  }
}
