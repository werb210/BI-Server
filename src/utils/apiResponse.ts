import { Response } from "express";

export function ok<T>(res: Response, data: T) {
  return res.status(200).json({
    status: "ok",
    data
  });
}

export function badRequest(res: Response, error: string) {
  return res.status(400).json({
    status: "error",
    error
  });
}
