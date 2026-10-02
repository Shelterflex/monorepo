import { getScheduler } from '../jobs/scheduler/worker.js'
import {
  notificationPreferenceStore,
  type NotificationTemplate,
} from '../models/notificationPreferenceStore.js'
import { conversationStore } from '../models/conversationStore.js'
import { getNotificationService } from '../notifications/notificationService.js'
import { NotificationChannel } from '../notifications/types.js'
import { notificationService } from './notificationService.js'
import { logger } from '../utils/logger.js'

const MESSAGE_TEMPLATE: NotificationTemplate = 'message_received'
const QUIET_WINDOW_MS = 60_000
const EMAIL_DELAY_MS = 5 * 60_000
const ACTIVE_VIEWER_WINDOW_MS = 30_000

interface PendingMessageDigest {
  key: string
  recipientId: string
  conversationId: string
  firstMessageAt: string
  latestMessageAt: string
  latestSenderId: string
  preview: string
  count: number
  inAppDelivered: boolean
}

const pendingDigests = new Map<string, PendingMessageDigest>()

function buildKey(recipientId: string, conversationId: string) {
  return `${recipientId}:${conversationId}`
}

function senderLabel(senderId: string) {
  if (senderId.includes('@')) {
    return senderId.split('@')[0] || senderId
  }
  return senderId
}

function safePreview(body: string) {
  return body.replace(/\s+/g, ' ').trim().slice(0, 80)
}

function buildConversationUrl(conversationId: string) {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'
  return `${frontendUrl}/messages?conversationId=${encodeURIComponent(conversationId)}`
}

async function hasSeenConversationSince(
  conversationId: string,
  recipientId: string,
  firstMessageAt: string,
) {
  const conversation = await conversationStore.getConversation(
    conversationId,
    recipientId,
  )
  const participant = conversation?.participants.find(
    (item) => item.userId === recipientId,
  )

  if (!participant?.lastReadAt) {
    return false
  }

  return (
    new Date(participant.lastReadAt).getTime() >=
    new Date(firstMessageAt).getTime()
  )
}

async function isActiveViewer(
  conversationId: string,
  recipientId: string,
  messageCreatedAt: string,
) {
  const conversation = await conversationStore.getConversation(
    conversationId,
    recipientId,
  )
  const participant = conversation?.participants.find(
    (item) => item.userId === recipientId,
  )

  if (!participant?.lastReadAt) {
    return false
  }

  return (
    new Date(messageCreatedAt).getTime() -
      new Date(participant.lastReadAt).getTime() <=
    ACTIVE_VIEWER_WINDOW_MS
  )
}

function buildInAppNotification(digest: PendingMessageDigest) {
  const sender = senderLabel(digest.latestSenderId)
  return {
    category: 'messages',
    title:
      digest.count === 1
        ? `New message from ${sender}`
        : `${digest.count} new messages from ${sender}`,
    body:
      digest.count === 1
        ? digest.preview
        : `${digest.preview} · Open the conversation to catch up.`,
    data: {
      conversationId: digest.conversationId,
      senderId: digest.latestSenderId,
      preview: digest.preview,
      messageCount: digest.count,
      url: buildConversationUrl(digest.conversationId),
    },
  }
}

function buildEmailNotification(digest: PendingMessageDigest) {
  const sender = senderLabel(digest.latestSenderId)
  const messageCountLabel = `${digest.count} new message${
    digest.count === 1 ? '' : 's'
  }`
  const url = buildConversationUrl(digest.conversationId)

  return {
    channel: NotificationChannel.EMAIL,
    recipient: digest.recipientId,
    subject: `${messageCountLabel} from ${sender}`,
    body: `${messageCountLabel} are waiting in your ShelterFlex inbox. Open ${url} to reply.`,
    html: `
      <p>You have <strong>${messageCountLabel}</strong> from <strong>${sender}</strong>.</p>
      <p>For privacy, message contents are not included in email. Open the conversation in ShelterFlex to reply.</p>
      <p><a href="${url}">Open conversation</a></p>
    `,
    metadata: {
      conversationId: digest.conversationId,
      senderId: digest.latestSenderId,
      messageCount: digest.count,
      url,
    },
  }
}

