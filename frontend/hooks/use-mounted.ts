import { useSyncExternalStore } from 'react'

let mounted = false
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!mounted) {
    mounted = true
    for (const l of listeners) l()
  }

  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return mounted
}

export function useMounted() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
