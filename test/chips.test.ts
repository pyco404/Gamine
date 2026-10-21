import { describe, expect, it } from "vitest";
import { connect, migrate } from "../src/db/client.js";
import { balanceOf } from "../src/db/ledger.js";
import { createAgent } from "../src/db/runner.js";
import { baseUnits, chipRate, chips, DEVNET_CHIP_RATE, SEED_CHIP_RATE } from "../src/chips.js";
import { WORST_MATCH } from "../src/db/schema.js";
import { holdFor, someWallet } from "./helpers.js";
import { GAMINE_RULES } from "../src/round.js";

// Chips against base units: the conversion, and that a holding is read wide
// enough to hold the second of them.

describe("chips and base units", () => {
  it("converts a chip figure exactly, in both directions", () => {
    const rate = DEVNET_CHIP_RATE;
    // A stake begins as chips, so it survives the round trip untouched. This
    // is what keeps a settlement zero-sum in base units as well as in chips.
    expect(chips(baseUnits(WORST_MATCH, rate), rate)).toBe(WORST_MATCH);
    expect(baseUnits(GAMINE_RULES.stakes.ante, rate)).toBe(GAMINE_RULES.stakes.ante * 1_000_000);
    expect(baseUnits(900, rate)).toBe(900_000_000);
  });

  it("rounds a remainder down, because dust cannot be staked", () => {
    const rate = DEVNET_CHIP_RATE;
    // A deposit or a withdrawal is any number of base units the owner chose, so
    // a balance can sit between two chips. The part of a chip is not spendable.
    expect(chips(900_000_000 + 1, rate)).toBe(900);
    expect(chips(900_999_999, rate)).toBe(900);
    expect(chips(999_999, rate)).toBe(0);
    // Towards zero on both sides, so a loss is never rounded into a bigger one.
    expect(chips(-1_500_000, rate)).toBe(-1);
  });

  it("gives the frozen seed flow a rate of one, and the deposit flow the season's", () => {
    // The seed program's mint has no decimals and was minted a token per chip,
    // and that program is frozen, so its rate can never move.
    expect(chipRate("seed")).toBe(SEED_CHIP_RATE);
    expect(chipRate("seed", DEVNET_CHIP_RATE)).toBe(1);
    expect(chipRate("deposit")).toBe(DEVNET_CHIP_RATE);
    expect(chipRate("deposit", 500_000)).toBe(500_000);
  });

  it("holds a six-decimal holding, which a 32-bit column could not", async () => {
    const { db } = await connect();
    await migrate(db);
    const owner = someWallet();
    const agent = await createAgent(db, { name: "Wide", presetName: "Anchor", ownerId: owner });

    // 2,147 chips is where a 32-bit column runs out at six decimals; this is
    // well past it, and an ordinary holding.
    const big = baseUnits(50_000, DEVNET_CHIP_RATE);
    expect(big).toBeGreaterThan(2_147_483_647);
    await holdFor(db, owner, big);
    expect(await balanceOf(db, agent.id)).toBe(big);

    // And the whole devnet supply, the most any one wallet could hold.
    const supply = baseUnits(1_000_000_000, DEVNET_CHIP_RATE);
    expect(Number.isSafeInteger(supply)).toBe(true);
    await holdFor(db, owner, supply);
    expect(await balanceOf(db, agent.id)).toBe(supply);
  });
});
