import { pool } from "@workspace/db";
import { collectMarket, getMarket, MARKETS } from "@workspace/lead-collector";

async function main() {
  const marketId = process.argv[2] ?? "las-vegas";
  const market = getMarket(marketId);
  if (!market) {
    console.error(
      `Unknown market "${marketId}". Available: ${Object.keys(MARKETS).join(", ")}`,
    );
    process.exit(1);
  }

  console.log(`Collecting hookah leads for: ${market.label}`);
  console.log(
    `Cities: ${market.cities.length} | Keywords run per city: this may take a few minutes...\n`,
  );

  const result = await collectMarket({
    marketId,
    onProgress: (p) => {
      process.stdout.write(
        `\r[${p.queriesRun}/${p.totalQueries} queries] fetched=${p.fetched} inserted=${p.inserted} updated=${p.updated} rejected=${p.rejected}   `,
      );
    },
  });

  console.log("\n\nDone.");
  console.log(JSON.stringify(result, null, 2));
  await pool.end();
}

main().catch(async (err) => {
  console.error("\nCollection failed:", err);
  await pool.end();
  process.exit(1);
});
