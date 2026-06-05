import jwt from "jsonwebtoken";
import type { UserRole } from "@workspace/db";

const JWT_SECRET = process.env["JWT_SECRET"] ?? "dev-secret-please-change-in-production";
const JWT_EXPIRE = process.env["JWT_EXPIRE"] ?? "24h";

export interface JwtPayload {
  userId: number;
  username: string;
  email: string;
  role: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRE } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}
