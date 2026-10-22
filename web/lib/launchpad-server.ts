import { MarketStore } from "./token-market";
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { pump } from "./pump-sdk";
import { feeWallets, launchConfig } from "./launchpad-config";
import { compileLaunch, launchInstructions } from "./pump-transaction";
import { launchStore, type StoredLaunch } from "./launchpad-store";
import { verifyFeeSharing, verifySignedLaunch } from "./pump-verification";
import { checkForm, checkImage, type LaunchForm, type LaunchQuery, type LaunchStatus, type TokenDetail } from "./launchpad";
import { STAGES } from "./launchpad-stages";
import { siteLinks } from "./site-links";
import { tokenImage } from "./ipfs-image";

const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export class LaunchError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function pumpConfig() {
  const missing = ["PUMP_RPC_URL", "PINATA_JWT", "PUMP_LOOKUP_TABLE"].filter((name) => !process.env[name]);
  if (process.env.NODE_ENV === "production" && !process.env.PUMP_LAUNCH_DB_PATH) missing.push("PUMP_LAUNCH_DB_PATH");
  if (process.env.PUMP_LAUNCH_ENABLED !== "true") missing.push("PUMP_LAUNCH_ENABLED=true");
  try {
    const wallets = feeWallets.map(({ address }) => new PublicKey(address).toBase58());
    if (new Set(wallets).size !== wallets.length) missing.push("distinct fee wallets");
  } catch { missing.push("valid fee wallets"); }
  return { ...launchConfig, ready: missing.length === 0, unavailableReason: missing.length ? "Token launches are not available yet. The platform is completing launch setup." : null };
}

export function pumpConnection(): Connection {
  const url = process.env.PUMP_RPC_URL;
  if (!url) throw new LaunchError("The launch RPC has not been configured.", 503);
  return new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
}

async function mainnet(connection: Connection) {
  if (await connection.getGenesisHash() !== MAINNET_GENESIS) throw new LaunchError("Pump launches require a mainnet RPC; the configured endpoint is on another network.", 503);
}

export async function ownerOf(request: Request): Promise<string> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) throw new LaunchError("Connect and sign in before launching.", 401);
  const api = process.env.LAUNCHPAD_AUTH_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
  const response = await fetch(`${api}/auth/me`, { headers: { authorization: auth }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new LaunchError("Your sign-in expired. Connect your wallet again.", 401);
  const data = await response.json() as { ownerId?: string };
  if (!data.ownerId) throw new LaunchError("Sign-in could not be verified.", 401);
  return new PublicKey(data.ownerId).toBase58();
}

/**
 * Whether a POST comes from this site's own pages. Behind a host's proxy (Railway) the request's
 * own URL is the internal address, so the origin is checked against the public one the proxy
 * forwarded, the configured site address, and the request URL for local runs.
 */
export function fromThisSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set<string>([new URL(request.url).origin]);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) allowed.add(`${request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https"}://${host.split(",")[0]!.trim()}`);
  try { allowed.add(new URL(siteLinks.website).origin); } catch { /* not configured */ }
  return allowed.has(origin);
}

/** Limit even chunked requests before parsing; uploads never fetch arbitrary user URLs. */
export async function readLaunchBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new LaunchError("The launch request is empty.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 3_000_000) { await reader.cancel(); throw new LaunchError("The launch request is too large.", 413); }
    chunks.push(chunk.value);
  }
  try {
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch { throw new LaunchError("Invalid launch request."); }
}

function formOf(value: unknown, owner: string): LaunchForm {
  if (!value || typeof value !== "object") throw new LaunchError("Missing token details.");
  const data = value as Record<string, unknown>;
  for (const field of ["name", "ticker", "description", "image", "creator", "initialBuySol"]) if (typeof data[field] !== "string") throw new LaunchError(`Missing or invalid ${field}.`);
  const links = data.links;
  if (!links || typeof links !== "object" || Array.isArray(links)) throw new LaunchError("Invalid token links.");
  const cleanLinks: LaunchForm["links"] = {};
  for (const field of ["x", "telegram", "website"] as const) {
    const link = (links as Record<string, unknown>)[field];
    if (link !== undefined && typeof link !== "string") throw new LaunchError("Invalid token links.");
    if (typeof link === "string") cleanLinks[field] = link;
  }
  const form: LaunchForm = { name: String(data.name).trim(), ticker: String(data.ticker), description: String(data.description), image: String(data.image), creator: String(data.creator), initialBuySol: String(data.initialBuySol), links: cleanLinks };
  if (form.creator !== owner) throw new LaunchError("The launching wallet does not match your sign-in.", 403);
  const errors = checkForm(form);
  const error = Object.values(errors)[0];
  if (error) throw new LaunchError(error);
  return form;
}

