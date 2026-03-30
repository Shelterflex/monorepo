'use client'

import React, { Component, type ReactNode } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { reportClientError } from '@/lib/error-reporting'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  level?: 'page' | 'section'
  onRetry?: () => void
}

interface State {
  hasError: boolean
  error: Error | null
  eventId: string | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, eventId: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, eventId: null }
  }

  async componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('ErrorBoundary caught an error:', error, errorInfo)
    }

    const eventId = await reportClientError({
      error,
      componentStack: errorInfo.componentStack,
      level: this.props.level ?? 'page',
    })

    if (eventId) {
      this.setState({ eventId })
    }
  }

  handleReset = () => {
    this.props.onRetry?.()
    this.setState({ hasError: false, error: null, eventId: null })
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    if (this.props.fallback) {
      return this.props.fallback
    }

    const isSection = this.props.level === 'section'

    return (
      <div
        className={`flex items-center justify-center p-4 ${
          isSection ? 'min-h-[16rem]' : 'min-h-screen'
        }`}
      >
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <CardTitle>Something went wrong</CardTitle>
            </div>
            <CardDescription>
              {isSection
                ? 'This section failed to load. You can retry without leaving the page.'
                : 'An unexpected error occurred. Please try again.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {process.env.NODE_ENV !== 'production' && this.state.error ? (
              <div className="rounded-md bg-muted p-3">
                <p className="text-sm font-mono text-muted-foreground">
                  {this.state.error.message}
                </p>
              </div>
            ) : null}
            {this.state.eventId ? (
              <p className="text-xs text-muted-foreground">
                Reference: <span className="font-mono">{this.state.eventId}</span>
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button onClick={this.handleReset} variant="default">
                <RefreshCw className="mr-2 h-4 w-4" />
                Try again
              </Button>
              {!isSection ? (
                <Button onClick={() => window.location.reload()} variant="outline">
                  Reload page
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }
}
