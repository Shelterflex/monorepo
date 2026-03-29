import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { logger } from "../utils/logger.js";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId =
    req.requestId ||
    (req.headers["x-request-id"] as string | undefined) ||
    randomUUID();
  req.requestId = requestId;

  res.setHeader("x-request-id", requestId);

  const startedAt = Date.now();

  logger.debug("Incoming request", {
    requestId,
    method: req.method,
    path: req.path,
  });

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const level =
      res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";

    logger[level]("Request completed", {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs,
    });
  });

  next();
}
