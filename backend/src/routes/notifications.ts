import { Router, type Request, type Response, type NextFunction } from 'express'
import { getPool } from '../db.js'
import { env } from '../schemas/env.js'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'
import { notificationService, _getNotificationMemory } from '../services/notificationService.js'
import { assertAdminSecret as requireAdmin } from '../middleware/adminSecret.js'
import { z } from 'zod'

export function createNotificationsRouter() {
  const r = Router()

  r.get(
    '/unread-count',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = req.user!.id
        const pool = await getPool()
        if (!pool) {
          const n = _getNotificationMemory().filter((m) => m.userId === userId && !m.readAt)
            .length
          return res.json({ success: true, data: { unread: n } })
        }
        const { rows } = await pool.query(
          `SELECT count(*)::int AS c FROM user_notifications WHERE user_id = $1 AND read_at IS NULL`,
          [userId],
        )
        return res.json({ success: true, data: { unread: rows[0].c } })
      } catch (e) {
        next(e)
      }
    },
  )

  /**
   * GET /api/notifications — keyset cursor: pass `cursor` = base64url(JSON.stringify({ t: ISO, id })) from `nextCursor`.
   * First page: omit `cursor`. Page size: `limit` (default 20, max 100).
   */
  r.get(
    '/',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = req.user!.id
        const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20))
        const curRaw = typeof req.query.cursor === 'string' ? req.query.cursor : null
        const category = typeof req.query.category === 'string' ? req.query.category : null
        const readFilter = req.query.read
        let tBound: string | null = null
        let idBound: string | null = null
        if (curRaw) {
          try {
            const s = JSON.parse(Buffer.from(curRaw, 'base64url').toString('utf8')) as { t: string; id: string }
            tBound = s.t
            idBound = s.id
          } catch {
            throw new AppError(ErrorCode.VALIDATION_ERROR, 400, 'Invalid cursor')
          }
        }

        const pool = await getPool()
        if (!pool) {
          let items = _getNotificationMemory()
            .filter((n) => n.userId === userId)
            .filter((n) => !category || n.category === category)
            .filter((n) => readFilter === undefined || (readFilter === 'false' ? !n.readAt : !!n.readAt))
            .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          if (tBound && idBound) {
            items = items.filter((i) => i.createdAt < tBound || (i.createdAt === tBound && i.id < idBound))
          }
          const page = items.slice(0, limit)
          const last = page[page.length - 1]
          const nextCur =
            last
              ? Buffer.from(JSON.stringify({ t: last.createdAt, id: last.id }), 'utf8').toString('base64url')
              : null
          return res.json({
            success: true,
            data: {
              items: page.map((i) => ({
                id: i.id,
                category: i.category,
                title: i.title,
                body: i.body,
                data: i.data,
                read: !!i.readAt,
                createdAt: i.createdAt,
              })),
              nextCursor: nextCur,
            },
          })
        }

        const take = limit + 1
        const params: unknown[] = [userId]
        let sql = `SELECT id, category, title, body, data, read_at, created_at
          FROM user_notifications
          WHERE user_id = $1`
        let paramIndex = 2
        if (category) {
          params.push(category)
          sql += ` AND category = $${paramIndex++}`
        }
        if (readFilter !== undefined) {
          const isRead = readFilter === 'true'
          sql += isRead ? ` AND read_at IS NOT NULL` : ` AND read_at IS NULL`
        }
        if (tBound && idBound) {
          params.push(tBound, idBound)
          sql += ` AND (created_at, id) < ($${paramIndex++}::timestamptz, $${paramIndex++}::uuid)`
        }
        params.push(take)
        sql += ` ORDER BY created_at DESC, id DESC LIMIT $${paramIndex}`
        const { rows } = await pool.query(sql, params)
        const hasMore = rows.length > take - 1
        const outRows = (hasMore ? rows.slice(0, limit) : rows) as {
          id: string
          category: string
          title: string
          body: string
          data: unknown
          read_at: string | null
          created_at: string
        }[]
        const last = outRows[outRows.length - 1]
        res.json({
          success: true,
          data: {
            items: outRows.map((row) => ({
              id: row.id,
              category: row.category,
              title: row.title,
              body: row.body,
              data: row.data,
              read: row.read_at != null,
              createdAt: new Date(row.created_at).toISOString(),
            })),
            nextCursor: hasMore && last
              ? Buffer.from(
                  JSON.stringify({ t: new Date(last.created_at).toISOString(), id: last.id }),
                  'utf8',
                ).toString('base64url')
              : null,
          },
        })
      } catch (e) {
        next(e)
      }
    },
  )

  r.post(
    '/:id/read',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = req.user!.id
        const { id } = req.params
        const pool = await getPool()
        if (!pool) {
          const n = _getNotificationMemory().find((m) => m.id === id && m.userId === userId)
          if (n && !n.readAt) n.readAt = new Date().toISOString()
          return res.json({ success: true })
        }
        await pool.query(
          `UPDATE user_notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = $1 AND user_id = $2`,
          [id, userId],
        )
        res.json({ success: true })
      } catch (e) {
        next(e)
      }
    },
  )

  r.post(
    '/read-all',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
      try {
        const userId = req.user!.id
        const pool = await getPool()
        if (!pool) {
          for (const n of _getNotificationMemory()) {
            if (n.userId === userId && !n.readAt) n.readAt = new Date().toISOString()
          }
          return res.json({ success: true, marked: true })
        }
        await pool.query(
          `UPDATE user_notifications SET read_at = COALESCE(read_at, NOW()) WHERE user_id = $1 AND read_at IS NULL`,
          [userId],
        )
        res.json({ success: true })
      } catch (e) {
        next(e)
      }
    },
  )

  /** Server-Sent Events: periodic unread count + backfill signal for reconnects. */
  r.get(
    '/stream',
    authenticateToken,
    async (req: AuthenticatedRequest, res: Response) => {
      const userId = req.user!.id
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')
      res.flushHeaders()

      const writeEvent = (event: string, data: unknown) => {
        res.write(`event: ${event}\n`)
        res.write(`data: ${JSON.stringify(data)}\n\n`)
      }

      const send = async () => {
        const pool = await getPool()
        if (!pool) {
          const unread = _getNotificationMemory().filter((m) => m.userId === userId && !m.readAt)
            .length
          writeEvent('snapshot', { unread, ts: new Date().toISOString() })
          return
        }
        const { rows } = await pool.query(`SELECT count(*)::int AS c FROM user_notifications WHERE user_id = $1 AND read_at IS NULL`, [
          userId,
        ])
        writeEvent('snapshot', { unread: rows[0].c, ts: new Date().toISOString() })
      }
      void send()
      const t = setInterval(() => {
        void send()
      }, 5000)
      if (t.unref) t.unref()
      req.on('close', () => {
        clearInterval(t)
        res.end()
      })
    },
  )

  const seedSchema = z.object({
    userId: z.string(),
    title: z.string(),
    body: z.string(),
    category: z.string().optional(),
  })

  r.post(
    '/test-seed',
    async (req, res, next) => {
      try {
        requireAdmin(req)
        if (env.NODE_ENV === 'production' && !process.env.ALLOW_NOTIFICATION_TEST_SEED) {
          throw new AppError(ErrorCode.FORBIDDEN, 403, 'Disabled')
        }
        const p = seedSchema.parse(req.body)
        const id = await notificationService.create(p.userId, {
          title: p.title,
          body: p.body,
          category: p.category ?? 'general',
        })
        res.json({ success: true, id })
      } catch (e) {
        next(e)
      }
    },
  )

  return r
}
