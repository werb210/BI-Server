import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "./env";
import { badRequest } from "../utils/apiResponse";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;

  if (!auth) {
    return badRequest(res, "Unauthorized");
  }

  const token = auth.replace("Bearer ", "");

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);

    req.user = decoded;

    next();
  } catch {
    return badRequest(res, "Invalid token");
  }
}
