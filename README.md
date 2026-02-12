# 🚀 Chat Backend (Node + Express + Prisma + Socket.IO)

Production-ready backend for real-time chat application.

------------------------------------------------------------------------

## 📦 Tech Stack

-   Node.js (ESM)
-   Express 5
-   Prisma ORM
-   SQLite (default, can switch to Postgres)
-   Socket.IO
-   JWT Authentication (access + refresh)
-   Cookies + CORS ready
-   Zod validation
-   Helmet security
-   Rate limiting

------------------------------------------------------------------------

## ⚙️ Requirements

-   Node.js \>= 18
-   npm \>= 9

------------------------------------------------------------------------

## 📁 Setup (After Clone)

### 1️⃣ Install dependencies

PowerShell:

    npm install

### 2️⃣ Create environment file

Create `.env` based on `.env.example`:

    PORT=3000
    NODE_ENV=development
    CORS_ORIGIN=http://localhost:5173

    JWT_SECRET=change-me
    JWT_EXPIRES_IN=15m

    REFRESH_SECRET=change-me-too
    REFRESH_EXPIRES_IN=7d

    DATABASE_URL="file:./prisma/dev.db"

------------------------------------------------------------------------

### 3️⃣ Generate Prisma Client

    npm run prisma:generate

### 4️⃣ Create database tables

    npm run prisma:push

------------------------------------------------------------------------

### 5️⃣ Run development server

    npm run dev

Server will run at:

    http://localhost:3000

Health check:

    http://localhost:3000/api/health

------------------------------------------------------------------------

## 🏗 Production Start

    npm install
    npm run prisma:generate
    npm start

------------------------------------------------------------------------

## 🔌 API Routes

### Health

    GET /api/health

### Auth

    POST /api/auth/register
    POST /api/auth/login
    POST /api/auth/logout
    GET  /api/auth/me

### Chat

    GET    /api/chat/conversations/
    GET    /api/chat/messages/:roomId/
    POST   /api/chat/messages/

Alias supported:

    /api/chatMeetUp

------------------------------------------------------------------------

## 🔁 WebSocket (Socket.IO)

Endpoint:

    ws://localhost:3000/socket.io

Features: - Join room - Real-time messages - Typing indicators -
Notifications

------------------------------------------------------------------------

## 🧠 Notes

-   CORS configured with credentials support
-   Cookies enabled for refresh tokens
-   ETag disabled for API routes
-   No caching for API responses
-   Graceful shutdown implemented
-   Startup error handling implemented

------------------------------------------------------------------------

## 🛠 Useful Commands

    npm run dev
    npm start
    npm run prisma:generate
    npm run prisma:push
    npm run prisma:migrate
    npm run prisma:studio

------------------------------------------------------------------------

## 📄 License

ISC
