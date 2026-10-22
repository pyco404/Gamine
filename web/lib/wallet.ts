import { readStoredValue, removeStoredValue } from "./browser-storage";
import bs58 from "bs58";
import { API } from "./api";

/**
 * Phantom and Solflare, through the providers they inject. No adapter library:
 * both expose connect() and signMessage(), which is all sign-in needs. The
 * wallet only ever signs the plain-text sign-in message - never a transaction.
 */
export type WalletName = "Phantom" | "Solflare";

type PublicKeyLike = { toBase58(): string; toString(): string };
type SignResult = Uint8Array | { signature: Uint8Array };
type InjectedProvider = {
  isPhantom?: boolean;
  isSolflare?: boolean;
  publicKey?: PublicKeyLike | null;
  connect(): Promise<{ publicKey?: PublicKeyLike } | boolean | void>;
  disconnect?(): Promise<void>;
  signMessage(message: Uint8Array, display?: "utf8" | "hex"): Promise<SignResult>;
  /** Signs a web3.js Transaction and returns it signed. Used only for withdrawals. */
  signTransaction?<T>(transaction: T): Promise<T>;
};

type WalletWindow = Window & {
  phantom?: { solana?: InjectedProvider };
  solana?: InjectedProvider;
  solflare?: InjectedProvider;
};

export function providerFor(name: WalletName): InjectedProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as WalletWindow;
  if (name === "Phantom") return w.phantom?.solana ?? (w.solana?.isPhantom ? w.solana : null) ?? null;
  return w.solflare?.isSolflare ? w.solflare : null;
}

export const installedWallets = (): WalletName[] =>
  (["Phantom", "Solflare"] as const).filter((name) => providerFor(name) !== null);

const INSTALL_URL: Record<WalletName, string> = {
  Phantom: "https://phantom.com/download",
  Solflare: "https://solflare.com/download",
};
export const installUrl = (name: WalletName) => INSTALL_URL[name];

/** "Privy" is an embedded wallet made by email or X login; the others are browser extensions. */
export type SignInMethod = WalletName | "Privy";

export type Session = { token: string; ownerId: string; wallet: SignInMethod; expiresAt: string };

const SESSION_KEY = "gamine.session";

/**
 * The session token lives in localStorage so a refresh does not ask for a new
 * signature. It grants this app's actions only - no wallet authority - but any
 * script running on the page can read it, so the page must stay free of
 * third-party script.
 */
export function loadSession(): Session | null {
  try {
    const raw = readStoredValue(localStorage, SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    return new Date(session.expiresAt).getTime() > Date.now() ? session : null;
  } catch {
    return null;
  }
}

function saveSession(session: Session | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else removeStoredValue(localStorage, SESSION_KEY);
  } catch {
    /* storage unavailable: the session lasts this page load */
  }
}

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof json["error"] === "string" ? json["error"] : `request failed (${res.status})`);
  return json as T;
}

