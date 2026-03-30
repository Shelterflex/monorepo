type ErrorReportLevel = 'page' | 'section'

interface ErrorReportPayload {
  error: Error
  componentStack?: string
  level: ErrorReportLevel
}

function buildEventId() {
  return `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function sanitizeMessage(message: string) {
  return message.slice(0, 300)
}

export async function reportClientError({
  error,
  componentStack,
  level,
}: ErrorReportPayload): Promise<string | null> {
  const eventId = buildEventId()
  const payload = {
    eventId,
    level,
    message: sanitizeMessage(error.message),
    name: error.name,
    componentStack:
      process.env.NODE_ENV === 'production' ? undefined : componentStack?.slice(0, 1500),
    pathname: typeof window !== 'undefined' ? window.location.pathname : undefined,
    timestamp: new Date().toISOString(),
  }

  if (process.env.NODE_ENV !== 'production') {
    console.error('Client error report:', payload)
    return eventId
  }

  const endpoint = process.env.NEXT_PUBLIC_ERROR_REPORTING_URL
  if (!endpoint) {
    return eventId
  }

  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      keepalive: true,
    })
  } catch {
    return eventId
  }

  return eventId
}
