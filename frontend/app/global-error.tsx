'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { AlertCircle, RefreshCw } from 'lucide-react'

export default function GlobalError({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string }
  reset: () => void
}>) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-gray-50 p-4 font-sans text-gray-900">
        <div className="w-full max-w-md rounded-lg border-2 border-gray-900 bg-white p-6 shadow-[4px_4px_0px_0px_rgba(26,26,26,1)]">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-600">
            <AlertCircle className="h-8 w-8" />
          </div>
          <h1 className="mb-2 text-center text-2xl font-bold">Critical Application Error</h1>
          <p className="mb-6 text-center text-sm text-gray-600">
            A critical error occurred while loading the application shell. Please try reloading or recovering the session.
          </p>
          <div className="flex justify-center">
            <button
              onClick={() => reset()}
              className="inline-flex items-center justify-center rounded border-2 border-gray-900 bg-black px-5 py-2.5 text-sm font-semibold text-white shadow-[2px_2px_0px_0px_rgba(26,26,26,1)] hover:bg-gray-800"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Reload Application
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