function walletResponse<T>(request: Promise<T>, name: WalletName, action: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} did not respond to ${action}. Open and unlock the wallet, close any pending request, then try again.`)), 90_000);
    request.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export type PendingWalletSignIn = {
  wallet: WalletName;
  publicKey: string;
  nonce: string;
  message: string;
};

/** Prepare the challenge first; request its signature from a fresh button click. */
export async function prepareWalletSignIn(name: WalletName): Promise<PendingWalletSignIn> {
  const provider = providerFor(name);
  if (!provider) throw new Error(`${name} is not installed`);

  const connected = await walletResponse(provider.connect(), name, "connection");
  const key =
    (connected && typeof connected === "object" && "publicKey" in connected ? connected.publicKey : undefined) ??
    provider.publicKey;
  if (!key) throw new Error(`${name} did not share a public key`);
  const publicKey = key.toBase58 ? key.toBase58() : key.toString();

  const issued = await post<{ nonce: string; message: string }>("/auth/nonce", { publicKey });
  return { wallet: name, publicKey, ...issued };
}

/** No network request precedes the wallet prompt: preserve the user's click. */
export async function completeWalletSignIn(issued: PendingWalletSignIn): Promise<Session> {
  const provider = providerFor(issued.wallet);
  if (!provider) throw new Error(`${issued.wallet} is not installed`);
  const key = provider.publicKey?.toBase58?.() ?? provider.publicKey?.toString();
  if (key !== issued.publicKey) throw new Error("Your wallet account changed. Cancel and connect again.");
  const signed = await walletResponse(provider.signMessage(new TextEncoder().encode(issued.message), "utf8"), issued.wallet, "message signing");
  const signature = bs58.encode(signed instanceof Uint8Array ? signed : signed.signature);

  const verified = await post<{ token: string; ownerId: string; expiresAt: string }>("/auth/verify", {
    publicKey: issued.publicKey,
    nonce: issued.nonce,
    signature,
  });
  const session: Session = { ...verified, wallet: issued.wallet };
  saveSession(session);
  return session;
}

export async function signInWith(name: WalletName): Promise<Session> {
  return completeWalletSignIn(await prepareWalletSignIn(name));
}

/**
 * The same exchange as signInWith, for a signer that isn't an injected
 * extension (a Privy embedded wallet). Same nonce, same message, same
 * verification: the server can't tell the two apart, and owner_id is the key.
 */
export async function signInWithSigner(
  publicKey: string,
  sign: (message: Uint8Array) => Promise<Uint8Array>,
  wallet: SignInMethod,
): Promise<Session> {
  const issued = await post<{ nonce: string; message: string }>("/auth/nonce", { publicKey });
  const signature = bs58.encode(await sign(new TextEncoder().encode(issued.message)));
  const verified = await post<{ token: string; ownerId: string; expiresAt: string }>("/auth/verify", {
    publicKey,
    nonce: issued.nonce,
    signature,
  });
  const session: Session = { ...verified, wallet };
  saveSession(session);
  return session;
}

export async function signOut(session: Session | null): Promise<void> {
  if (session) {
    await post("/auth/logout", {}, session.token).catch(() => undefined);
    if (session.wallet !== "Privy") await providerFor(session.wallet)?.disconnect?.().catch(() => undefined);
  }
  saveSession(null);
}

/**
 * Signs a withdrawal the server prepared (base64, already co-signed by the
 * settler) with an extension wallet, and returns it base64. Unlike sign-in this
 * is a real transaction: it moves tokens from the vault to this wallet. The
 * fee is paid by the server. web3.js loads only here, when someone withdraws.
 */
export async function signTransactionWith(session: Session, prepared: string): Promise<string> {
  if (session.wallet === "Privy") throw new Error("an email or X wallet signs through Privy");
  const provider = providerFor(session.wallet);
  if (!provider?.signTransaction) throw new Error(`${session.wallet} can't sign transactions here`);
  if (!provider.publicKey) await provider.connect();
  const account = () => provider.publicKey?.toBase58?.() ?? provider.publicKey?.toString();
  if (account() !== session.ownerId) {
    // The extension still reports the account this page first connected (the admin's sign-in, say)
    // after its owner selects another: reconnecting hands the page the one now selected. The sign-in
    // session is a token, so it is not touched.
    await provider.disconnect?.().catch(() => undefined);
    await provider.connect();
  }
  const connected = account();
  if (connected !== session.ownerId) {
    throw new Error(`${session.wallet} is on a different account: switch it to ${shortKey(session.ownerId)} and try again`);
  }
  const { Transaction, VersionedTransaction } = await import("@solana/web3.js");
  const bytes = fromBase64(prepared);
  const versioned = VersionedTransaction.deserialize(bytes);
  if (versioned.version !== "legacy") {
    const signed = await provider.signTransaction(versioned);
    return toBase64(signed.serialize());
  }
  const signed = await provider.signTransaction(Transaction.from(bytes));
  return toBase64(signed.serialize({ requireAllSignatures: false, verifySignatures: false }));
}

// Browsers have no Buffer global; base64 by hand.
export const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
export const toBase64 = (bytes: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export const shortKey = (key: string) => `${key.slice(0, 4)}…${key.slice(-4)}`;
