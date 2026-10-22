import { readStoredValue, removeStoredValue } from "./browser-storage";
import type { LaunchForm, Launchpad, LaunchStatus } from "./launchpad";
import { loadSession } from "./wallet";

const PENDING_KEY = "gamine.pump.pending";
type Pending = { id: string; draft: LaunchForm; signed: string | null };

export function pendingPumpLaunch(): Pending | null {
  if (typeof window === "undefined") return null;
  try {
    const pending = JSON.parse(readStoredValue(localStorage, PENDING_KEY) ?? "null") as Pending | null;
    return pending?.draft.creator === loadSession()?.ownerId ? pending : null;
  } catch { return null; }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const session = loadSession();
  const response = await fetch(`/api/launchpad/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(session ? { authorization: `Bearer ${session.token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The launchpad request failed.");
  return data as T;
}

export const pumpLaunchpad: Launchpad = {
  mock: false,
  getConfig: () => request("config"),
  async createLaunch(form, options = {}) {
    const signer = options.signTransaction;
    if (!signer) throw new Error("Connect a wallet that can sign the launch transaction.");
    const pending = pendingPumpLaunch();
    if (pending) throw new Error("A previous launch needs confirmation. Resume it before starting another.");
    const id = crypto.randomUUID();
    const prepared = await request<{ id: string; transaction: string }>("prepare", { id, form });
    const signed = await signer(prepared.transaction);
    // Save before submitting: a timeout or reload must never cause a second charge.
    localStorage.setItem(PENDING_KEY, JSON.stringify({ id: prepared.id, draft: form, signed } satisfies Pending));
    await request(`${prepared.id}/submit`, { transaction: signed });
    return { id: prepared.id };
  },
  async getLaunchStatus(id) {
    const status = await request<LaunchStatus>(`${id}/status`);
    if (status.live || status.failure) {
      if (pendingPumpLaunch()?.id === id) removeStoredValue(localStorage, PENDING_KEY);
    }
    return status;
  },
  listLaunches: (query) => request(`tokens?${new URLSearchParams({ sort: query.sort, search: query.search ?? "", offset: String(query.offset ?? 0), limit: String(query.limit ?? 20) })}`),
  getToken: (mint) => request(`tokens/${encodeURIComponent(mint)}`),
};

export async function resumePumpLaunch(): Promise<{ id: string } | null> {
  const pending = pendingPumpLaunch();
  if (!pending) return null;
  if (pending.signed) await request(`${pending.id}/submit`, { transaction: pending.signed });
  return { id: pending.id };
}
