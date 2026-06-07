import { pool } from "@workspace/db";
import { syncLoungesFromLeads } from "@workspace/lead-collector";

async function main() {
  console.log("Publishing collected hookah lounges to the public directory...");
  const result = await syncLoungesFromLeads();
  console.log(`Done. published=${result.published}`);
  await pool.end();
}

main().catch(async (err) => {
  console.error("Sync failed:", err);
  await pool.end();
  process.exit(1);
});