async function scheduleDigestJobs(digest: PendingMessageDigest) {
  const scheduler = getScheduler()
  await scheduler.schedule({
    name: `message-notification-digest:${digest.key}`,
    handler: 'messaging.notification.digest',
    payload: { digest },
    nextRunAt: new Date(Date.now() + QUIET_WINDOW_MS),
    maxRetries: 3,
    priority: 4,
  })
  await scheduler.schedule({
    name: `message-notification-email:${digest.key}`,
    handler: 'messaging.notification.email',
    payload: { digest },
    nextRunAt: new Date(Date.now() + EMAIL_DELAY_MS),
    maxRetries: 5,
    priority: 4,
  })
}

export async function queueMessageNotifications(input: {
  conversationId: string
  senderId: string
  body: string
  createdAt: string
}) {
  const conversation = await conversationStore.getConversation(
    input.conversationId,
    input.senderId,
  )

  if (!conversation) {
    return
  }

  const preview = safePreview(input.body)

  for (const participant of conversation.participants) {
    if (participant.userId === input.senderId) {
      continue
    }

    if (
      await isActiveViewer(
        input.conversationId,
        participant.userId,
        input.createdAt,
      )
    ) {
      continue
    }

    const key = buildKey(participant.userId, input.conversationId)
    const existing = pendingDigests.get(key)

    if (existing) {
      existing.count += 1
      existing.latestMessageAt = input.createdAt
      existing.latestSenderId = input.senderId
      existing.preview = preview
      pendingDigests.set(key, existing)
      continue
    }

    const digest = {
      key,
      recipientId: participant.userId,
      conversationId: input.conversationId,
      firstMessageAt: input.createdAt,
      latestMessageAt: input.createdAt,
      latestSenderId: input.senderId,
      preview,
      count: 1,
      inAppDelivered: false,
    }

    pendingDigests.set(key, digest)
    await scheduleDigestJobs(digest)
  }
}

export async function flushQueuedMessageNotificationDigest(payload: { key: string; digest?: PendingMessageDigest }) {
  const { key, digest: payloadDigest } = payload
  
  // Try to get digest from payload first (new behavior), fall back to in-memory map (backward compatibility)
  const digest = payloadDigest || pendingDigests.get(key)
  
  if (!digest || digest.inAppDelivered) {
    if (!payloadDigest && !digest) {
      logger.warn('[messageNotificationService] Digest not found for key, may have been lost due to process restart', { key })
    }
    return
  }

  if (
    await hasSeenConversationSince(
      digest.conversationId,
      digest.recipientId,
      digest.firstMessageAt,
    )
  ) {
    pendingDigests.delete(key)
    return
  }

  if (
    notificationPreferenceStore.isChannelEnabled(
      digest.recipientId,
      MESSAGE_TEMPLATE,
      'in_app',
    )
  ) {
    await notificationService.create(
      digest.recipientId,
      buildInAppNotification(digest),
    )
  }

  digest.inAppDelivered = true
  pendingDigests.set(key, digest)
}

export async function sendQueuedMessageNotificationEmail(payload: { key: string; digest?: PendingMessageDigest }) {
  const { key, digest: payloadDigest } = payload
  
  // Try to get digest from payload first (new behavior), fall back to in-memory map (backward compatibility)
  const digest = payloadDigest || pendingDigests.get(key)
  
  if (!digest) {
    logger.warn('[messageNotificationService] Digest not found for email key, may have been lost due to process restart', { key })
    return
  }

  if (
    await hasSeenConversationSince(
      digest.conversationId,
      digest.recipientId,
      digest.firstMessageAt,
    )
  ) {
    pendingDigests.delete(key)
    return
  }

  if (
    notificationPreferenceStore.isChannelEnabled(
      digest.recipientId,
      MESSAGE_TEMPLATE,
      'email',
    )
  ) {
    await getNotificationService().enqueue(buildEmailNotification(digest))
  }

  pendingDigests.delete(key)
}

export function _resetPendingMessageDigestsForTests() {
  pendingDigests.clear()
}

export function _getPendingMessageDigestKeysForTests() {
  return [...pendingDigests.keys()]
}

export async function queueMessageNotificationsSafely(input: {
  conversationId: string
  senderId: string
  body: string
  createdAt: string
}) {
  try {
    await queueMessageNotifications(input)
  } catch (error) {
    logger.error('Failed to queue message notifications', {
      conversationId: input.conversationId,
      senderId: input.senderId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
