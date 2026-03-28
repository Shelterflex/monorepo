import { Request, Response, NextFunction } from "express"
import { trace } from "@opentelemetry/api"

/**
 * Middleware to add the OpenTelemetry trace ID to the response headers.
 * This helps the frontend or clients correlate backend traces with their requests.
 */
export function traceResponseMiddleware(
    _req: Request,
    res: Response,
    next: NextFunction
) {
    const spanContext = trace.getActiveSpan()?.spanContext()

    if (spanContext) {
        res.setHeader("x-trace-id", spanContext.traceId)
    }

    next()
}
