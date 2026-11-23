import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStakingPosition, type StakingPositionReponse } from '@/lib/config'
import { useStakingPosition } from '../useStakingPosition'

vi.mock('@/lib/config', () => ({
  getStakingPosition: vi.fn(),
}))

const mockGetStakingPosition = vi.mocked(getStakingPosition)

function position(staked: string): StakingPositionReponse {
  return {
    success: true,
    position: {
      staked,
      claimable: '1.25',
      warming: '0',
      cooling: '0',
      lockExpiry: '2026-12-31T00:00:00Z',
    },
  }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('useStakingPosition', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays idle without a wallet and enters loading when a wallet is provided', () => {
    mockGetStakingPosition.mockReturnValue(new Promise(() => {}))

    const { result, rerender, unmount } = renderHook(
      ({ walletAddress }: { walletAddress: string | null }) =>
        useStakingPosition({ walletAddress }),
      { initialProps: { walletAddress: null as string | null } },
    )

    expect(result.current.position).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(mockGetStakingPosition).not.toHaveBeenCalled()

    act(() => {
      rerender({ walletAddress: 'GOLD-1' })
    })
    expect(result.current.loading).toBe(true)
    expect(mockGetStakingPosition).toHaveBeenCalledWith('GOLD-1')

    unmount()
  })

  it('reports loading while the initial request is pending', () => {
    mockGetStakingPosition.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() =>
      useStakingPosition({ walletAddress: 'GOLD-1' }),
    )

    expect(result.current.loading).toBe(true)
    expect(result.current.position).toBeNull()
    expect(result.current.error).toBeNull()
    expect(mockGetStakingPosition).toHaveBeenCalledWith('GOLD-1')
  })

  it('loads a position and replaces it on refetch', async () => {
    mockGetStakingPosition
      .mockResolvedValueOnce(position('100'))
      .mockResolvedValueOnce(position('250'))

    const { result } = renderHook(() =>
      useStakingPosition({ walletAddress: 'GOLD-1' }),
    )
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.position?.position.staked).toBe('100')

    await act(async () => {
      await result.current.refetch()
    })

    expect(mockGetStakingPosition).toHaveBeenCalledTimes(2)
    expect(result.current.position?.position.staked).toBe('250')
  })

  it('sets an error and clears loading when the request fails', async () => {
    const error = new Error('network down')
    mockGetStakingPosition.mockRejectedValue(error)

    const { result } = renderHook(() =>
      useStakingPosition({ walletAddress: 'GOLD-1' }),
    )
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.error).toBe(error)
    expect(result.current.loading).toBe(false)
    expect(result.current.position).toBeNull()

    mockGetStakingPosition.mockRejectedValueOnce('string failure')
    await act(async () => {
      await result.current.refetch()
    })

    expect(result.current.error?.message).toBe('string failure')
    expect(result.current.loading).toBe(false)
  })

  it('polls at the configured interval and stops polling on unmount', async () => {
    mockGetStakingPosition.mockResolvedValue(position('100'))

    const { unmount } = renderHook(() =>
      useStakingPosition({ walletAddress: 'GOLD-1', pollInterval: 1000 }),
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockGetStakingPosition).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(mockGetStakingPosition).toHaveBeenCalledTimes(2)

    unmount()
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    expect(mockGetStakingPosition).toHaveBeenCalledTimes(2)
  })

  it('does not fetch or poll when enabled is false', async () => {
    const { result } = renderHook(() =>
      useStakingPosition({
        walletAddress: 'GOLD-1',
        pollInterval: 1000,
        enabled: false,
      }),
    )

    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    expect(result.current.position).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(mockGetStakingPosition).not.toHaveBeenCalled()
  })

  it('does not let a superseded response overwrite the latest position after unmount', async () => {
    const older = deferred<StakingPositionReponse>()
    const newer = deferred<StakingPositionReponse>()
    mockGetStakingPosition
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise)

    const { result, unmount } = renderHook(() =>
      useStakingPosition({ walletAddress: 'GOLD-1' }),
    )
    act(() => {
      void result.current.refetch()
    })

    await act(async () => {
      newer.resolve(position('newer'))
      await newer.promise
    })
    expect(result.current.position?.position.staked).toBe('newer')

    unmount()
    await act(async () => {
      older.resolve(position('older'))
      await older.promise
    })

    expect(result.current.position?.position.staked).toBe('newer')
  })
})