async function pin(path: string, body: BodyInit, contentType?: string): Promise<string> {
  const response = await fetch(`https://api.pinata.cloud/pinning/${path}`, {
    method: "POST", headers: { authorization: `Bearer ${process.env.PINATA_JWT}`, ...(contentType ? { "content-type": contentType } : {}) },
    body, signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new LaunchError("Token artwork or metadata could not be uploaded. No SOL was charged.", 502);
  const result = await response.json() as { IpfsHash?: string };
  if (!result.IpfsHash || !/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(result.IpfsHash)) throw new LaunchError("The metadata provider returned an invalid IPFS address.", 502);
  return `https://ipfs.io/ipfs/${result.IpfsHash}`;
}

async function uploadMetadata(form: LaunchForm) {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(form.image);
  if (!match) throw new LaunchError("Choose a PNG, JPEG, GIF or WebP image.");
  const image = Buffer.from(match[2]!, "base64");
  const error = checkImage({ type: match[1]!, size: image.length }, launchConfig.maxImageBytes);
  if (error) throw new LaunchError(error);
  const upload = new FormData();
  upload.append("file", new Blob([image], { type: match[1] }), `${form.ticker}.${match[1]!.split("/")[1]}`);
  upload.append("pinataMetadata", JSON.stringify({ name: `${form.ticker} artwork` }));
  upload.append("pinataOptions", JSON.stringify({ cidVersion: 0 }));
  const imageUrl = await pin("pinFileToIPFS", upload);
  const metadata = { name: form.name, symbol: form.ticker, description: form.description, image: imageUrl, showName: true, createdOn: siteLinks.website, twitter: form.links.x, telegram: form.links.telegram, website: form.links.website };
  const uri = await pin("pinJSONToIPFS", JSON.stringify({ pinataContent: metadata, pinataMetadata: { name: `${form.ticker} metadata` }, pinataOptions: { cidVersion: 0 } }), "application/json");
  return { uri, imageUrl };
}

/**
 * $GAMINE's mint is ground in advance to end in "AGP" and set as AGP_MINT_SECRET,
 * for the wallet in AGP_MINT_LAUNCHER only. Every other launch, including
 * anyone else's "GAMINE" ticker, gets a fresh random mint.
 */
async function mintFor(form: LaunchForm, connection: Connection): Promise<Keypair> {
  const secret = process.env.AGP_MINT_SECRET;
  if (form.ticker !== "GAMINE" || !secret) return Keypair.generate();
  let launcher: string, mint: Keypair;
  try {
    launcher = new PublicKey(process.env.AGP_MINT_LAUNCHER ?? "").toBase58();
    mint = Keypair.fromSecretKey(secret.trim().startsWith("[") ? Uint8Array.from(JSON.parse(secret) as number[]) : bs58.decode(secret.trim()));
  } catch { throw new LaunchError("The $GAMINE mint is not configured correctly.", 503); }
  if (form.creator !== launcher) return Keypair.generate();
  if (!mint.publicKey.toBase58().endsWith("AGP")) throw new LaunchError("The configured $GAMINE mint does not end in AGP.", 503);
  // A mint is used once. An earlier attempt that expired without creating the token (its approval
  // window has finally passed and the mint account does not exist) can never land, so it releases
  // the mint; anything else still holds it, and is resumed rather than prepared again.
  const earlier = launchStore().getMint(mint.publicKey.toBase58());
  if (earlier) {
    const lapsed = !earlier.confirmed && await connection.getBlockHeight("finalized") > earlier.lastValidBlockHeight
      && !await connection.getAccountInfo(mint.publicKey, "finalized");
    if (!lapsed) throw new LaunchError("The configured $GAMINE mint is in a launch that may still land. Check its status or resume it.", 409);
    launchStore().release(earlier.id);
  }
  return mint;
}

function ownedLaunch(id: string, owner: string): StoredLaunch {
  const record = launchStore().get(id);
  if (!record || record.owner !== owner) throw new LaunchError("Launch not found.", 404);
  return record;
}

export async function prepareLaunch(body: Record<string, unknown>, owner: string, connection?: Connection) {
  if (!pumpConfig().ready) throw new LaunchError(pumpConfig().unavailableReason!, 503);
  const id = body.id;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) throw new LaunchError("Invalid launch request identifier.");
  const existing = launchStore().get(id);
  if (existing) {
    if (existing.owner !== owner) throw new LaunchError("Launch not found.", 404);
    return { id, mint: existing.mint, transaction: existing.transaction };
  }
  const form = formOf(body.form, owner);
  connection ??= pumpConnection();
  await mainnet(connection);
  const table = await connection.getAddressLookupTable(new PublicKey(process.env.PUMP_LOOKUP_TABLE!));
  if (!table.value?.isActive()) throw new LaunchError("The launch address lookup table has not been set up.", 503);
  const mint = await mintFor(form, connection);
  launchStore().reserve(id, owner);
  const { uri, imageUrl } = await uploadMetadata(form);
  const online = new pump.OnlinePumpSdk(connection);
  const [global, feeConfig, latest] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig(), connection.getLatestBlockhash()]);
  if (!global.createV2Enabled) throw new LaunchError("Pump token creation is temporarily disabled.", 503);
  const instructions = await launchInstructions({ form, mint: mint.publicKey, uri, global, feeConfig });
  let transaction: VersionedTransaction;
  try { transaction = compileLaunch({ instructions, user: new PublicKey(owner), mint, blockhash: latest.blockhash, lookupTable: table.value }); }
  catch { throw new LaunchError("This launch does not fit the configured address lookup table. The platform needs to update launch setup. No SOL was charged.", 503); }
  const simulation = await connection.simulateTransaction(transaction, { sigVerify: false, commitment: "confirmed" });
  if (simulation.value.err) throw new LaunchError("The launch simulation failed. Check your SOL balance for the 0.1 SOL platform fee, initial buy, account rent and network fees. No SOL was charged.");
  const serialized = Buffer.from(transaction.serialize()).toString("base64");
  launchStore().insert({
    id, owner, createdAt: Date.now(), form: { ...form, image: imageUrl }, mint: mint.publicKey.toBase58(), uri, imageUrl,
    transaction: serialized, lastValidBlockHeight: latest.lastValidBlockHeight,
    signature: null, signed: null, confirmed: false, failure: null,
  });
  // Discard the mint keypair (the $GAMINE one lives on in its env until removed). The wallet receives only a partially signed transaction.
  return { id, mint: mint.publicKey.toBase58(), transaction: serialized };
}

