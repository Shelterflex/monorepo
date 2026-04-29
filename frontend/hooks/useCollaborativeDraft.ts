/**
 * Hook that wires the collaborative draft store to the WebSocket transport (#655).
 *
 * Protocol messages (all JSON):
 *   Client → Server:
 *     { type: 'draft.field.change',   draftId, field, value, version }
 *     { type: 'draft.presence.focus', draftId, field }
 *     { type: 'draft.presence.blur',  draftId, field }
 *     { type: 'draft.publish',        draftId }
 *
 *   Server → Client:
 *     { type: 'draft.field.change',  draftId, field, value, version, userId }
 *     { type: 'draft.presence',      draftId, userId, userName, focusedField }
 *     { type: 'draft.presence.left', draftId, userId }
 *     { type: 'draft.conflict',      draftId, field, remoteValue, remoteVersion, userId }
 */

'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useCollaborativeDraftStore } from '@/store/useCollaborativeDraftStore'

interface UseCollaborativeDraftOptions {
  draftId: string
  wsBaseUrl?: string
  currentUserId: string
  currentUserName: string
  initialFields: Record<string, string>
}

export function useCollaborativeDraft({
  draftId,
  wsBaseUrl = typeof window !== 'undefined' ? `ws://${window.location.host}` : '',
  currentUserId,
  currentUserName,
  initialFields,
}: UseCollaborativeDraftOptions) {
  const {
    fields,
    presence,
    conflicts,
    pendingChanges,
    isConnected,
    isSaving,
    lastSyncedAt,
    initDraft,
    setFieldValue,
    applyRemoteChange,
    updatePresence,
    removePresence,
    setFocus,
    resolveConflict,
    markSaved,
    setConnected,
  } = useCollaborativeDraftStore()

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maxReconnectAttempts = 10
  const reconnectAttempts = useRef(0)

  // ── Initialise draft ────────────────────────────────────────────────────────

  useEffect(() => {
    initDraft(draftId, initialFields)
  }, [draftId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── WebSocket connection ────────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const url = `${wsBaseUrl}/api/ws/draft/${draftId}?userId=${encodeURIComponent(currentUserId)}`
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      reconnectAttempts.current = 0
    }

    ws.onclose = () => {
      setConnected(false)
      if (reconnectAttempts.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 30_000)
        reconnectAttempts.current++
        reconnectTimerRef.current = setTimeout(connect, delay)
      }
    }

    ws.onerror = () => ws.close()

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>
        if (msg.draftId !== draftId) return

        switch (msg.type) {
          case 'draft.field.change':
            if (msg.userId !== currentUserId) {
              applyRemoteChange(
                msg.field as string,
                msg.value as string,
                msg.version as number,
                msg.userId as string,
              )
            }
            break

          case 'draft.presence':
            updatePresence({
              userId: msg.userId as string,
              userName: msg.userName as string,
              avatarUrl: msg.avatarUrl as string | undefined,
              focusedField: msg.focusedField as string | null,
              lastSeenAt: Date.now(),
              color: '',
            })
            break

          case 'draft.presence.left':
            removePresence(msg.userId as string)
            break

          case 'draft.saved':
            markSaved()
            break

          default:
            break
        }
      } catch {
        // ignore malformed messages
      }
    }
  }, [draftId, wsBaseUrl, currentUserId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  // ── Send helpers ────────────────────────────────────────────────────────────

  const send = useCallback((payload: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload))
    }
  }, [])

  const updateField = useCallback(
    (field: string, value: string) => {
      setFieldValue(field, value, currentUserId)
      const version = (useCollaborativeDraftStore.getState().fields[field]?.version ?? 0)
      send({ type: 'draft.field.change', draftId, field, value, version })
    },
    [draftId, currentUserId, send, setFieldValue],
  )

  const focusField = useCallback(
    (field: string) => {
      setFocus(field, currentUserId, currentUserName)
      send({ type: 'draft.presence.focus', draftId, field })
    },
    [draftId, currentUserId, currentUserName, send, setFocus],
  )

  const blurField = useCallback(
    (field: string) => {
      setFocus(null, currentUserId, currentUserName)
      send({ type: 'draft.presence.blur', draftId, field })
    },
    [draftId, currentUserId, currentUserName, send, setFocus],
  )

  const publishDraft = useCallback(() => {
    send({ type: 'draft.publish', draftId })
  }, [draftId, send])

  // Filter out current user from presence display
  const otherPresence = Object.values(presence).filter(p => p.userId !== currentUserId)

  return {
    fields,
    presence: otherPresence,
    conflicts,
    pendingChanges,
    isConnected,
    isSaving,
    lastSyncedAt,
    updateField,
    focusField,
    blurField,
    resolveConflict,
    publishDraft,
  }
}
