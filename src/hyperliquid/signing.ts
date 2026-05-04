import { encode as msgpackEncode } from '@msgpack/msgpack';
import { keccak256, hashTypedData, toBytes, bytesToHex, recoverAddress } from 'viem';
import type { Address, Hex } from 'viem';
import type { KeyringService } from '../services/keyring.js';
import type { HlSignature } from './types.js';
import type { HlNetwork } from './constants.js';
import { HL_L1_DOMAIN, HL_SIGN_TX_DOMAIN, ARBITRUM_CHAIN_ID_HEX } from './constants.js';

// ─── EIP-712 type definitions for user-signed actions ────────────────────────

const USD_SEND_TYPES = {
  'HyperliquidTransaction:UsdSend': [
    { name: 'hyperliquidChain', type: 'string' },
    { name: 'destination', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'time', type: 'uint64' },
  ],
} as const;

const SPOT_SEND_TYPES = {
  'HyperliquidTransaction:SpotSend': [
    { name: 'hyperliquidChain', type: 'string' },
    { name: 'destination', type: 'string' },
    { name: 'token', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'time', type: 'uint64' },
  ],
} as const;

const WITHDRAW_TYPES = {
  'HyperliquidTransaction:Withdraw': [
    { name: 'hyperliquidChain', type: 'string' },
    { name: 'destination', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'time', type: 'uint64' },
  ],
} as const;

const USD_CLASS_TRANSFER_TYPES = {
  'HyperliquidTransaction:UsdClassTransfer': [
    { name: 'hyperliquidChain', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'toPerp', type: 'bool' },
    { name: 'nonce', type: 'uint64' },
  ],
} as const;

const APPROVE_AGENT_TYPES = {
  'HyperliquidTransaction:ApproveAgent': [
    { name: 'hyperliquidChain', type: 'string' },
    { name: 'agentAddress', type: 'string' },
    { name: 'agentName', type: 'string' },
    { name: 'nonce', type: 'uint64' },
  ],
} as const;

const APPROVE_BUILDER_FEE_TYPES = {
  'HyperliquidTransaction:ApproveBuilderFee': [
    { name: 'hyperliquidChain', type: 'string' },
    { name: 'maxFeeRate', type: 'string' },
    { name: 'builder', type: 'string' },
    { name: 'nonce', type: 'uint64' },
  ],
} as const;

const AGENT_TYPES = {
  Agent: [
    { name: 'source', type: 'string' },
    { name: 'connectionId', type: 'bytes32' },
  ],
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a float to a canonical wire-format string for Hyperliquid.
 * Rules (from official Python SDK float_to_wire):
 *   - 8 decimal places max
 *   - Strip trailing zeros
 *   - Must not lose more than 1e-12 precision vs input
 */
export function floatToWire(n: number): string {
  const str = n.toFixed(8);
  const parsed = parseFloat(str);
  if (Math.abs(parsed - n) >= 1e-12) {
    throw new Error(`floatToWire: precision loss converting ${n}`);
  }
  // Strip trailing zeros but keep at least one decimal place
  return str.replace(/\.?0+$/, '') || '0';
}

/**
 * Pack nonce as 8-byte big-endian buffer.
 */
function packNonce(nonce: number): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setUint32(0, Math.floor(nonce / 0x100000000), false);
  view.setUint32(4, nonce >>> 0, false);
  return buf;
}

function packOptionalAddress(addr?: string): Uint8Array {
  if (!addr) return new Uint8Array([0]);
  const addrBytes = toBytes(addr as Address);
  const result = new Uint8Array(21);
  result[0] = 1;
  result.set(addrBytes, 1);
  return result;
}

function packOptionalTimestamp(ts?: number): Uint8Array {
  if (ts === undefined || ts === null) return new Uint8Array([0]);
  const buf = new Uint8Array(9);
  buf[0] = 1;
  const view = new DataView(buf.buffer);
  view.setUint32(1, Math.floor(ts / 0x100000000), false);
  view.setUint32(5, ts >>> 0, false);
  return buf;
}

/**
 * Compute the action hash used in phantom agent construction.
 * Formula: keccak256(msgpack(action) + nonce_8be + vault_marker + expiry_marker)
 */
function computeActionHash(
  action: Record<string, unknown>,
  nonce: number,
  vaultAddress?: string,
  expiresAfter?: number,
): Hex {
  const packed = msgpackEncode(action);
  const nonceBuf = packNonce(nonce);
  const vaultBuf = packOptionalAddress(vaultAddress);

  const parts: Uint8Array[] = [packed, nonceBuf, vaultBuf];
  if (expiresAfter !== undefined) {
    parts.push(packOptionalTimestamp(expiresAfter));
  }

  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }

  return keccak256(combined);
}

/**
 * Parse a viem signature hex into r/s/v components expected by Hyperliquid.
 */
function parseSignature(sig: Hex): HlSignature {
  // viem returns 65-byte hex: r(32) + s(32) + v(1)
  const raw = sig.startsWith('0x') ? sig.slice(2) : sig;
  const r = '0x' + raw.slice(0, 64);
  const s = '0x' + raw.slice(64, 128);
  const vHex = parseInt(raw.slice(128, 130), 16);
  // Normalize v: EIP-155 gives 27/28, some wallets give 0/1
  const v = vHex < 27 ? vHex + 27 : vHex;
  return { r, s, v };
}

