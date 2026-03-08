import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { usePolling, type PollingConfig } from './use-polling'

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('should start polling when enabled', async () => {
    const mockPollFn = vi.fn().mockResolvedValue({
      data: { value: 'test' },
      status: 'pending',
    })

    const { result } = renderHook(() =>
      usePolling(mockPollFn, { enabled: true })
    )

    await waitFor(() => {
      expect(result.current.isPolling).toBe(true)
    })

    expect(mockPollFn).toHaveBeenCalled()
  })

  it('should not start polling when disabled', async () => {
    const mockPollFn = vi.fn().mockResolvedValue({
      data: { value: 'test' },
      status: 'pending',
    })

    const { result } = renderHook(() =>
      usePolling(mockPollFn, { enabled: false })
    )

    await vi.advanceTimersByTimeAsync(5000)

    expect(result.current.isPolling).toBe(false)
    expect(mockPollFn).not.toHaveBeenCalled()
  })

  it('should update data on successful poll', async () => {
    const mockData = { value: 'success' }
    const mockPollFn = vi.fn().mockResolvedValue({
      data: mockData,
      status: 'pending',
    })

    const { result } = renderHook(() =>
      usePolling(mockPollFn, { enabled: true })
    )

    await waitFor(() => {
      expect(result.current.data).toEqual(mockData)
    })

    expect(result.current.error).toBeNull()
  })

  it('should stop polling on terminal status', async () => {
    const mockPollFn = vi.fn().mockResolvedValue({
      data: { value: 'completed' },
      status: 'confirmed',
    })

    const { result } = renderHook(() =>
      usePolling(mockPollFn, {
        enabled: true,
        stopOnStatuses: ['confirmed'],
      })
    )

    await waitFor(() => {
      expect(result.current.isPolling).toBe(false)
    })

    expect(mockPollFn).toHaveBeenCalledTimes(1)
  })

  it('should continue polling on non-terminal status', async () => {
    let callCount = 0
    const mockPollFn = vi.fn().mockImplementation(async () => {
      callCount++
      return {
        data: { value: `call-${callCount}` },
        status: 'pending',
      }
    })

    const { result } = renderHook(() =>
      usePolling(mockPollFn, {
        enabled: true,
        initialInterval: 1000,
      })
    )

    await waitFor(() => {
      expect(mockPollFn).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    await waitFor(() => {
      expect(mockPollFn).toHaveBeenCalledTimes(2)
    })

    expect(result.current.isPolling).toBe(true)
  })

  it('should handle errors and retry with exponential backoff', async () => {
    const mockPollFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue({
        data: { value: 'success' },
        status: 'pending',
      })

    const { result } = renderHook(() =>
      usePolling(mockPollFn, {
        enabled: true,
        initialInterval: 1000,
        backoffMultiplier: 2,
        maxRetries: 5,
      })
    )

    // First call fails
    await waitFor(() => {
      expect(result.current.error).toBeTruthy()
      expect(result.current.retryCount).toBe(1)
    })

    // Wait for first retry (2000ms backoff)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    // Second call fails
    await waitFor(() => {
      expect(result.current.retryCount).toBe(2)
    })

    // Wait for second retry (4000ms backoff)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })

    // Third call succeeds
    await waitFor(() => {
      expect(result.current.data).toEqual({ value: 'success' })
      expect(result.current.error).toBeNull()
      expect(result.current.retryCount).toBe(0)
    })
  })

  it('should stop polling after max retries', async () => {
    const mockPollFn = vi.fn().mockRejectedValue(new Error('Persistent error'))

    const { result } = renderHook(() =>
      usePolling(mockPollFn, {
        enabled: true,
        initialInterval: 1000,
        backoffMultiplier: 2,
        maxRetries: 3,
      })
    )

    // First call fails
    await waitFor(() => {
      expect(result.current.retryCount).toBe(1)
    })

    // Retry 1 (2000ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    await waitFor(() => {
      expect(result.current.retryCount).toBe(2)
    })

    // Retry 2 (4000ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })

    await waitFor(() => {
      expect(result.current.retryCount).toBe(3)
      expect(result.current.isPolling).toBe(false)
    })

    expect(mockPollFn).toHaveBeenCalledTimes(3)
  })

  it('should cap interval at maxInterval', async () => {
    const mockPollFn = vi.fn().mockRejectedValue(new Error('Error'))

    const { result } = renderHook(() =>
      usePolling(mockPollFn, {
        enabled: true,
        initialInterval: 1000,
        maxInterval: 3000,
        backoffMultiplier: 2,
        maxRetries: 5,
      })
    )

    // First failure
    await waitFor(() => {
      expect(result.current.retryCount).toBe(1)
    })

    // Retry 1: interval should be 2000ms
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    await waitFor(() => {
      expect(result.current.retryCount).toBe(2)
    })

    // Retry 2: interval should be capped at 3000ms (not 4000ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })

    await waitFor(() => {
      expect(result.current.retryCount).toBe(3)
      expect(result.current.currentInterval).toBe(3000)
    })
  })

  it('should reset interval after successful poll', async () => {
    const mockPollFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Error'))
      .mockResolvedValue({
        data: { value: 'success' },
        status: 'pending',
      })

    const { result } = renderHook(() =>
      usePolling(mockPollFn, {
        enabled: true,
        initialInterval: 1000,
        backoffMultiplier: 2,
      })
    )

    // First call fails, interval increases to 2000ms
    await waitFor(() => {
      expect(result.current.retryCount).toBe(1)
      expect(result.current.currentInterval).toBe(2000)
    })

    // Retry succeeds
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    await waitFor(() => {
      expect(result.current.data).toEqual({ value: 'success' })
      expect(result.current.currentInterval).toBe(1000) // Reset to initial
      expect(result.current.retryCount).toBe(0)
    })
  })

  it('should allow manual stop', async () => {
    const mockPollFn = vi.fn().mockResolvedValue({
      data: { value: 'test' },
      status: 'pending',
    })

    const { result } = renderHook(() =>
      usePolling(mockPollFn, { enabled: true })
    )

    await waitFor(() => {
      expect(result.current.isPolling).toBe(true)
    })

    act(() => {
      result.current.stop()
    })

    expect(result.current.isPolling).toBe(false)

    // Advance time to ensure no more polls happen
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })

    // Should only have been called once (initial poll)
    expect(mockPollFn).toHaveBeenCalledTimes(1)
  })

  it('should allow manual restart', async () => {
    const mockPollFn = vi.fn().mockResolvedValue({
      data: { value: 'test' },
      status: 'pending',
    })

    const { result } = renderHook(() =>
      usePolling(mockPollFn, { enabled: true })
    )

    await waitFor(() => {
      expect(result.current.isPolling).toBe(true)
    })

    act(() => {
      result.current.stop()
    })

    expect(result.current.isPolling).toBe(false)

    act(() => {
      result.current.restart()
    })

    await waitFor(() => {
      expect(result.current.isPolling).toBe(true)
    })

    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.retryCount).toBe(0)
  })

  it('should allow manual poll trigger', async () => {
    const mockPollFn = vi.fn().mockResolvedValue({
      data: { value: 'manual' },
      status: 'pending',
    })

    const { result } = renderHook(() =>
      usePolling(mockPollFn, { enabled: false })
    )

    expect(result.current.isPolling).toBe(false)

    await act(async () => {
      await result.current.poll()
    })

    await waitFor(() => {
      expect(result.current.data).toEqual({ value: 'manual' })
    })

    expect(mockPollFn).toHaveBeenCalledTimes(1)
  })

  it('should cleanup on unmount', async () => {
    const mockPollFn = vi.fn().mockResolvedValue({
      data: { value: 'test' },
      status: 'pending',
    })

    const { unmount } = renderHook(() =>
      usePolling(mockPollFn, { enabled: true })
    )

    await waitFor(() => {
      expect(mockPollFn).toHaveBeenCalled()
    })

    const callCountBeforeUnmount = mockPollFn.mock.calls.length

    unmount()

    // Advance time to ensure no more polls happen after unmount
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })

    expect(mockPollFn).toHaveBeenCalledTimes(callCountBeforeUnmount)
  })

  it('should use default config values', async () => {
    const mockPollFn = vi.fn().mockResolvedValue({
      data: { value: 'test' },
      status: 'pending',
    })

    const { result } = renderHook(() => usePolling(mockPollFn))

    await waitFor(() => {
      expect(result.current.isPolling).toBe(true)
    })

    expect(result.current.currentInterval).toBe(2000) // Default initial interval
  })

  it('should handle multiple status transitions correctly', async () => {
    let callCount = 0
    const statuses = ['deposit_pending', 'conversion_pending', 'staking_queued', 'confirmed']
    
    const mockPollFn = vi.fn().mockImplementation(async () => {
      const status = statuses[Math.min(callCount, statuses.length - 1)]
      callCount++
      return {
        data: { value: `status-${status}` },
        status,
      }
    })

    const { result } = renderHook(() =>
      usePolling(mockPollFn, {
        enabled: true,
        initialInterval: 1000,
        stopOnStatuses: ['confirmed'],
      })
    )

    // First poll: deposit_pending
    await waitFor(() => {
      expect(result.current.data).toEqual({ value: 'status-deposit_pending' })
    })

    // Second poll: conversion_pending
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    await waitFor(() => {
      expect(result.current.data).toEqual({ value: 'status-conversion_pending' })
    })

    // Third poll: staking_queued
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    await waitFor(() => {
      expect(result.current.data).toEqual({ value: 'status-staking_queued' })
    })

    // Fourth poll: confirmed (should stop)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    await waitFor(() => {
      expect(result.current.data).toEqual({ value: 'status-confirmed' })
      expect(result.current.isPolling).toBe(false)
    })

    expect(mockPollFn).toHaveBeenCalledTimes(4)
  })

  it('should validate Requirements 3.1: begin polling at regular intervals', async () => {
    const mockPollFn = vi.fn().mockResolvedValue({
      data: { value: 'test' },
      status: 'deposit_pending',
    })

    const { result } = renderHook(() =>
      usePolling(mockPollFn, {
        enabled: true,
        initialInterval: 2000,
      })
    )

    // Initial poll
    await waitFor(() => {
      expect(mockPollFn).toHaveBeenCalledTimes(1)
    })

    // Poll at 2-second intervals
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    await waitFor(() => {
      expect(mockPollFn).toHaveBeenCalledTimes(2)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    await waitFor(() => {
      expect(mockPollFn).toHaveBeenCalledTimes(3)
    })

    expect(result.current.isPolling).toBe(true)
  })

  it('should validate Requirements 3.4: retry with exponential backoff up to 5 attempts', async () => {
    const mockPollFn = vi.fn().mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() =>
      usePolling(mockPollFn, {
        enabled: true,
        initialInterval: 1000,
        backoffMultiplier: 2,
        maxRetries: 5,
      })
    )

    // Attempt 1 (initial)
    await waitFor(() => {
      expect(result.current.retryCount).toBe(1)
    })

    // Attempt 2 (after 2000ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    await waitFor(() => {
      expect(result.current.retryCount).toBe(2)
    })

    // Attempt 3 (after 4000ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    await waitFor(() => {
      expect(result.current.retryCount).toBe(3)
    })

    // Attempt 4 (after 8000ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000)
    })
    await waitFor(() => {
      expect(result.current.retryCount).toBe(4)
    })

    // Attempt 5 (after 10000ms - capped at maxInterval)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })
    await waitFor(() => {
      expect(result.current.retryCount).toBe(5)
      expect(result.current.isPolling).toBe(false)
    })

    expect(mockPollFn).toHaveBeenCalledTimes(5)
  })

  it('should validate Requirements 5.2: stop polling on confirmed status', async () => {
    const mockPollFn = vi.fn().mockResolvedValue({
      data: { value: 'completed' },
      status: 'confirmed',
    })

    const { result } = renderHook(() =>
      usePolling(mockPollFn, {
        enabled: true,
        stopOnStatuses: ['confirmed', 'conversion_failed', 'staking_failed'],
      })
    )

    await waitFor(() => {
      expect(result.current.isPolling).toBe(false)
      expect(result.current.data).toEqual({ value: 'completed' })
    })

    // Ensure no more polls happen
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000)
    })

    expect(mockPollFn).toHaveBeenCalledTimes(1)
  })
})
