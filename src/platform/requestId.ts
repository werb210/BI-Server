import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";

export function requestId(req: Request, res: Response, next: NextFunction) {
  const id = (req.headers["x-request-id"] as string | undefined) || randomUUID();

  req.id = id;
  res.setHeader("X-Request-Id", id);

  next();
}
