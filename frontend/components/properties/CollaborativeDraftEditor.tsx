'use client'

/**
 * Collaborative property draft editor (#655).
 *
 * Renders an editable form for a property listing draft with:
 *   - Real-time presence avatars showing who is editing which field
 *   - Optimistic field updates sent over WebSocket
 *   - Conflict detection banners with local/remote resolution choices
 *   - Connection status indicator and reconnect resilience
 */

import React, { useId } from 'react'
import { useCollaborativeDraft } from '@/hooks/useCollaborativeDraft'
import type { FieldConflict, PresenceEntry } from '@/store/useCollaborativeDraftStore'

// ── Sub-components ────────────────────────────────────────────────────────────

function PresenceAvatar({ entry }: { entry: PresenceEntry }) {
  const initials = entry.userName
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <span
      title={`${entry.userName} is editing`}
      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-white text-xs font-bold ring-2 ring-white"
      style={{ backgroundColor: entry.color }}
    >
      {initials}
    </span>
  )
}

function ConflictBanner({
  conflict,
  onResolve,
}: {
  conflict: FieldConflict
  onResolve: (field: string, resolution: 'local' | 'remote') => void
}) {
  if (conflict.resolvedAt) return null
  return (
    <div className="mt-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="font-semibold text-amber-900 mb-2">
        ⚡ Conflicting edit on this field
      </p>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="rounded border border-amber-200 bg-white p-2">
          <p className="text-xs text-gray-500 mb-1">Your version</p>
          <p className="text-gray-800 text-sm">{conflict.localValue}</p>
        </div>
        <div className="rounded border border-amber-200 bg-white p-2">
          <p className="text-xs text-gray-500 mb-1">Their version ({conflict.remoteUserId})</p>
          <p className="text-gray-800 text-sm">{conflict.remoteValue}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onResolve(conflict.field, 'local')}
          className="flex-1 rounded px-3 py-1.5 bg-blue-600 text-white text-xs font-medium hover:bg-blue-700"
        >
          Keep mine
        </button>
        <button
          onClick={() => onResolve(conflict.field, 'remote')}
          className="flex-1 rounded px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-medium hover:bg-gray-50"
        >
          Use theirs
        </button>
      </div>
    </div>
  )
}

function FieldPresenceIndicator({
  fieldKey,
  presence,
}: {
  fieldKey: string
  presence: PresenceEntry[]
}) {
  const focused = presence.filter(p => p.focusedField === fieldKey)
  if (focused.length === 0) return null
  return (
    <div className="flex items-center gap-1 mt-1">
      <div className="flex -space-x-1">
        {focused.map(p => (
          <PresenceAvatar key={p.userId} entry={p} />
        ))}
      </div>
      <span className="text-xs text-gray-400">
        {focused.map(p => p.userName).join(', ')}{' '}
        {focused.length === 1 ? 'is' : 'are'} editing
      </span>
    </div>
  )
}

// ── Main editor ───────────────────────────────────────────────────────────────

interface CollaborativeDraftEditorProps {
  draftId: string
  currentUserId: string
  currentUserName: string
  initialFields?: Record<string, string>
  wsBaseUrl?: string
  onPublish?: () => void
}

const DEFAULT_FIELDS: Record<string, string> = {
  title: '',
  description: '',
  price: '',
  address: '',
  bedrooms: '',
  bathrooms: '',
}

