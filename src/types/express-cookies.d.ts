// chat-backend-node/src/types/express-cookies.d.ts
import "express";

declare global {
  namespace Express {
    interface Request {
      cookies?: Record<string, string>;
    }
  }
}

export {};