import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import { connect, migrate, type Db } from "../src/db/client.js";
import { startHolderCatalog, type HolderCatalog } from "../src/db/holder-catalog.js";
import { activeAgentsOf } from "../src/db/runner.js";
let db: Db; let close: () => Promise<void>; let catalog: HolderCatalog | undefined;
beforeAll(async () => { const conn = await connect(); db = conn.db; close = conn.close; await migrate(db); }, 30_000);
afterEach(() => { catalog?.stop(); catalog = undefined; vi.unstubAllGlobals(); });
afterAll(async () => { await close(); });
const primaryMint = Keypair.generate().publicKey.toBase58();
const launchedMint = Keypair.generate().publicKey.toBase58();
const chainFor = (mint: string) => ({ mint, balanceOf: async () => 20, supply: async () => 1000000,
 quote: () => ({ minimum: 20, priceUsd: 1, decimals: 0, at: Date.now() }) });
const options = { url: "https://trygamine.xyz", primaryMint, chainFor };
describe("trusted confirmed launch catalog", () => {
 it("imports confirmed launch mints, deduplicates the primary token, and activates a launch holder", async () => {
   const fetcher = vi.fn(async (url: URL) => {
     expect(url.origin).toBe("https://trygamine.xyz");
     expect(url.pathname).toBe("/api/launchpad/holder-tokens");
     return Response.json({ network: "mainnet-beta", tokens: [
       { mint: primaryMint, name: "AGP", symbol: "AGP" },
       { mint: launchedMint, name: "Launch", symbol: "NEW" },
     ], nextOffset: null });
   });
   vi.stubGlobal("fetch", fetcher);
   catalog = startHolderCatalog(db, options);
   expect(await catalog.tokens()).toEqual([{ mint: launchedMint, name: "Launch", symbol: "NEW" }]);
   const owner = Keypair.generate().publicKey.toBase58(); await catalog.refreshWallet(owner);
   expect(await activeAgentsOf(db, owner, launchedMint)).toHaveLength(1);
   expect(await catalog.chain(Keypair.generate().publicKey.toBase58())).toBeNull();
 });
 it("never imports mints from a wrong-network catalog and retains previously confirmed mint identities during an outage", async () => {
   const unknownMint = Keypair.generate().publicKey.toBase58();
   vi.stubGlobal("fetch", vi.fn(async () => Response.json({ network: "devnet", tokens: [{ mint: unknownMint, name: "Fake", symbol: "FAKE" }], nextOffset: null })));
   catalog = startHolderCatalog(db, options);
   const known = await catalog.tokens();
   expect(known.some(t => t.mint === unknownMint)).toBe(false);
   expect(known.some(t => t.mint === launchedMint)).toBe(true);
 });
 it("requires HTTPS for remote catalogs", () => {
   expect(() => startHolderCatalog(db, { ...options, url: "http://untrusted.example" })).toThrow("HTTPS");
 });
});
