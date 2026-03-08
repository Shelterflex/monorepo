'use client'

import { toast as showToast } from '@/hooks/use-toast'
import { parseBackendError, getUserFriendlyError, isNetworkError } from './errors'

/**
 * Shows a success toast notification
 */
export function showSuccessToast(
  message: string,
  title?: string
): void {
  showToast({
    title: title || 'Success',
    description: message,
    variant: 'default',
  })
}

/**
 * Shows an error toast notification from a backend error
 */
export function showErrorToast(
  error: unknown,
  defaultMessage: string = 'Something went wrong. Please try again'
): void {
  const parsed = parseBackendError(error, defaultMessage)
  const userMessage = getUserFriendlyError(error, defaultMessage)

  showToast({
    title: 'Error',
    description: userMessage,
    variant: 'destructive',
  })
}

/**
 * Shows a network error toast with specific messaging
 */
export function showNetworkErrorToast(): void {
  showToast({
    title: 'Connection Error',
    description:
      'Cannot connect to the server. Please check your internet connection and try again.',
    variant: 'destructive',
  })
}

/**
 * Handles an error by showing appropriate toast
 * Automatically detects network errors and shows specific messaging
 */
export function handleError(
  error: unknown,
  defaultMessage?: string
): void {
  if (isNetworkError(error)) {
    showNetworkErrorToast()
  } else {
    showErrorToast(error, defaultMessage)
  }
}
