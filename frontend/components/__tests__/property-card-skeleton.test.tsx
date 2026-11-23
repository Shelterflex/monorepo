import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PropertyCardSkeleton } from '../property-card-skeleton'

describe('PropertyCardSkeleton', () => {
  it('is hidden from assistive technology in the grid variant', () => {
    const { container } = render(<PropertyCardSkeleton />)

    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('is hidden from assistive technology in the horizontal variant', () => {
    const { container } = render(<PropertyCardSkeleton variant="horizontal" />)

    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('exposes no accessible content, so screen readers skip the placeholder', () => {
    render(<PropertyCardSkeleton />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.queryByText(/./)).not.toBeInTheDocument()
  })

  it('merges a custom class name and keeps the pulse animation', () => {
    const { container } = render(<PropertyCardSkeleton className="w-80" />)

    expect(container.firstChild).toHaveClass('w-80', 'animate-pulse')
  })
})
