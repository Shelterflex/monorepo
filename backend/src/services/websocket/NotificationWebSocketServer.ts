import { WebSocketServer, WebSocket } from "ws"
import type { Server } from "http"
import { sessionStore, userStore } from "../../models/authStore.js"
import { logger } from "../../utils/logger.js"

interface NotificationMessage {
  type: "notification"
  payload: {
    id: string
    title: string
    body: string
    notificationType: string
    createdAt: string
  }
}

export class NotificationWebSocketServer {
  private wss: WebSocketServer | null = null
  private connections = new Map<string, Set<WebSocket>>()

  attach(server: Server): void {
    this.wss = new WebSocketServer({ server, path: "/ws/notifications" })

    this.wss.on("connection", async (ws, req) => {
      const url = new URL(req.url ?? "/", "http://localhost")
      const token = url.searchParams.get("token")

      if (!token) {
        ws.close(4001, "Authentication token required")
        return
      }

      try {
        const session = await sessionStore.getByToken(token)
        if (!session) {
          ws.close(4001, "Invalid or expired token")
          return
        }

        const user = await userStore.getByEmail(session.email)
        if (!user) {
          ws.close(4001, "User not found")
          return
        }

        const userId = user.id
        logger.info("WebSocket connected for notifications", {
          userId,
          requestId: req.headers["x-request-id"] as string ?? "ws",
        })

        if (!this.connections.has(userId)) {
          this.connections.set(userId, new Set())
        }
        this.connections.get(userId)!.add(ws)

        ws.on("close", () => {
          const conns = this.connections.get(userId)
          if (conns) {
            conns.delete(ws)
            if (conns.size === 0) {
              this.connections.delete(userId)
            }
          }
          logger.info("WebSocket disconnected", { userId })
        })

        ws.on("error", (err) => {
          logger.error("WebSocket error", { userId, error: err.message })
        })

        ws.send(JSON.stringify({ type: "connected", payload: { userId } }))
      } catch (error) {
        logger.error("WebSocket auth error", {
          error: error instanceof Error ? error.message : String(error),
        })
        ws.close(4001, "Authentication failed")
      }
    })

    logger.info("Notification WebSocket server attached")
  }

  sendToUser(userId: string, message: NotificationMessage): void {
    const conns = this.connections.get(userId)
    if (!conns || conns.size === 0) return

    const data = JSON.stringify(message)
    for (const ws of conns) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    }
  }

  getActiveConnectionCount(): number {
    return this.connections.size
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.wss) {
        resolve()
        return
      }

      for (const conns of this.connections.values()) {
        for (const ws of conns) {
          ws.close(1001, "Server shutting down")
        }
      }
      this.connections.clear()

      this.wss.close(() => {
        logger.info("Notification WebSocket server closed")
        resolve()
      })
    })
  }
}

export const notificationWSS = new NotificationWebSocketServer()
