import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VirtualizedPropertyList } from '../virtualized-property-list'
import type { PropertyListing } from '@/lib/propertiesApi'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/properties',
  useSearchParams: () => new URLSearchParams(),
}))

function makeProperties(count: number): PropertyListing[] {
  return Array.from({ length: count }, (_, i) => ({
    listingId: `listing-${i}`,
    whistleblowerId: 'wb-1',
    address: `Street ${i}`,
    city: 'Lagos',
    bedrooms: 2,
    bathrooms: 1,
    annualRentNgn: 100000 + i,
  }) as PropertyListing)
}

describe('VirtualizedPropertyList', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows a loading message while listings load', () => {
    render(<VirtualizedPropertyList properties={[]} isLoading />)

    expect(screen.getByText('Loading properties...')).toBeInTheDocument()
    expect(screen.queryByText('No properties found')).not.toBeInTheDocument()
  })

  it('shows an empty message when there are no listings', () => {
    render(<VirtualizedPropertyList properties={[]} />)

    expect(screen.getByText('No properties found')).toBeInTheDocument()
  })

  it('renders a labelled list with one item per visible listing', () => {
    render(<VirtualizedPropertyList properties={makeProperties(3)} />)

    expect(screen.getByRole('list', { name: 'Property listings' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('renders only a window of a large list instead of every item', () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)

    render(<VirtualizedPropertyList properties={makeProperties(1000)} />)

    const rendered = screen.getAllByRole('listitem')
    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered.length).toBeLessThan(20)
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Street 0')
    expect(screen.getByRole('list', { name: 'Property listings' })).not.toHaveTextContent('Street 999')
  })
})
