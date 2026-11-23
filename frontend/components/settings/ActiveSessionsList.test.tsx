import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActiveSessionsList } from './ActiveSessionsList'
import { fetchSessions, revokeSession, revokeOtherSessions, type SessionItem } from '@/lib/api/sessions'

vi.mock('@/lib/api/sessions', () => ({
  fetchSessions: vi.fn(),
  revokeSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
}))

const current: SessionItem = {
  id: 's1',
  device: 'Chrome on Mac',
  location: 'Lagos',
  lastActive: '2026-01-01T10:00:00Z',
  isCurrent: true,
}
const other: SessionItem = {
  id: 's2',
  device: 'Safari on iPhone',
  lastActive: '2026-01-02T10:00:00Z',
  isCurrent: false,
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ActiveSessionsList', () => {
  it('shows a loading state while sessions are fetched', () => {
    vi.mocked(fetchSessions).mockReturnValue(new Promise(() => {}))

    render(<ActiveSessionsList />)

    expect(screen.getByText('Loading active sessions...')).toHaveAttribute('aria-busy', 'true')
  })

  it('shows an alert when sessions fail to load', async () => {
    vi.mocked(fetchSessions).mockRejectedValue(new Error('Server error'))

    render(<ActiveSessionsList />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Error: Server error')
  })

  it('shows an empty state when there are no sessions', async () => {
    vi.mocked(fetchSessions).mockResolvedValue([])

    render(<ActiveSessionsList />)

    expect(await screen.findByText('No active sessions found.')).toBeInTheDocument()
  })

  it('lists each session and marks the current device', async () => {
    vi.mocked(fetchSessions).mockResolvedValue([current, other])

    render(<ActiveSessionsList />)

    expect(await screen.findByText('Chrome on Mac')).toBeInTheDocument()
    expect(screen.getByText('This Device')).toBeInTheDocument()
    expect(screen.getByText('Safari on iPhone')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log Out' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument()
  })

  it('does not revoke when the confirmation is declined', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchSessions).mockResolvedValue([current, other])
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<ActiveSessionsList />)
    await user.click(await screen.findByRole('button', { name: 'Revoke' }))

    expect(window.confirm).toHaveBeenCalledWith('Are you sure you want to revoke this session?')
    expect(revokeSession).not.toHaveBeenCalled()
  })

  it('revokes a session once confirmed and reloads the list', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchSessions).mockResolvedValueOnce([current, other]).mockResolvedValueOnce([current])
    vi.mocked(revokeSession).mockResolvedValue()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<ActiveSessionsList />)
    await user.click(await screen.findByRole('button', { name: 'Revoke' }))

    await waitFor(() => expect(revokeSession).toHaveBeenCalledWith('s2'))
    await waitFor(() => expect(screen.queryByText('Safari on iPhone')).not.toBeInTheDocument())
  })

  it('warns before logging out the current session and redirects to login', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchSessions).mockResolvedValue([current, other])
    vi.mocked(revokeSession).mockResolvedValue()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const location = { href: '' } as Location
    vi.stubGlobal('location', location)

    render(<ActiveSessionsList />)
    const row = (await screen.findByText('Chrome on Mac')).closest('div.py-4') as HTMLElement
    await user.click(within(row).getByRole('button', { name: 'Log Out' }))

    expect(window.confirm).toHaveBeenCalledWith(
      'Revoking your current session will log you out immediately. Continue?',
    )
    await waitFor(() => expect(revokeSession).toHaveBeenCalledWith('s1'))
    await waitFor(() => expect(location.href).toBe('/login'))
    vi.unstubAllGlobals()
  })

  it('shows an alert when revoking fails', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchSessions).mockResolvedValue([current, other])
    vi.mocked(revokeSession).mockRejectedValue(new Error('boom'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})

    render(<ActiveSessionsList />)
    await user.click(await screen.findByRole('button', { name: 'Revoke' }))

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith('Failed to revoke session: boom'),
    )
  })

  it('logs out all other sessions only when there is more than one', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchSessions).mockResolvedValue([current, other])
    vi.mocked(revokeOtherSessions).mockResolvedValue()
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<ActiveSessionsList />)
    await user.click(await screen.findByRole('button', { name: 'Log Out All Other Sessions' }))

    expect(revokeOtherSessions).toHaveBeenCalledTimes(1)
  })

  it('hides the log-out-all button when only the current session exists', async () => {
    vi.mocked(fetchSessions).mockResolvedValue([current])

    render(<ActiveSessionsList />)

    await screen.findByText('Chrome on Mac')
    expect(screen.queryByRole('button', { name: 'Log Out All Other Sessions' })).not.toBeInTheDocument()
  })
})
