import app from "./app";
import { logger } from "./lib/logger";
import { syncPlans } from "./lib/syncPlans";
import { startEventReminderScheduler } from "./lib/eventReminders";
import { startBusinessSpotlightGeocodeScheduler } from "./lib/privateGeocoding";
import { startCustomRequestReconciliation } from "./lib/customRequestReconciliation";

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

// Ensure canonical plan copy is in the DB before accepting any traffic.
// Safe to run on every boot: updates display fields in place (no ID or
// price-ID changes, no FK breakage) and inserts missing rows.
syncPlans()
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
      startEventReminderScheduler();
      startBusinessSpotlightGeocodeScheduler();
      startCustomRequestReconciliation();
    });
  })
  .catch((err) => {
    logger.error({ err }, "syncPlans failed — aborting startup");
    process.exit(1);
  });
