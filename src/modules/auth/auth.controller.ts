// chat-backend-node/src/modules/auth/auth.controller.ts
import type { CookieOptions, RequestHandler } from "express";
import * as service from "./auth.service.js";
import type {
  RegisterBody,
  LoginBody,
  VerifyEmailBody,
  ResendVerifyBody,
} from "./auth.service.js";

const DEV = process.env.NODE_ENV !== "production";

function cookieOptions(maxAge: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: !DEV,
    path: "/api/auth",
    maxAge,
  };
}

type CookieBag = { refresh_token?: string };
function getRefreshCookie(req: Parameters<RequestHandler>[0]): string | undefined {
  const cookies = (req as any).cookies as CookieBag | undefined;
  return cookies?.refresh_token;
}

export const register: RequestHandler = async (req, res, next) => {
  try {
    if (DEV) console.log("[REGISTER BODY]", req.body);
    const out = await service.register(req.body as RegisterBody);
    res.json(out);
  } catch (e) {
    next(e);
  }
};

export const login: RequestHandler = async (req, res, next) => {
  try {
    const out = await service.login(req.body as LoginBody);

    res.cookie("refresh_token", out.refresh_token, cookieOptions(out.refresh_max_age_ms));
    res.json({ ok: true, access_token: out.access_token, user: out.user });
  } catch (e) {
    next(e);
  }
};

export const refresh: RequestHandler = async (req, res, next) => {
  try {
    const token = getRefreshCookie(req);
    const out = await service.refresh(token);
    res.json({ ok: true, access_token: out.access_token, user: out.user });
  } catch (e) {
    next(e);
  }
};

export const logout: RequestHandler = async (req, res, next) => {
  try {
    const token = getRefreshCookie(req);
    await service.logout(token);

    res.clearCookie("refresh_token", cookieOptions(0));
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
};

export const verifyEmail: RequestHandler = async (req, res, next) => {
  try {
    const out = await service.verifyEmail(req.body as VerifyEmailBody);
    res.json(out);
  } catch (e) {
    next(e);
  }
};

export const me: RequestHandler = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "UNAUTHORIZED" });

    const out = await service.me(userId);
    res.json(out);
  } catch (e) {
    next(e);
  }
};

export const listUsers: RequestHandler = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: "UNAUTHORIZED" });

    const out = await service.listUsers(userId);
    res.json(out);
  } catch (e) {
    next(e);
  }
};

export const resendVerifyCode: RequestHandler = async (req, res, next) => {
  try {
    const out = await service.resendVerifyCode(req.body as ResendVerifyBody);
    res.json(out);
  } catch (e) {
    next(e);
  }
};