export async function submitLaunch(id: string, body: Record<string, unknown>, owner: string, connection?: Connection) {
  if (!pumpConfig().ready) throw new LaunchError(pumpConfig().unavailableReason!, 503);
  const record = ownedLaunch(id, owner);
  if (record.confirmed) return { id, signature: record.signature };
  if (typeof body.transaction !== "string" || body.transaction.length > 2500) throw new LaunchError("Invalid signed launch transaction.");
  let transaction: VersionedTransaction;
  try { transaction = verifySignedLaunch(record.transaction, body.transaction); }
  catch { throw new LaunchError("The launch transaction was changed or lacks valid wallet approval."); }
  connection ??= pumpConnection();
  await mainnet(connection);
  if (record.signature) {
    const status = (await connection.getSignatureStatuses([record.signature], { searchTransactionHistory: true })).value[0];
    if (status) return { id, signature: record.signature };
  }
  if (await connection.getBlockHeight() > record.lastValidBlockHeight) throw new LaunchError("This launch approval expired. Check its status before starting a new launch.");
  record.signed = body.transaction;
  record.signature = bs58.encode(transaction.signatures[0]!);
  // Durable before broadcast, so a crash or transport timeout can resume the
  // exact same signature. The mint and fee transfer are never regenerated.
  launchStore().save(record);
  try { await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, maxRetries: 3 }); }
  catch { throw new LaunchError("Launch submission needs confirmation. Resume this launch to check or resend the same transaction; do not launch again.", 502); }
  return { id, signature: record.signature };
}

