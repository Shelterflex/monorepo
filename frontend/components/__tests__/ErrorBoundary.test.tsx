import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '@/components/ErrorBoundary'

function Thrower() {
  throw new Error('Boom')
}

describe('ErrorBoundary', () => {
  it('renders fallback UI when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <ErrorBoundary>
        <Thrower />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('calls retry handler when retry is clicked', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onRetry = vi.fn()

    render(
      <ErrorBoundary onRetry={onRetry} level="section">
        <Thrower />
      </ErrorBoundary>,
    )

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
