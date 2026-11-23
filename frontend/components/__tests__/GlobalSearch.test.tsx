import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GlobalSearch } from '../GlobalSearch'
import { globalSearch, type GroupedResults } from '@/lib/globalSearchApi'

const push = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

vi.mock('@/store/useAuthStore', () => ({
  default: () => ({ isAuthenticated: false }),
}))

vi.mock('@/lib/globalSearchApi', () => ({
  globalSearch: vi.fn(),
}))

const populated: GroupedResults[] = [
  {
    label: 'Properties',
    results: [
      { id: '1', type: 'property', title: 'Lekki Flat', subtitle: 'Lagos', href: '/properties/1' },
      { id: '2', type: 'property', title: 'Yaba Studio', subtitle: 'Lagos', href: '/properties/2' },
    ],
  },
]

function renderOpen(onOpenChange = vi.fn()) {
  render(<GlobalSearch open onOpenChange={onOpenChange} />)
  return onOpenChange
}

beforeEach(() => {
  vi.clearAllMocks()
  // cmdk scrolls the active item into view; jsdom does not implement it.
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

describe('GlobalSearch', () => {
  it('shows the idle prompt and does not search before a query is typed', () => {
    renderOpen()

    expect(screen.getByText('Type to search across everything')).toBeInTheDocument()
    expect(globalSearch).not.toHaveBeenCalled()
  })

  it('debounces typing into a single search with the final query', async () => {
    const user = userEvent.setup()
    vi.mocked(globalSearch).mockResolvedValue([])
    renderOpen()

    await user.type(screen.getByLabelText('Search'), 'lekki')

    await waitFor(() => expect(globalSearch).toHaveBeenCalledTimes(1))
    expect(globalSearch).toHaveBeenCalledWith('lekki', false)
  })

  it('shows a loading indicator while results are pending', async () => {
    const user = userEvent.setup()
    vi.mocked(globalSearch).mockReturnValue(new Promise(() => {}))
    renderOpen()

    await user.type(screen.getByLabelText('Search'), 'lek')

    expect(await screen.findByRole('status', { name: 'Loading search results' })).toBeInTheDocument()
    expect(screen.getByText('Searching...')).toBeInTheDocument()
  })

  it('shows an alert with the error message when the search fails', async () => {
    const user = userEvent.setup()
    vi.mocked(globalSearch).mockRejectedValue(new Error('Network down'))
    renderOpen()

    await user.type(screen.getByLabelText('Search'), 'lek')

    expect(await screen.findByRole('alert')).toHaveTextContent('Search failed')
    expect(screen.getByText('Network down')).toBeInTheDocument()
  })

  it('shows the no-results message when the search returns nothing', async () => {
    const user = userEvent.setup()
    vi.mocked(globalSearch).mockResolvedValue([])
    renderOpen()

    await user.type(screen.getByLabelText('Search'), 'zzz')

    expect(await screen.findByText('No results found')).toBeInTheDocument()
    expect(screen.getByText('Try adjusting your search terms')).toBeInTheDocument()
  })

  it('lists grouped results as options', async () => {
    const user = userEvent.setup()
    vi.mocked(globalSearch).mockResolvedValue(populated)
    renderOpen()

    await user.type(screen.getByLabelText('Search'), 'lag')

    expect(await screen.findByRole('option', { name: /Lekki Flat/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Yaba Studio/ })).toBeInTheDocument()
  })

  it('navigates with the keyboard and opens the chosen result', async () => {
    const user = userEvent.setup()
    vi.mocked(globalSearch).mockResolvedValue(populated)
    const onOpenChange = renderOpen()

    const input = screen.getByLabelText('Search')
    await user.type(input, 'lag')
    await screen.findByRole('option', { name: /Lekki Flat/ })

    await user.keyboard('{ArrowDown}{Enter}')

    expect(push).toHaveBeenCalledWith('/properties/2')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