export async function statusOfLaunch(id: string, owner: string, connection?: Connection): Promise<LaunchStatus> {
  const record = ownedLaunch(id, owner);
  connection ??= pumpConnection();
  await mainnet(connection);
  const status = record.signature ? (await connection.getSignatureStatuses([record.signature], { searchTransactionHistory: true })).value[0] : null;
  if (status?.err) { record.failure = "The launch transaction failed on chain. No token was created and no platform fee or initial buy was charged; network fees may apply."; launchStore().save(record); }
  if (status && !status.err && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) {
    const mint = new PublicKey(record.mint);
    const [curve, sharing] = await connection.getMultipleAccountsInfo([pump.bondingCurvePda(mint), pump.feeSharingConfigPda(mint)]);
    if (!curve?.owner.equals(pump.PUMP_PROGRAM_ID) || !sharing?.owner.equals(pump.PUMP_FEE_PROGRAM_ID)) throw new LaunchError("The confirmed launch is waiting for its on-chain verification.", 503);
    verifyFeeSharing(pump.PUMP_SDK.decodeSharingConfig(sharing), mint);
    if (!pump.PUMP_SDK.decodeBondingCurve(curve).creator.equals(pump.feeSharingConfigPda(mint))) throw new LaunchError("The token creator fee destination does not match the locked sharing config.");
    record.confirmed = true;
    launchStore().save(record);
  }
  // Finalized expiry prevents treating an uncertain submitted transaction as
  // failed and then charging again. An unavailable RPC leaves it pending.
  if (!record.confirmed && !status && await connection.getBlockHeight("finalized") > record.lastValidBlockHeight) {
    const mint = await connection.getAccountInfo(new PublicKey(record.mint), "finalized");
    if (!mint) { record.failure = "The launch approval expired without creating a token. No platform fee or initial buy was charged."; launchStore().save(record); }
  }
  const stages = Object.fromEntries(STAGES.map((stage) => [stage, stage === "agentsLive" ? "pending" : record.confirmed ? "done" : stage === "created" ? record.failure ? "failed" : record.signature ? "in-progress" : "pending" : "pending"])) as LaunchStatus["stages"];
  return { id, mint: record.confirmed ? record.mint : null, stages, failure: record.failure ? { stage: "created", message: record.failure } : null, live: record.confirmed };
}

function tokenOf(record: StoredLaunch): TokenDetail {
  const market = new MarketStore().get(record.mint);
  const fresh = market?.health === "ok" && Date.now() - market.observedAt! <= 15 * 60_000;
  return {
    mint: record.mint, name: record.form.name, ticker: record.form.ticker, image: tokenImage(record.imageUrl),
    description: record.form.description, links: record.form.links, launchedAt: new Date(record.createdAt).toISOString(),
    holders: market?.holders ?? null, agentsInPlay: market?.agentsInPlay ?? 0,
    marketCapUsd: fresh ? market.marketCapUsd : null, volume24hUsd: fresh ? market.volume24hUsd : null, bondingProgress: market?.bondingProgress ?? null,
    verification: "verified", feeSplit: launchConfig.feeSplit, launcherShare: 0,
    verifyUrl: `https://solscan.io/account/${pump.feeSharingConfigPda(new PublicKey(record.mint)).toBase58()}`,
    pumpUrl: `https://pump.fun/coin/${record.mint}`, removedReason: null, agents: [],
  };
}

export function listPumpTokens(query: LaunchQuery) {
  const search = (query.search ?? "").replace(/^\$/, "").toLowerCase();
  const markets = new MarketStore();
  const tokens = launchStore().list().filter((record) => record.confirmed && markets.visible(record.mint) && (!search || [record.form.name, record.form.ticker, record.mint].some((value) => value.toLowerCase().includes(search)))).map(tokenOf);
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.max(1, Math.min(100, query.limit ?? 20));
  const rank = (token: TokenDetail) => query.sort === "marketCap" ? token.marketCapUsd : query.sort === "volume" ? token.volume24hUsd : query.sort === "holders" ? token.holders : query.sort === "graduating" ? token.bondingProgress : token.agentsInPlay;
  if (query.sort !== "newest") tokens.sort((a, b) => (rank(b) ?? -1) - (rank(a) ?? -1));
  return { tokens: tokens.slice(offset, offset + limit), total: tokens.length };
}

export async function getPumpToken(mint: string): Promise<TokenDetail | null> {
  const record = launchStore().getMint(mint);
  if (!record?.confirmed || !new MarketStore().visible(mint)) return null;
  const token = tokenOf(record);
  const connection = pumpConnection();
  await mainnet(connection);
  const sharing = await connection.getAccountInfo(pump.feeSharingConfigPda(new PublicKey(mint)));
  try {
    if (!sharing?.owner.equals(pump.PUMP_FEE_PROGRAM_ID)) throw new Error();
    verifyFeeSharing(pump.PUMP_SDK.decodeSharingConfig(sharing), new PublicKey(mint));
  } catch { token.verification = "removed"; token.removedReason = "The locked creator fee configuration no longer matches Gamine."; }
  return token;
}
