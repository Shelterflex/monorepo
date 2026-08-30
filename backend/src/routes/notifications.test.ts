import { describe, it, expect, beforeEach, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'
import { sessionStore, userStore } from '../models/authStore.js'
import { _resetNotificationMemory, _getNotificationMemory } from '../services/notificationService.js'
import { expectErrorShape } from '../test-helpers.js'

const { TEST_ADMIN_SECRET } = vi.hoisted(() => ({
  TEST_ADMIN_SECRET: 'test-admin-secret-for-notifications',
}))

// Only override MANUAL_ADMIN_SECRET — everything else in env.js stays real,
// since this suite boots the full app via createApp().
vi.mock('../schemas/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../schemas/env.js')>()
  return {
    ...actual,
    env: { ...actual.env, MANUAL_ADMIN_SECRET: TEST_ADMIN_SECRET },
  }
})

describe('Notifications API', () => {
  let app: any
  let authToken: string

  beforeEach(async () => {
    _resetNotificationMemory()
    sessionStore.clear()
    userStore.clear()
    app = createApp()

    // Create a test user and session
    const user = await userStore.getOrCreateByEmail('test@example.com')
    const session = await sessionStore.create('test@example.com', 'test-session-token')
    authToken = session.token
  })

  describe('GET /api/notifications/unread-count', () => {
    it('should return unread count for authenticated user', async () => {
      const response = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data).toHaveProperty('unread')
      expect(typeof response.body.data.unread).toBe('number')
    })

    it('should reject unauthenticated request', async () => {
      const response = await request(app)
        .get('/api/notifications/unread-count')
        .expect(401)

      expectErrorShape(response, 'UNAUTHORIZED', 401)
    })

    it('should count only unread notifications', async () => {
      const user = await userStore.getByEmail('test@example.com')
      if (!user) throw new Error('User not found')

      // Add some notifications to memory
      const mem = _getNotificationMemory()
      mem.push({
        id: 'notif-1',
        userId: user.id,
        category: 'general',
        title: 'Test 1',
        body: 'Body 1',
        data: null,
        readAt: null,
        createdAt: new Date().toISOString(),
        dedupeKey: null,
      })
      mem.push({
        id: 'notif-2',
        userId: user.id,
        category: 'general',
        title: 'Test 2',
        body: 'Body 2',
        data: null,
        readAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        dedupeKey: null,
      })

      const response = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.data.unread).toBe(1)
    })
  })

  describe('GET /api/notifications', () => {
    it('should return paginated notifications for authenticated user', async () => {
      const user = await userStore.getByEmail('test@example.com')
      if (!user) throw new Error('User not found')

      const mem = _getNotificationMemory()
      mem.push({
        id: 'notif-1',
        userId: user.id,
        category: 'general',
        title: 'Test 1',
        body: 'Body 1',
        data: null,
        readAt: null,
        createdAt: new Date().toISOString(),
        dedupeKey: null,
      })

      const response = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.success).toBe(true)
      expect(response.body.data).toHaveProperty('items')
      expect(Array.isArray(response.body.data.items)).toBe(true)
      expect(response.body.data).toHaveProperty('nextCursor')
    })

    it('should reject unauthenticated request', async () => {
      const response = await request(app)
        .get('/api/notifications')
        .expect(401)

      expectErrorShape(response, 'UNAUTHORIZED', 401)
    })

    it('should filter by category', async () => {
      const user = await userStore.getByEmail('test@example.com')
      if (!user) throw new Error('User not found')

      const mem = _getNotificationMemory()
      mem.push({
        id: 'notif-1',
        userId: user.id,
        category: 'payment',
        title: 'Payment',
        body: 'Body',
        data: null,
        readAt: null,
        createdAt: new Date().toISOString(),
        dedupeKey: null,
      })
      mem.push({
        id: 'notif-2',
        userId: user.id,
        category: 'general',
        title: 'General',
        body: 'Body',
        data: null,
        readAt: null,
        createdAt: new Date().toISOString(),
        dedupeKey: null,
      })

      const response = await request(app)
        .get('/api/notifications?category=payment')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.data.items).toHaveLength(1)
      expect(response.body.data.items[0].category).toBe('payment')
    })

    it('should filter by read status', async () => {
      const user = await userStore.getByEmail('test@example.com')
      if (!user) throw new Error('User not found')

      const mem = _getNotificationMemory()
      mem.push({
        id: 'notif-1',
        userId: user.id,
        category: 'general',
        title: 'Test 1',
        body: 'Body 1',
        data: null,
        readAt: null,
        createdAt: new Date().toISOString(),
        dedupeKey: null,
      })
      mem.push({
        id: 'notif-2',
        userId: user.id,
        category: 'general',
        title: 'Test 2',
        body: 'Body 2',
        data: null,
        readAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        dedupeKey: null,
      })

      const response = await request(app)
        .get('/api/notifications?read=false')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.data.items).toHaveLength(1)
      expect(response.body.data.items[0].read).toBe(false)
    })

    it('should validate limit parameter', async () => {
      const response = await request(app)
        .get('/api/notifications?limit=invalid')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      // Should default to 20 on invalid input
      expect(response.body.data.items).toBeDefined()
    })

    it('should reject invalid cursor format', async () => {
      const response = await request(app)
        .get('/api/notifications?cursor=invalid-base64')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400)

      expectErrorShape(response, 'VALIDATION_ERROR', 400)
    })

    it('should not leak another users notifications', async () => {
      // Create another user
      const otherUser = await userStore.getOrCreateByEmail('other@example.com')
      const otherSession = await sessionStore.create('other@example.com', 'other-session-token')

      const user = await userStore.getByEmail('test@example.com')
      if (!user || !otherUser) throw new Error('User not found')

      const mem = _getNotificationMemory()
      mem.push({
        id: 'notif-1',
        userId: otherUser.id,
        category: 'general',
        title: 'Other User',
        body: 'Body',
        data: null,
        readAt: null,
        createdAt: new Date().toISOString(),
        dedupeKey: null,
      })

      const response = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.data.items).toHaveLength(0)
    })

    it('should return correct response shape', async () => {
      const user = await userStore.getByEmail('test@example.com')
      if (!user) throw new Error('User not found')

      const mem = _getNotificationMemory()
      mem.push({
        id: 'notif-1',
        userId: user.id,
        category: 'general',
        title: 'Test',
        body: 'Body',
        data: { key: 'value' },
        readAt: null,
        createdAt: new Date().toISOString(),
        dedupeKey: null,
      })

      const response = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      const item = response.body.data.items[0]
      expect(item).toHaveProperty('id')
      expect(item).toHaveProperty('category')
      expect(item).toHaveProperty('title')
      expect(item).toHaveProperty('body')
      expect(item).toHaveProperty('data')
      expect(item).toHaveProperty('read')
      expect(item).toHaveProperty('createdAt')
      expect(typeof item.read).toBe('boolean')
    })
  })

  describe('POST /api/notifications/:id/read', () => {
    it('should mark notification as read', async () => {
      const user = await userStore.getByEmail('test@example.com')
      if (!user) throw new Error('User not found')

      const mem = _getNotificationMemory()
      mem.push({
        id: 'notif-1',
        userId: user.id,
        category: 'general',
        title: 'Test',
        body: 'Body',
        data: null,
        readAt: null,
        createdAt: new Date().toISOString(),
        dedupeKey: null,
      })

      const response = await request(app)
        .post('/api/notifications/notif-1/read')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.success).toBe(true)
    })

    it('should reject unauthenticated request', async () => {
      const response = await request(app)
        .post('/api/notifications/notif-1/read')
        .expect(401)

      expectErrorShape(response, 'UNAUTHORIZED', 401)
    })

    it('should not allow marking another users notification', async () => {
      const otherUser = await userStore.getOrCreateByEmail('other@example.com')
      if (!otherUser) throw new Error('User not found')

      const mem = _getNotificationMemory()
      mem.push({
        id: 'notif-1',
        userId: otherUser.id,
        category: 'general',
        title: 'Other',
        body: 'Body',
        data: null,
        readAt: null,
        createdAt: new Date().toISOString(),
        dedupeKey: null,
      })

      const response = await request(app)
        .post('/api/notifications/notif-1/read')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      // Should succeed but not actually mark as read (user-scoped)
      const notif = mem.find(n => n.id === 'notif-1')
      expect(notif?.readAt).toBeNull()
    })
  })

  describe('POST /api/notifications/read-all', () => {
    it('should mark all notifications as read', async () => {
      const user = await userStore.getByEmail('test@example.com')
      if (!user) throw new Error('User not found')

      const mem = _getNotificationMemory()
      mem.push({
        id: 'notif-1',
        userId: user.id,
        category: 'general',
        title: 'Test 1',
        body: 'Body 1',
        data: null,
        readAt: null,
        createdAt: new Date().toISOString(),
        dedupeKey: null,
      })
      mem.push({
        id: 'notif-2',
        userId: user.id,
        category: 'general',
        title: 'Test 2',
        body: 'Body 2',
        data: null,
        readAt: null,
        createdAt: new Date().toISOString(),
        dedupeKey: null,
      })

      const response = await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body.success).toBe(true)

      const unreadCount = mem.filter(n => n.userId === user.id && !n.readAt).length
      expect(unreadCount).toBe(0)
    })

    it('should reject unauthenticated request', async () => {
      const response = await request(app)
        .post('/api/notifications/read-all')
        .expect(401)

      expectErrorShape(response, 'UNAUTHORIZED', 401)
    })

    it('should only mark current users notifications as read', async () => {
      const otherUser = await userStore.getOrCreateByEmail('other@example.com')
      if (!otherUser) throw new Error('User not found')

      const user = await userStore.getByEmail('test@example.com')
      if (!user) throw new Error('User not found')

      const mem = _getNotificationMemory()
      mem.push({
        id: 'notif-1',
        userId: user.id,
        category: 'general',
        title: 'Test',
        body: 'Body',
        data: null,
        readAt: null,
        createdAt: new Date().toISOString(),
        dedupeKey: null,
      })
      mem.push({
        id: 'notif-2',
        userId: otherUser.id,
        category: 'general',
        title: 'Other',
        body: 'Body',
        data: null,
        readAt: null,
        createdAt: new Date().toISOString(),
        dedupeKey: null,
      })

      await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      const otherUnread = mem.filter(n => n.userId === otherUser.id && !n.readAt).length
      expect(otherUnread).toBe(1)
    })
  })

  describe('POST /api/notifications/test-seed', () => {
    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/notifications/test-seed')
        .set('x-admin-secret', TEST_ADMIN_SECRET)
        .send({
          userId: 'user-id',
          // Missing title and body
        })
        .expect(400)

      expectErrorShape(response, 'VALIDATION_ERROR', 400)
    })

    it('should validate userId is required', async () => {
      const response = await request(app)
        .post('/api/notifications/test-seed')
        .set('x-admin-secret', TEST_ADMIN_SECRET)
        .send({
          title: 'Test',
          body: 'Body',
        })
        .expect(400)

      expectErrorShape(response, 'VALIDATION_ERROR', 400)
    })

    it('should return correct response shape on success', async () => {
      const user = await userStore.getByEmail('test@example.com')
      if (!user) throw new Error('User not found')

      const response = await request(app)
        .post('/api/notifications/test-seed')
        .set('x-admin-secret', TEST_ADMIN_SECRET)
        .send({
          userId: user.id,
          title: 'Test Notification',
          body: 'Test Body',
          category: 'test',
        })
        .expect(200)

      expect(response.body).toHaveProperty('success', true)
      expect(response.body).toHaveProperty('id')
      expect(typeof response.body.id).toBe('string')
    })
  })
})
