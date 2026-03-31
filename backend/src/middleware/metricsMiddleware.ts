/**
 * Metrics Middleware
 * 
 * Automatically tracks HTTP request metrics for all routes
 */

import { Request, Response, NextFunction } from 'express';
import { recordHttpRequest, httpRequestsInFlight } from '../utils/metrics.js';

/**
 * Middleware to track HTTP request metrics
 */
export function metricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();
  const route = req.route?.path || req.path;
  const method = req.method;

  // Track in-flight requests
  httpRequestsInFlight.add(1, { method, route });

  // Record metrics when response finishes
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const statusCode = res.statusCode;

    recordHttpRequest(method, route, statusCode, durationMs);
    httpRequestsInFlight.add(-1, { method, route });
  });

  // Handle aborted requests
  res.on('close', () => {
    if (!res.writableEnded) {
      httpRequestsInFlight.add(-1, { method, route });
    }
  });

  next();
}
