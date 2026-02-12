// src/config/jwt.js
export const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
