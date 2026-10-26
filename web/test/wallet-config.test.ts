import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Connection, Keypair, PublicKey, SystemInstruction } from "@solana/web3.js";
import type { BorshInstructionCoder } from "@coral-xyz/anchor";
import { globalFixture } from "./pump-fixture";

describe("Configured launch receiving wallets", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("PUMP_RPC_URL", "https://rpc.example.invalid");
    vi.stubEnv("PINATA_JWT", "test-credential");
    vi.stubEnv("PUMP_LOOKUP_TABLE", Keypair.generate().publicKey.toBase58());
    vi.stubEnv("PUMP_LAUNCH_DB_PATH", ":memory:");
    vi.stubEnv("PUMP_LAUNCH_ENABLED", "true");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("uses env wallets for both the platform payment and the fee-sharing instruction", async () => {
    const platform = Keypair.generate().publicKey.toBase58();
    const agents = Keypair.generate().publicKey.toBase58();
    vi.stubEnv("PUMP_PLATFORM_WALLET", platform);
    vi.stubEnv("PUMP_AGENT_REWARDS_WALLET", agents);
    const { launchInstructions } = await import("../lib/pump-transaction");
    const { pumpConfig } = await import("../lib/launchpad-server");
    const { feeWallets } = await import("../lib/launchpad-config");
    const { pump } = await import("../lib/pump-sdk");
    const instructions = await launchInstructions({
      form: { name: "Configured", ticker: "CFG", description: "", image: "", links: {}, initialBuySol: "0", creator: Keypair.generate().publicKey.toBase58() },
      mint: Keypair.generate().publicKey, uri: "https://ipfs.io/ipfs/setup", global: globalFixture(), feeConfig: null,
    });
    expect(SystemInstruction.decodeTransfer(instructions.at(-1)!).toPubkey.toBase58()).toBe(platform);
    expect(feeWallets).toEqual([
      { address: agents, shareBps: 7000 }, { address: platform, shareBps: 3000 },
    ]);
    const coder = pump.getPumpFeeProgram(new Connection("https://rpc.example.invalid")).coder.instruction as BorshInstructionCoder;
    const decoded = coder.decode(instructions[3]!.data)!;
    const data = decoded.data as { shareholders: { address: PublicKey; shareBps: number }[] };
    expect(data.shareholders.map(({ address, shareBps }) => ({ address: address.toBase58(), shareBps }))).toEqual(feeWallets);
    expect(pumpConfig()).toMatchObject({ ready: true, launchFeeLamports: 50_000_000, launchFeeRecipient: platform, feeSplit: { agents: 70, platform: 30 } });
  });

  it("has no fallback addresses and refuses to build launch transactions until both are supplied", async () => {
    vi.stubEnv("PUMP_PLATFORM_WALLET", "");
    vi.stubEnv("PUMP_AGENT_REWARDS_WALLET", "");
    const { LAUNCH_FEE_RECIPIENT, AGENT_REWARDS_WALLET } = await import("../lib/launchpad-fees");
    expect(LAUNCH_FEE_RECIPIENT).toBe("");
    expect(AGENT_REWARDS_WALLET).toBe("");
    const { launchInstructions } = await import("../lib/pump-transaction");
    await expect(launchInstructions({
      form: { name: "Test", ticker: "TEST", description: "", image: "", links: {}, initialBuySol: "0", creator: Keypair.generate().publicKey.toBase58() },
      mint: Keypair.generate().publicKey, uri: "https://ipfs.io/ipfs/setup", global: globalFixture(), feeConfig: null,
    })).rejects.toThrow("Configure distinct");
  });

  it.each(["invalid", "duplicate", "missing"])("disables launching for %s receiving wallets", async (kind) => {
    const platform = Keypair.generate().publicKey.toBase58();
    vi.stubEnv("PUMP_PLATFORM_WALLET", platform);
    vi.stubEnv("PUMP_AGENT_REWARDS_WALLET", kind === "invalid" ? "not-a-wallet" : kind === "missing" ? "" : platform);
    const { pumpConfig } = await import("../lib/launchpad-server");
    expect(pumpConfig().ready).toBe(false);
    const { executionConfig } = await import("../lib/payout-adapter");
    expect(executionConfig().ready).toBe(false);
  });
});
