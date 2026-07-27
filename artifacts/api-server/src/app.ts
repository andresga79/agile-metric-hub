import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
  type ErrorRequestHandler,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { securityHeaders } from "./lib/security";

const app: Express = express();

// Trust the first proxy hop in production (Render terminates TLS and forwards
// via X-Forwarded-For) so req.ip is the real client IP — the login rate limiter
// keys on it, and without this every request would look like it came from the
// proxy and share one bucket. Left off in local dev (direct connection).
if (process.env["NODE_ENV"] === "production") {
  app.set("trust proxy", 1);
}

app.use(securityHeaders());

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Restrict CORS to the configured frontend origin(s) when CORS_ORIGIN is set
// (comma-separated). Left open only when unset — i.e. local dev; a real deploy
// must set CORS_ORIGIN=https://<frontend-domain>.
const corsOrigins = process.env["CORS_ORIGIN"]
  ?.split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.use(cors(corsOrigins && corsOrigins.length > 0 ? { origin: corsOrigins } : {}));
// Cap request body size (SEC-4) — the API only ever receives small JSON
// payloads, so 1mb is generous and blocks memory-exhaustion via huge bodies.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use("/api", router);

// JSON 404 for unmatched API routes (instead of Express's default HTML page),
// so the client always gets the same { error } shape it knows how to parse.
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// Global error handler — must be last and take 4 args. Express 5 forwards
// rejected async handlers here automatically. Returns a consistent JSON body
// ({ error }) matching the rest of the API, instead of Express's default HTML
// 500. 5xx responses use a generic message so internal details/stack traces
// are never leaked to the client; the real error is logged server-side.
const errorHandler: ErrorRequestHandler = (err, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const raw = (err as { status?: unknown; statusCode?: unknown; message?: unknown }) ?? {};
  const candidate = typeof raw.status === "number" ? raw.status : typeof raw.statusCode === "number" ? raw.statusCode : 500;
  const status = Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500;

  (req.log ?? logger).error({ err }, "Unhandled request error");

  const message = status < 500 && typeof raw.message === "string" ? raw.message : "Internal Server Error";
  res.status(status).json({ error: message });
};
app.use(errorHandler);

export default app;
