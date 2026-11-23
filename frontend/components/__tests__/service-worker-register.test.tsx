import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ServiceWorkerRegister } from '../service-worker-register'

vi.mock('@/lib/offline-queue', () => ({
  flushOfflineQueue: vi.fn(() => Promise.resolve()),
}))

function installServiceWorker() {
  const registration = {
    waiting: null,
    installing: null,
    update: vi.fn(() => Promise.resolve()),
    addEventListener: vi.fn(),
  }
  const serviceWorker = {
    register: vi.fn(() => Promise.resolve(registration)),
    getRegistration: vi.fn(() => Promise.resolve(registration)),
    controller: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  Object.defineProperty(navigator, 'serviceWorker', { value: serviceWorker, configurable: true })
  return { serviceWorker, registration }
}

describe('ServiceWorkerRegister', () => {
  afterEach(() => {
    cleanup()
    delete (navigator as { serviceWorker?: unknown }).serviceWorker
  })

  it('does nothing when the browser has no service worker support', () => {
    expect('serviceWorker' in navigator).toBe(false)

    expect(() => render(<ServiceWorkerRegister />)).not.toThrow()
  })

  it('registers /sw.js when service workers are supported', async () => {
    const { serviceWorker, registration } = installServiceWorker()

    render(<ServiceWorkerRegister />)

    await vi.waitFor(() => expect(serviceWorker.register).toHaveBeenCalledWith('/sw.js'))
    expect(registration.update).toHaveBeenCalled()
  })

  it('asks a waiting worker to activate immediately', async () => {
    const { serviceWorker, registration } = installServiceWorker()
    const postMessage = vi.fn()
    registration.waiting = { postMessage } as never

    render(<ServiceWorkerRegister />)

    await vi.waitFor(() => expect(serviceWorker.register).toHaveBeenCalled())
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' }),
    )
  })

  it('stays silent when registration fails in production', async () => {
    const { serviceWorker } = installServiceWorker()
    serviceWorker.register.mockRejectedValueOnce(new Error('denied'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('NODE_ENV', 'production')

    render(<ServiceWorkerRegister />)

    await vi.waitFor(() => expect(serviceWorker.register).toHaveBeenCalled())
    expect(consoleError).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
})
