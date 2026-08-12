import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { buildSessionMiddleware } from "./lib/auth";
import { stripeWebhookHandler } from "./routes/webhooks";

const app: Express = express();

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
app.use(cors());

// Stripe webhook MUST receive the raw request body (a Buffer) for signature
// verification. Register it before express.json() so the body is not parsed.
app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhookHandler);

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true }));
app.set("trust proxy", 1);
app.use(buildSessionMiddleware());

app.use("/api", router);

export default app;
