import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { connect, migrate, type Db } from "../src/db/client.js";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await connect());
  await migrate(db);
}, 30_000);
afterAll(async () => { if (close) await close(); });

it.each(["agenticpad_migrations", "oxude_migrations", "agentclash_migrations"])("preserves applied migrations from %s instead of replaying them", async (legacy) => {
  await db.execute(sql.raw(`ALTER TABLE gamine_migrations RENAME TO ${legacy}`));
  const before = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${legacy}`)) as unknown as { rows: { n: number }[] };
  expect(before.rows[0]!.n).toBeGreaterThan(0);
  await migrate(db); // Replaying migration 0000 would fail on existing tables.
  const after = await db.execute(sql.raw("SELECT count(*)::int AS n FROM gamine_migrations")) as unknown as { rows: { n: number }[] };
  expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  await migrate(db); // A second restart is also safe with both ledgers present.
});


it("keeps the existing world checkpoint after rebranding", async () => {
  const checkpoint = { version: 1, at: 123, entries: [], positions: {}, claims: {} };
  await db.execute(sql`INSERT INTO world_activities (id, checkpoint, updated_at)
    VALUES ('agenticpad-world', ${JSON.stringify(checkpoint)}::jsonb, now())`);
  await migrate(db);
  const result = await db.execute(sql.raw("SELECT id, checkpoint FROM world_activities")) as unknown as {
    rows: { id: string; checkpoint: unknown }[];
  };
  expect(result.rows).toEqual([{ id: "gamine-world", checkpoint }]);
  await migrate(db);
  const repeated = await db.execute(sql.raw("SELECT count(*)::int AS n FROM world_activities")) as unknown as { rows: { n: number }[] };
  expect(repeated.rows[0]!.n).toBe(1);
});
