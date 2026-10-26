import { afterEach, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({
  getBalance: vi.fn(async () => 2_000_000_000),
  getParsedTokenAccountsByOwner: vi.fn(async () => ({ value: [] })),
}));
vi.mock("@solana/web3.js", async (original) => {
  const actual = await original<typeof import("@solana/web3.js")>();
  return { ...actual, Connection: class { getBalance = rpc.getBalance; getParsedTokenAccountsByOwner = rpc.getParsedTokenAccountsByOwner; } };
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.clearAllMocks(); });

it("keeps the shared reward wallet readable when the primary mint is a placeholder", async () => {
  vi.stubEnv("PUMP_RPC_URL", "https://rpc.example.invalid");
  vi.stubEnv("PAYOUT_AGP_MINT", "");
  vi.stubEnv("NEXT_PUBLIC_AGP_MINT", "0000000000000000000000000000000000000000000");
  const { rewardWallets } = await import("../lib/reward-wallets");
  const result = await rewardWallets();
  expect(result.agents.sol).toBe(2);
  expect(result.agents.agp).toBeNull();
  expect(rpc.getBalance).toHaveBeenCalledTimes(1);
  expect(rpc.getParsedTokenAccountsByOwner).not.toHaveBeenCalled();
});

it("leaves an unset shared wallet unknown without reading RPC balances", async () => {
  vi.stubEnv("PUMP_RPC_URL", "https://rpc.example.invalid");
  vi.stubEnv("PUMP_AGENT_REWARDS_WALLET", "");
  const { rewardWallets } = await import("../lib/reward-wallets");
  expect(await rewardWallets()).toEqual({ agents: { address: "", sol: null, agp: null } });
  expect(rpc.getBalance).not.toHaveBeenCalled();
});
