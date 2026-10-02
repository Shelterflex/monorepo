import { beforeEach, describe, expect, it, vi } from 'vitest'
import { conversationStore } from '../models/conversationStore.js'
import { notificationPreferenceStore } from '../models/notificationPreferenceStore.js'
import {
  _getPendingMessageDigestKeysForTests,
  _resetPendingMessageDigestsForTests,
  flushQueuedMessageNotificationDigest,
  queueMessageNotifications,
  sendQueuedMessageNotificationEmail,
} from './messageNotificationService.js'

const { enqueueMock, createNotificationMock } = vi.hoisted(() => ({
  enqueueMock: vi.fn(),
  createNotificationMock: vi.fn(),
}))

vi.mock('../notifications/notificationService.js', () => ({
  getNotificationService: () => ({
    enqueue: enqueueMock,
  }),
}))

vi.mock('./notificationService.js', () => ({
  notificationService: {
    create: createNotificationMock,
  },
}))

describe('messageNotificationService', () => {
  beforeEach(async () => {
    await conversationStore.clear()
    notificationPreferenceStore.reset()
    _resetPendingMessageDigestsForTests()
    enqueueMock.mockReset()
    createNotificationMock.mockReset()
  })

  it('batches rapid exchanges into one digest notification', async () => {
    const conversation = await conversationStore.createConversation({
      participantIds: ['sender@example.com', 'recipient@example.com'],
    })

    await queueMessageNotifications({
      conversationId: conversation.id,
      senderId: 'sender@example.com',
      body: 'First message',
      createdAt: '2026-07-27T12:00:00.000Z',
    })
    await queueMessageNotifications({
      conversationId: conversation.id,
      senderId: 'sender@example.com',
      body: 'Second message',
      createdAt: '2026-07-27T12:00:10.000Z',
    })

    const [key] = _getPendingMessageDigestKeysForTests()
    await flushQueuedMessageNotificationDigest({ key })

    expect(createNotificationMock).toHaveBeenCalledTimes(1)
    expect(createNotificationMock).toHaveBeenCalledWith(
      'recipient@example.com',
      expect.objectContaining({
        title: '2 new messages from sender',
      }),
    )
  })

  it('suppresses notifications when the recipient is actively viewing the conversation', async () => {
    const conversation = await conversationStore.createConversation({
      participantIds: ['sender@example.com', 'recipient@example.com'],
    })

    await conversationStore.markRead(conversation.id, 'recipient@example.com')

    await queueMessageNotifications({
      conversationId: conversation.id,
      senderId: 'sender@example.com',
      body: 'You should not notify me',
      createdAt: new Date().toISOString(),
    })

    expect(_getPendingMessageDigestKeysForTests()).toHaveLength(0)
  })

  it('honours the message email opt-out preference', async () => {
    const conversation = await conversationStore.createConversation({
      participantIds: ['sender@example.com', 'recipient@example.com'],
    })
    notificationPreferenceStore.optOut(
      'recipient@example.com',
      'message_received',
      'email',
    )

    await queueMessageNotifications({
      conversationId: conversation.id,
      senderId: 'sender@example.com',
      body: 'Opt-out test',
      createdAt: '2026-07-27T12:00:00.000Z',
    })

    const [key] = _getPendingMessageDigestKeysForTests()
    await sendQueuedMessageNotificationEmail({ key })

    expect(enqueueMock).not.toHaveBeenCalled()
  })
})
