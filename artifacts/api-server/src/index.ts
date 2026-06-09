import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  void (async () => {
    const sid = process.env["TWILIO_API_KEY_SID"] ?? "";
    const sec = process.env["TWILIO_API_KEY_SECRET"] ?? "";
    if (!sid || !sec) {
      logger.info({ sidLen: sid.length, secLen: sec.length }, "TWILIO_KEY_PROBE skipped (missing key)");
      return;
    }
    const auth = "Basic " + Buffer.from(`${sid}:${sec}`).toString("base64");
    try {
      const res = await fetch("https://api.twilio.com/2010-04-01/Accounts.json", {
        headers: { Authorization: auth },
      });
      const errCode = res.headers.get("x-twilio-error-code");
      logger.info(
        {
          result: res.status === 200 ? "PASS key valid" : "FAIL key rejected",
          httpStatus: res.status,
          errCode,
          sidLen: sid.length,
          secLen: sec.length,
          sidPrefix: sid.slice(0, 2),
        },
        "TWILIO_KEY_PROBE",
      );
    } catch (err) {
      logger.error({ err }, "TWILIO_KEY_PROBE failed");
    }
  })();
});
