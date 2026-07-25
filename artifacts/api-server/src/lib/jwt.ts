import jwt from "jsonwebtoken";

const DEV_PLACEHOLDER_SECRET = "dev-secret-please-change-in-production";
const JWT_EXPIRE = process.env["JWT_EXPIRE"] ?? "24h";

// Read lazily (not at module load) so importing this file never throws — the
// real requirement is enforced at server startup via assertJwtConfig(). No
// hardcoded fallback: an unset secret is a hard error, not a silent weak default
// that would let anyone forge admin tokens.
function getSecret(): string {
  const secret = process.env["JWT_SECRET"];
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required.");
  }
  return secret;
}

/** Fail-fast validation for server startup. In production the secret must be
 *  present, reasonably long, and not the dev placeholder — so a deploy can never
 *  silently run with a guessable signing key. */
export function assertJwtConfig(): void {
  const secret = process.env["JWT_SECRET"];
  const isProduction = process.env["NODE_ENV"] === "production";
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required.");
  }
  if (isProduction && (secret.length < 16 || secret === DEV_PLACEHOLDER_SECRET)) {
    throw new Error(
      "JWT_SECRET is too weak for production: it must be at least 16 characters and not the dev placeholder.",
    );
  }
}

export interface JwtPayload {
  userId: number;
  username: string;
  email: string;
  role: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, getSecret(), {
    expiresIn: JWT_EXPIRE,
    algorithm: "HS256",
  } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, getSecret(), { algorithms: ["HS256"] }) as JwtPayload;
}
