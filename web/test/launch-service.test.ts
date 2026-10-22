import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { FeeConfig } from "@pump-fun/pump-sdk";
import { globalFixture, sharedTable } from "./pump-fixture";
import { pump } from "../lib/pump-sdk";
import { feeWallets } from "../lib/launchpad-config";
import { launchStore } from "../lib/launchpad-store";
import { fromThisSite, ownerOf, prepareLaunch, pumpConfig, readLaunchBody, statusOfLaunch, submitLaunch, listPumpTokens } from "../lib/launchpad-server";
import type { LaunchForm } from "../lib/launchpad";

const MAINNET = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const CID = "Qm" + "a".repeat(44);
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHiYAAAAASUVORK5CYII=";

describe("Launch service (RPC and IPFS stubbed; no transactions sent)", () => {
  let user: Keypair;
  let form: LaunchForm;
  let id: string;
  let global: ReturnType<typeof globalFixture>;
  let connection: Connection;
  beforeEach(async () => {
    vi.stubEnv("PUMP_LAUNCH_ENABLED", "true");
    vi.stubEnv("PUMP_RPC_URL", "https://rpc.example.invalid");
    vi.stubEnv("PINATA_JWT", "test-credential");
    vi.stubEnv("PUMP_LAUNCH_DB_PATH", ":memory:");
    user = Keypair.generate(); id = crypto.randomUUID(); global = globalFixture();
    connection = new Connection("https://rpc.example.invalid");
    form = { name: "Launch test", ticker: "TEST", description: "Test", creator: user.publicKey.toBase58(), initialBuySol: "0.1", image: PNG, links: {} };
    const table = await sharedTable(global);
    vi.stubEnv("PUMP_LOOKUP_TABLE", table.key.toBase58());
    vi.spyOn(Connection.prototype, "getGenesisHash").mockResolvedValue(MAINNET);
    vi.spyOn(Connection.prototype, "getAddressLookupTable").mockResolvedValue({ context: { slot: 1 }, value: table });
    vi.spyOn(Connection.prototype, "getLatestBlockhash").mockResolvedValue({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 });
    vi.spyOn(Connection.prototype, "simulateTransaction").mockResolvedValue({ context: { slot: 1 }, value: { err: null, logs: [] } });
    vi.spyOn(connection, "getBlockHeight").mockResolvedValue(20);
    vi.spyOn(Connection.prototype, "getSignatureStatuses").mockResolvedValue({ context: { slot: 1 }, value: [null] });
    vi.spyOn(Connection.prototype, "sendRawTransaction").mockResolvedValue("stubbed-signature");
    vi.spyOn(pump.OnlinePumpSdk.prototype, "fetchGlobal").mockResolvedValue(global);
    vi.spyOn(pump.OnlinePumpSdk.prototype, "fetchFeeConfig").mockResolvedValue(null as unknown as FeeConfig);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ IpfsHash: CID })));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  async function prepare() { return prepareLaunch({ id, form }, form.creator, connection); }
  function sign(base64: string) {
    const transaction = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
    transaction.sign([user]);
    return Buffer.from(transaction.serialize()).toString("base64");
  }
  async function confirmedAccounts(mintAddress: string, revoked = true) {
    const mint = new PublicKey(mintAddress);
    const connection = new Connection("https://rpc.example.invalid");
    const curve = { ...pump.newBondingCurve(global, new PublicKey("So11111111111111111111111111111111111111112")), creator: pump.feeSharingConfigPda(mint), isMayhemMode: false };
    const curveData = await pump.getPumpProgram(connection).coder.accounts.encode("bondingCurve", curve);
    const sharesData = await pump.getPumpFeeProgram(connection).coder.accounts.encode("sharingConfig", {
      bump: 255, version: 2, status: { active: {} }, mint, admin: user.publicKey, adminRevoked: revoked,
      shareholders: feeWallets.map((wallet) => ({ address: new PublicKey(wallet.address), shareBps: wallet.shareBps })),
    });
    const info = { executable: false, lamports: 1, rentEpoch: 0 };
    vi.spyOn(Connection.prototype, "getMultipleAccountsInfo").mockResolvedValue([
      { ...info, owner: pump.PUMP_PROGRAM_ID, data: curveData },
      { ...info, owner: pump.PUMP_FEE_PROGRAM_ID, data: sharesData },
    ]);
  }

  it("prepares once for an id, refuses another owner, and never broadcasts while preparing", async () => {
    const first = await prepare();
    const again = await prepare();
    expect(again).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(Connection.prototype.sendRawTransaction).not.toHaveBeenCalled();
    await expect(prepareLaunch({ id, form }, Keypair.generate().publicKey.toBase58())).rejects.toThrow("not found");
  });
  it("persists the exact signed transaction before an interrupted broadcast and resumes without another mint", async () => {
    const prepared = await prepare();
    const signed = sign(prepared.transaction);
    vi.mocked(Connection.prototype.sendRawTransaction).mockRejectedValueOnce(new Error("connection interrupted"));
    await expect(submitLaunch(id, { transaction: signed }, form.creator, connection)).rejects.toThrow("Resume");
    const saved = launchStore().get(id)!;
    expect(saved.signed).toBe(signed);
    expect(saved.signature).toBeTruthy();
    await submitLaunch(id, { transaction: signed }, form.creator, connection);
    const calls = vi.mocked(Connection.prototype.sendRawTransaction).mock.calls;
    expect(Buffer.from(calls[0]![0])).toEqual(Buffer.from(calls[1]![0]));
    expect(launchStore().get(id)!.mint).toBe(prepared.mint);
  });
  it("requires actual confirmation and locked recipients before advertising a successful launch", async () => {
    const prepared = await prepare();
    const signed = sign(prepared.transaction);
    await submitLaunch(id, { transaction: signed }, form.creator, connection);
    expect((await statusOfLaunch(id, form.creator, connection)).live).toBe(false);
    vi.mocked(Connection.prototype.getSignatureStatuses).mockResolvedValue({ context: { slot: 1 }, value: [{ slot: 1, confirmations: 1, err: null, confirmationStatus: "confirmed" }] });
    await confirmedAccounts(prepared.mint);
    const status = await statusOfLaunch(id, form.creator, connection);
    expect(status.live).toBe(true);
    expect(status.stages.verified).toBe("done");
    expect(status.stages.agentsLive).toBe("pending");
    const callsBeforeRetry = vi.mocked(Connection.prototype.sendRawTransaction).mock.calls.length;
    await submitLaunch(id, { transaction: signed }, form.creator, connection);
    expect(Connection.prototype.sendRawTransaction).toHaveBeenCalledTimes(callsBeforeRetry);
    const token = listPumpTokens({ sort: "newest" }).tokens.find((token) => token.mint === prepared.mint)!;
    expect(token.agentsInPlay).toBe(0);
    expect(token.marketCapUsd).toBeNull();
  });
  it("rejects a confirmed transaction whose fee split is still editable", async () => {
    const prepared = await prepare();
    await submitLaunch(id, { transaction: sign(prepared.transaction) }, form.creator, connection);
    vi.mocked(Connection.prototype.getSignatureStatuses).mockResolvedValue({ context: { slot: 1 }, value: [{ slot: 1, confirmations: 1, err: null, confirmationStatus: "confirmed" }] });
    await confirmedAccounts(prepared.mint, false);
    await expect(statusOfLaunch(id, form.creator, connection)).rejects.toThrow("not locked");
    expect(launchStore().get(id)!.confirmed).toBe(false);
  });
  it("records an expired launch only after finalized expiry with no mint account", async () => {
    await prepare();
    vi.mocked(connection.getBlockHeight).mockResolvedValue(101);
    vi.spyOn(Connection.prototype, "getAccountInfo").mockResolvedValue(null);
    const status = await statusOfLaunch(id, form.creator, connection);
    expect(status.live).toBe(false);
    expect(status.failure?.message).toContain("expired");
    expect(Connection.prototype.sendRawTransaction).not.toHaveBeenCalled();
  });
  describe("the $GAMINE mint", () => {
    // Grinding a real AGP address takes seconds to minutes, so the configured
    // key is a random one, given a stand-in address that ends in AGP.
    const address = "1".repeat(30) + "AGP";
    beforeEach(() => {
      const agp = Keypair.generate();
      vi.spyOn(Keypair, "fromSecretKey").mockReturnValue({ publicKey: new PublicKey(address), secretKey: agp.secretKey } as Keypair);
      vi.stubEnv("AGP_MINT_SECRET", JSON.stringify(Array.from(agp.secretKey)));
      vi.stubEnv("AGP_MINT_LAUNCHER", user.publicKey.toBase58());
      form = { ...form, ticker: "GAMINE" };
    });
    it("uses the configured mint for the configured launcher's GAMINE launch, once while it may land", async () => {
      expect((await prepare()).mint).toBe(address);
      const first = id;
      id = crypto.randomUUID();
      await expect(prepare()).rejects.toThrow("may still land");
      // Its approval window has passed (finalized height 101 > 100) and no token was created: the mint is free again.
      vi.mocked(connection.getBlockHeight).mockResolvedValue(101);
      vi.spyOn(connection, "getAccountInfo").mockResolvedValue(null);
      expect((await prepare()).mint).toBe(address);
      expect(launchStore().get(first)).toBeNull();
      // A token that does exist keeps it held.
      id = crypto.randomUUID();
      vi.mocked(connection.getAccountInfo).mockResolvedValue({ executable: false, lamports: 1, owner: PublicKey.default, data: Buffer.alloc(0), rentEpoch: 0 });
      await expect(prepare()).rejects.toThrow("may still land");
    });
    it("gives anyone else's GAMINE launch, and the launcher's other tickers, a random mint", async () => {
      const other = Keypair.generate();
      const theirs = await prepareLaunch({ id, form: { ...form, creator: other.publicKey.toBase58() } }, other.publicKey.toBase58(), connection);
      expect(theirs.mint).not.toBe(address);
      id = crypto.randomUUID(); form = { ...form, ticker: "TEST" };
      expect((await prepare()).mint).not.toBe(address);
    });
    it("refuses a misconfigured key before uploading anything", async () => {
      vi.mocked(Keypair.fromSecretKey).mockRestore();
      await expect(prepare()).rejects.toThrow("does not end in AGP");
      vi.stubEnv("AGP_MINT_LAUNCHER", "not-a-wallet");
      await expect(prepare()).rejects.toThrow("not configured correctly");
      expect(fetch).not.toHaveBeenCalled();
    });
  });
  it("rejects non-mainnet RPCs before uploading or charging", async () => {
    vi.mocked(Connection.prototype.getGenesisHash).mockResolvedValue("devnet");
    await expect(prepare()).rejects.toThrow("another network");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects simulation failure before returning a payable transaction", async () => {
    vi.mocked(Connection.prototype.simulateTransaction).mockResolvedValue({ context: { slot: 1 }, value: { err: "InsufficientFundsForFee", logs: [] } });
    await expect(prepare()).rejects.toThrow("simulation failed");
    expect(launchStore().get(id)).toBeNull();
    expect(Connection.prototype.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("keeps launches unavailable when storage or provider configuration is missing", () => {
    vi.stubEnv("PINATA_JWT", "");
    expect(pumpConfig().ready).toBe(false);
    vi.stubEnv("PINATA_JWT", "test-credential");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PUMP_LAUNCH_DB_PATH", "");
    expect(pumpConfig().ready).toBe(false);
  });
  it("verifies sign-in with the API rather than trusting the submitted wallet", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ownerId: form.creator }));
    expect(await ownerOf(new Request("https://gamine.example/api/launchpad/prepare", { headers: { authorization: "Bearer test-session" } }))).toBe(form.creator);
    await expect(ownerOf(new Request("https://gamine.example/"))).rejects.toThrow("sign in");
  });
  it("accepts launch posts from this site behind a host's proxy, and refuses other sites", () => {
    // Railway hands the app its internal address; the public one arrives in forwarded headers.
    const at = (origin: string | null, headers: Record<string, string> = {}) =>
      fromThisSite(new Request("http://localhost:8080/api/launchpad/prepare", { method: "POST", headers: { ...(origin ? { origin } : {}), ...headers } }));
    expect(at("https://trygamine.xyz", { "x-forwarded-host": "trygamine.xyz", "x-forwarded-proto": "https" })).toBe(true);
    expect(at("https://trygamine.xyz")).toBe(true);
    expect(at("http://localhost:8080")).toBe(true);
    expect(at("https://evil.example", { "x-forwarded-host": "trygamine.xyz", "x-forwarded-proto": "https" })).toBe(false);
    expect(at(null)).toBe(false);
  });
  it("bounds chunked JSON request bodies", async () => {
    const request = new Request("https://gamine.example/", { method: "POST", body: "a".repeat(3_000_001) });
    await expect(readLaunchBody(request)).rejects.toThrow("too large");
    await expect(readLaunchBody(new Request("https://gamine.example/", { method: "POST", body: "[]" }))).rejects.toThrow("Invalid");
  });
});
