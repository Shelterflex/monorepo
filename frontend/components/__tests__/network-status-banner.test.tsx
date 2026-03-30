import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NetworkStatusBanner } from '@/components/network-status-banner'
import { enqueueOfflineRequest } from '@/lib/offline-queue'

describe('NetworkStatusBanner', () => {
  it('shows queued action count when offline updates occur', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    })

    render(<NetworkStatusBanner />)

    enqueueOfflineRequest({
      path: '/api/forms',
      method: 'POST',
      body: '{"name":"Ada"}',
      headers: { 'Content-Type': 'application/json' },
    })

    fireEvent(window, new Event('offline-queue-updated'))

    await waitFor(() => {
      expect(screen.getByText(/queued action/i)).toBeInTheDocument()
    })
  })

  it('shows back online message after reconnecting', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    })

    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )

    render(<NetworkStatusBanner />)
    fireEvent(window, new Event('online'))

    await waitFor(() => {
      expect(screen.getByText(/back online/i)).toBeInTheDocument()
    })
  })
})
