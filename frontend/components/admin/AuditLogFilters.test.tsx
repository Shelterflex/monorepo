import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AuditLogFilters } from './AuditLogFilters'

describe('AuditLogFilters', () => {
  it('submits the actor id filter and clears active filters when requested', () => {
    const onFiltersChange = vi.fn()

    render(
      <AuditLogFilters
        filters={{ page: 1, limit: 20 }}
        onFiltersChange={onFiltersChange}
      />,
    )

    const actorInput = screen.getByRole('textbox', { name: /actor id/i })
    fireEvent.change(actorInput, { target: { value: 'actor-42' } })
    fireEvent.keyDown(actorInput, { key: 'Enter' })

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'actor-42', page: 1 }))

    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }))
    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20 }))
  })
})
