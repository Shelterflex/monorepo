/**
 * Collaborative property draft store (#655).
 *
 * State machine for multi-user draft editing with:
 *   - Optimistic local updates with version-token concurrency control
 *   - Live presence tracking (who is editing which field)
 *   - Conflict detection when two users edit the same field simultaneously
 *   - Pending-changes queue for reconnect resilience
 */

import { create } from 'zustand'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DraftField {
  key: string
  value: string
  lastEditedBy: string | null
  lastEditedAt: number | null
  version: number
}

export interface PresenceEntry {
  userId: string
  userName: string
  avatarUrl?: string
  focusedField: string | null
  lastSeenAt: number
  color: string
}

export interface FieldConflict {
  field: string
  localValue: string
  remoteValue: string
  localVersion: number
  remoteVersion: number
  remoteUserId: string
  resolvedAt: number | null
  resolution: 'local' | 'remote' | null
}

export interface PendingChange {
  field: string
  value: string
  localVersion: number
  enqueuedAt: number
}

export interface CollaborativeDraftState {
  draftId: string | null
  fields: Record<string, DraftField>
  presence: Record<string, PresenceEntry>
  conflicts: FieldConflict[]
  pendingChanges: PendingChange[]
  isConnected: boolean
  isSaving: boolean
  lastSyncedAt: number | null

  // Actions
  initDraft: (draftId: string, initialFields: Record<string, string>) => void
  setFieldValue: (field: string, value: string, userId: string) => void
  applyRemoteChange: (field: string, value: string, version: number, userId: string) => void
  updatePresence: (entry: PresenceEntry) => void
  removePresence: (userId: string) => void
  setFocus: (field: string | null, userId: string, userName: string) => void
  resolveConflict: (field: string, resolution: 'local' | 'remote') => void
  markSaved: () => void
  setConnected: (connected: boolean) => void
  flushPendingChanges: () => PendingChange[]
}

const PRESENCE_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16',
]

let colorIndex = 0
function nextColor() {
  return PRESENCE_COLORS[colorIndex++ % PRESENCE_COLORS.length]
}

export const useCollaborativeDraftStore = create<CollaborativeDraftState>()((set, get) => ({
  draftId: null,
  fields: {},
  presence: {},
  conflicts: [],
  pendingChanges: [],
  isConnected: false,
  isSaving: false,
  lastSyncedAt: null,

  initDraft: (draftId, initialFields) => {
    const fields: Record<string, DraftField> = {}
    for (const [key, value] of Object.entries(initialFields)) {
      fields[key] = { key, value, lastEditedBy: null, lastEditedAt: null, version: 0 }
    }
    set({ draftId, fields, presence: {}, conflicts: [], pendingChanges: [], lastSyncedAt: Date.now() })
  },

  setFieldValue: (field, value, userId) => {
    const state = get()
    const existing = state.fields[field]
    const nextVersion = (existing?.version ?? 0) + 1

    set(s => ({
      fields: {
        ...s.fields,
        [field]: {
          key: field,
          value,
          lastEditedBy: userId,
          lastEditedAt: Date.now(),
          version: nextVersion,
        },
      },
      pendingChanges: [
        ...s.pendingChanges.filter(c => c.field !== field),
        { field, value, localVersion: nextVersion, enqueuedAt: Date.now() },
      ],
    }))
  },

  applyRemoteChange: (field, value, remoteVersion, remoteUserId) => {
    const state = get()
    const local = state.fields[field]

    // Conflict: both sides changed since last sync
    if (local && local.lastEditedBy && local.version > 0 && local.version >= remoteVersion && local.lastEditedBy !== remoteUserId) {
      const alreadyConflicted = state.conflicts.some(c => c.field === field && !c.resolvedAt)
      if (!alreadyConflicted) {
        set(s => ({
          conflicts: [
            ...s.conflicts,
            {
              field,
              localValue: local.value,
              remoteValue: value,
              localVersion: local.version,
              remoteVersion,
              remoteUserId,
              resolvedAt: null,
              resolution: null,
            },
          ],
        }))
        return
      }
    }

    // No conflict — apply remote change directly
    set(s => ({
      fields: {
        ...s.fields,
        [field]: {
          key: field,
          value,
          lastEditedBy: remoteUserId,
          lastEditedAt: Date.now(),
          version: remoteVersion,
        },
      },
      // Remove any pending change for this field (remote wins)
      pendingChanges: s.pendingChanges.filter(c => c.field !== field),
    }))
  },

  updatePresence: (entry) => {
    set(s => ({
      presence: {
        ...s.presence,
        [entry.userId]: {
          ...entry,
          color: s.presence[entry.userId]?.color ?? nextColor(),
        },
      },
    }))
  },

  removePresence: (userId) => {
    set(s => {
      const p = { ...s.presence }
      delete p[userId]
      return { presence: p }
    })
  },

  setFocus: (field, userId, userName) => {
    set(s => ({
      presence: {
        ...s.presence,
        [userId]: {
          userId,
          userName,
          focusedField: field,
          lastSeenAt: Date.now(),
          color: s.presence[userId]?.color ?? nextColor(),
        },
      },
    }))
  },

  resolveConflict: (field, resolution) => {
    const state = get()
    const conflict = state.conflicts.find(c => c.field === field && !c.resolvedAt)
    if (!conflict) return

    const resolvedValue = resolution === 'local' ? conflict.localValue : conflict.remoteValue

    set(s => ({
      fields: {
        ...s.fields,
        [field]: {
          ...s.fields[field],
          value: resolvedValue,
          version: Math.max(conflict.localVersion, conflict.remoteVersion) + 1,
        },
      },
      conflicts: s.conflicts.map(c =>
        c.field === field && !c.resolvedAt
          ? { ...c, resolvedAt: Date.now(), resolution }
          : c,
      ),
    }))
  },

  markSaved: () => set({ isSaving: false, lastSyncedAt: Date.now(), pendingChanges: [] }),

  setConnected: (connected) => set({ isConnected: connected }),

  flushPendingChanges: () => {
    const changes = get().pendingChanges
    set({ pendingChanges: [] })
    return changes
  },
}))