// ─── Public Signing API ───────────────────────────────────────────────────────

/**
 * Sign a Hyperliquid L1 trading action (order, cancel, modify, etc.).
 *
 * Uses the phantom-agent EIP-712 scheme with chainId 1337.
 * The action must have fields in the exact order expected by Hyperliquid's
 * msgpack serializer — callers are responsible for field ordering.
 */
export async function signL1Action(
  keyring: KeyringService,
  action: Record<string, unknown>,
  nonce: number,
  network: HlNetwork,
  vaultAddress?: string,
  expiresAfter?: number,
): Promise<HlSignature> {
  const connectionId = computeActionHash(action, nonce, vaultAddress, expiresAfter);

  const phantomAgent = {
    source: network === 'Mainnet' ? 'a' : 'b',
    connectionId,
  };

  const digest = hashTypedData({
    domain: HL_L1_DOMAIN,
    types: AGENT_TYPES,
    primaryType: 'Agent',
    message: phantomAgent,
  });

  const sig = await keyring.signDigest(digest);
  const parsed = parseSignature(sig);

  // DEBUG: recover signer to verify key matches expected address
  const recovered = await recoverAddress({ hash: digest, signature: sig });
  process.stderr.write(`[DEBUG signL1Action] keyring.currentOwner=${keyring.currentOwner} recovered=${recovered}\n`);

  return parsed;
}

/**
 * Sign a Hyperliquid user-signed action (fund movement, account management).
 *
 * Uses direct EIP-712 with the HyperliquidSignTransaction domain (chainId 42161).
 */
export async function signUserAction(
  keyring: KeyringService,
  primaryType: string,
  types: Record<string, ReadonlyArray<{ readonly name: string; readonly type: string }>>,
  message: Record<string, unknown>,
): Promise<HlSignature> {
  const digest = hashTypedData({
    domain: HL_SIGN_TX_DOMAIN,
    types: types as Record<string, Array<{ name: string; type: string }>>,
    primaryType,
    message,
  });

  const sig = await keyring.signDigest(digest);
  return parseSignature(sig);
}

// ─── Concrete user-signed action helpers ─────────────────────────────────────

export async function signUsdSend(
  keyring: KeyringService,
  params: { destination: string; amount: string; time: number; hyperliquidChain: HlNetwork },
): Promise<HlSignature> {
  return signUserAction(keyring, 'HyperliquidTransaction:UsdSend', USD_SEND_TYPES, {
    hyperliquidChain: params.hyperliquidChain,
    destination: params.destination.toLowerCase(),
    amount: params.amount,
    time: params.time,
  });
}

export async function signSpotSend(
  keyring: KeyringService,
  params: { destination: string; token: string; amount: string; time: number; hyperliquidChain: HlNetwork },
): Promise<HlSignature> {
  return signUserAction(keyring, 'HyperliquidTransaction:SpotSend', SPOT_SEND_TYPES, {
    hyperliquidChain: params.hyperliquidChain,
    destination: params.destination.toLowerCase(),
    token: params.token,
    amount: params.amount,
    time: params.time,
  });
}

export async function signWithdraw(
  keyring: KeyringService,
  params: { destination: string; amount: string; time: number; hyperliquidChain: HlNetwork },
): Promise<HlSignature> {
  return signUserAction(keyring, 'HyperliquidTransaction:Withdraw', WITHDRAW_TYPES, {
    hyperliquidChain: params.hyperliquidChain,
    destination: params.destination.toLowerCase(),
    amount: params.amount,
    time: params.time,
  });
}

export async function signUsdClassTransfer(
  keyring: KeyringService,
  params: { amount: string; toPerp: boolean; nonce: number; hyperliquidChain: HlNetwork },
): Promise<HlSignature> {
  return signUserAction(
    keyring,
    'HyperliquidTransaction:UsdClassTransfer',
    USD_CLASS_TRANSFER_TYPES,
    {
      hyperliquidChain: params.hyperliquidChain,
      amount: params.amount,
      toPerp: params.toPerp,
      nonce: params.nonce,
    },
  );
}

export async function signApproveAgent(
  keyring: KeyringService,
  params: {
    agentAddress: string;
    agentName: string;
    nonce: number;
    hyperliquidChain: HlNetwork;
  },
): Promise<HlSignature> {
  return signUserAction(keyring, 'HyperliquidTransaction:ApproveAgent', APPROVE_AGENT_TYPES, {
    hyperliquidChain: params.hyperliquidChain,
    agentAddress: params.agentAddress.toLowerCase(),
    agentName: params.agentName,
    nonce: params.nonce,
  });
}

export async function signApproveBuilderFee(
  keyring: KeyringService,
  params: {
    maxFeeRate: string;
    builder: string;
    nonce: number;
    hyperliquidChain: HlNetwork;
  },
): Promise<HlSignature> {
  return signUserAction(
    keyring,
    'HyperliquidTransaction:ApproveBuilderFee',
    APPROVE_BUILDER_FEE_TYPES,
    {
      hyperliquidChain: params.hyperliquidChain,
      maxFeeRate: params.maxFeeRate,
      builder: params.builder.toLowerCase(),
      nonce: params.nonce,
    },
  );
}
