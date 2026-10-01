import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useCollaborativeDraft } from '../useCollaborativeDraft'
import { useCollaborativeDraftStore } from '@/store/useCollaborativeDraftStore'

let mockSend = vi.fn()
let mockLastMessage: any = null
let mockIsConnected = false

vi.mock('../use-websocket', () => ({
  useWebSocket: vi.fn(() => ({
    isConnected: mockIsConnected,
    isConnecting: false,
    connectionStatus: mockIsConnected ? 'live' : 'disconnected',
    error: null,
    lastMessage: mockLastMessage,
    reconnectAttempts: 0,
    send: mockSend,
    disconnect: vi.fn(),
    reconnect: vi.fn(),
  })),
}))

describe('useCollaborativeDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend = vi.fn()
    mockLastMessage = null
    mockIsConnected = true
    useCollaborativeDraftStore.setState({
      draftId: null,
      fields: {},
      presence: {},
      conflicts: [],
      pendingChanges: [],
      isConnected: false,
      isSaving: false,
      lastSyncedAt: null,
    })
  })

  it('initializes draft and syncs connection state', async () => {
    const { result } = renderHook(() =>
      useCollaborativeDraft({
        draftId: 'draft-123',
        currentUserId: 'user-1',
        currentUserName: 'Alice',
        initialFields: { title: 'Cozy Apartment' },
      }),
    )

    await waitFor(() => {
      expect(useCollaborativeDraftStore.getState().draftId).toBe('draft-123')
      expect(useCollaborativeDraftStore.getState().isConnected).toBe(true)
    })
  })

  it('sends field updates via WebSocket', async () => {
    const { result } = renderHook(() =>
      useCollaborativeDraft({
        draftId: 'draft-123',
        currentUserId: 'user-1',
        currentUserName: 'Alice',
        initialFields: { title: 'Cozy Apartment' },
      }),
    )

    await waitFor(() => {
      expect(useCollaborativeDraftStore.getState().draftId).toBe('draft-123')
    })

    act(() => {
      result.current.updateField('title', 'Luxury Villa')
    })

    expect(mockSend).toHaveBeenCalledWith({
      type: 'draft.field.change',
      draftId: 'draft-123',
      field: 'title',
      value: 'Luxury Villa',
      version: 1,
    })
  })

  it('handles remote field changes from other users', async () => {
    const { rerender } = renderHook(() =>
      useCollaborativeDraft({
        draftId: 'draft-123',
        currentUserId: 'user-1',
        currentUserName: 'Alice',
        initialFields: { title: 'Initial Title' },
      }),
    )

    await waitFor(() => {
      expect(useCollaborativeDraftStore.getState().draftId).toBe('draft-123')
    })

    mockLastMessage = {
      type: 'draft.field.change',
      draftId: 'draft-123',
      field: 'title',
      value: 'Updated by Bob',
      version: 2,
      userId: 'user-2',
    }

    rerender()

    await waitFor(() => {
      expect(useCollaborativeDraftStore.getState().fields.title?.value).toBe('Updated by Bob')
    })
  })
})
