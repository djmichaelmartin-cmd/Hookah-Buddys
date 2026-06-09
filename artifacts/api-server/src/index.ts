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
    const acct = process.env["TWILIO_ACCOUNT_SID"] ?? "";
    const tok = process.env["TWILIO_AUTH_TOKEN"] ?? "";
    if (!tok) {
      logger.info({ acctLen: acct.length, tokLen: 0 }, "TWILIO_AUTHTOKEN_PROBE skipped (no token)");
      return;
    }
    const auth = "Basic " + Buffer.from(`${acct}:${tok}`).toString("base64");
    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${acct}.json`,
        { headers: { Authorization: auth } },
      );
      const errCode = res.headers.get("x-twilio-error-code");
      let friendly = "";
      let status = "";
      try {
        const body = (await res.json()) as { friendly_name?: string; status?: string };
        friendly = body.friendly_name ?? "";
        status = body.status ?? "";
      } catch {
        /* ignore */
      }
      logger.info(
        { httpStatus: res.status, errCode, acctLen: acct.length, tokLen: tok.length, friendly, status },
        "TWILIO_AUTHTOKEN_PROBE",
      );
    } catch (err) {
      logger.error({ err }, "TWILIO_AUTHTOKEN_PROBE failed");
    }
  })();
});