export function CollaborativeDraftEditor({
  draftId,
  currentUserId,
  currentUserName,
  initialFields = DEFAULT_FIELDS,
  wsBaseUrl,
  onPublish,
}: CollaborativeDraftEditorProps) {
  const formId = useId()

  const {
    fields,
    presence,
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
  } = useCollaborativeDraft({
    draftId,
    currentUserId,
    currentUserName,
    initialFields,
    wsBaseUrl,
  })

  const unresolvedConflicts = conflicts.filter(c => !c.resolvedAt)
  const hasPending = pendingChanges.length > 0

  const FIELD_META: Record<string, { label: string; multiline?: boolean; type?: string }> = {
    title: { label: 'Listing title' },
    description: { label: 'Description', multiline: true },
    price: { label: 'Monthly rent (USD)', type: 'number' },
    address: { label: 'Address' },
    bedrooms: { label: 'Bedrooms', type: 'number' },
    bathrooms: { label: 'Bathrooms', type: 'number' },
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div>
          <h2 className="font-semibold text-gray-900">Draft Editor</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {lastSyncedAt
              ? `Last synced ${new Date(lastSyncedAt).toLocaleTimeString()}`
              : 'Not yet synced'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Presence avatars */}
          {presence.length > 0 && (
            <div className="flex items-center gap-1">
              <div className="flex -space-x-2">
                {presence.slice(0, 5).map(p => (
                  <PresenceAvatar key={p.userId} entry={p} />
                ))}
              </div>
              {presence.length > 5 && (
                <span className="text-xs text-gray-500">+{presence.length - 5}</span>
              )}
            </div>
          )}

          {/* Connection badge */}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              isConnected
                ? 'bg-green-100 text-green-700'
                : 'bg-red-100 text-red-700'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
              }`}
            />
            {isConnected ? 'Live' : 'Offline'}
          </span>
        </div>
      </div>

      {/* Conflict summary */}
      {unresolvedConflicts.length > 0 && (
        <div className="mx-6 mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
          ⚠️ {unresolvedConflicts.length} unresolved conflict{unresolvedConflicts.length > 1 ? 's' : ''} —
          resolve below before publishing.
        </div>
      )}

      {/* Form fields */}
      <form id={formId} className="px-6 py-5 space-y-5" onSubmit={e => e.preventDefault()}>
        {Object.entries(FIELD_META).map(([fieldKey, meta]) => {
          const field = fields[fieldKey]
          const conflict = conflicts.find(c => c.field === fieldKey && !c.resolvedAt)
          const isEdited = field?.lastEditedBy != null && field.lastEditedBy !== currentUserId

          return (
            <div key={fieldKey}>
              <label
                htmlFor={`${formId}-${fieldKey}`}
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {meta.label}
                {isEdited && (
                  <span className="ml-2 text-xs font-normal text-gray-400">
                    (edited by {field?.lastEditedBy})
                  </span>
                )}
              </label>

              <div className="relative">
                {meta.multiline ? (
                  <textarea
                    id={`${formId}-${fieldKey}`}
                    rows={4}
                    value={field?.value ?? ''}
                    onChange={e => updateField(fieldKey, e.target.value)}
                    onFocus={() => focusField(fieldKey)}
                    onBlur={() => blurField(fieldKey)}
                    className={`w-full rounded-xl border px-4 py-3 text-sm outline-none resize-none transition-colors focus:ring-2 focus:ring-blue-600 focus:border-transparent ${
                      conflict ? 'border-amber-400' : 'border-gray-200'
                    }`}
                  />
                ) : (
                  <input
                    id={`${formId}-${fieldKey}`}
                    type={meta.type ?? 'text'}
                    value={field?.value ?? ''}
                    onChange={e => updateField(fieldKey, e.target.value)}
                    onFocus={() => focusField(fieldKey)}
                    onBlur={() => blurField(fieldKey)}
                    className={`w-full rounded-xl border px-4 py-3 text-sm outline-none transition-colors focus:ring-2 focus:ring-blue-600 focus:border-transparent ${
                      conflict ? 'border-amber-400' : 'border-gray-200'
                    }`}
                  />
                )}
              </div>

              <FieldPresenceIndicator fieldKey={fieldKey} presence={presence} />

              {conflict && (
                <ConflictBanner conflict={conflict} onResolve={resolveConflict} />
              )}
            </div>
          )
        })}
      </form>

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
        <p className="text-xs text-gray-400">
          {hasPending
            ? `${pendingChanges.length} unsaved change${pendingChanges.length > 1 ? 's' : ''}`
            : isSaving
              ? 'Saving…'
              : 'All changes saved'}
        </p>
        <button
          type="button"
          disabled={unresolvedConflicts.length > 0 || !isConnected}
          onClick={() => {
            publishDraft()
            onPublish?.()
          }}
          className="rounded-xl px-5 py-2 bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Publish listing
        </button>
      </div>
    </div>
  )
}
