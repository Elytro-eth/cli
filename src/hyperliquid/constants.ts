import type { Address } from 'viem';

// ─── API Endpoints ───────────────────────────────────────────────────────────

export const HL_MAINNET_API = 'https://api.hyperliquid.xyz';
export const HL_TESTNET_API = 'https://api.hyperliquid-testnet.xyz';

export function hlApiBase(network: HlNetwork): string {
  return network === 'Mainnet' ? HL_MAINNET_API : HL_TESTNET_API;
}

export type HlNetwork = 'Mainnet' | 'Testnet';

// ─── Chain Identifiers ───────────────────────────────────────────────────────

/** Arbitrum One — used in signatureChainId for user-signed actions */
export const ARBITRUM_CHAIN_ID = 42161;
export const ARBITRUM_CHAIN_ID_HEX = '0xa4b1';

/** Hyperliquid internal chain ID for L1 action EIP-712 domain */
export const HL_L1_CHAIN_ID = 1337;

// ─── EIP-712 Domains ─────────────────────────────────────────────────────────

export const HL_L1_DOMAIN = {
  name: 'Exchange',
  version: '1',
  chainId: HL_L1_CHAIN_ID,
  verifyingContract: '0x0000000000000000000000000000000000000000' as Address,
} as const;

export const HL_SIGN_TX_DOMAIN = {
  name: 'HyperliquidSignTransaction',
  version: '1',
  chainId: ARBITRUM_CHAIN_ID,
  verifyingContract: '0x0000000000000000000000000000000000000000' as Address,
} as const;

// ─── On-chain Addresses (Arbitrum One) ───────────────────────────────────────
// Verify against https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/bridge

/** USDC (native) on Arbitrum One — the token deposited into Hyperliquid */
export const USDC_ARBITRUM: Address = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

/**
 * Hyperliquid bridge contract on Arbitrum One.
 * Source: https://arbiscan.io/address/0x2Df1c51E09aECf9cacB7bc98cB1d57bc8CEB434
 */
export const HL_BRIDGE_ARBITRUM: Address = '0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7';

// ─── Agent Wallet Limits ──────────────────────────────────────────────────────

export const HL_MAX_UNNAMED_AGENTS = 1;
export const HL_MAX_NAMED_AGENTS = 3;

// ─── Deposit / Withdrawal ─────────────────────────────────────────────────────

export const HL_USDC_DECIMALS = 6;
export const HL_WITHDRAWAL_FEE_USDC = 1; // ~$1 fee

// ─── Storage Key Prefixes ────────────────────────────────────────────────────

export const HL_STORE_PREFIX = 'hyperliquid';
export const HL_ACCOUNTS_KEY = `${HL_STORE_PREFIX}/accounts`;
export const HL_AGENTS_KEY_PREFIX = `${HL_STORE_PREFIX}/agents`;

// ─── Environment ─────────────────────────────────────────────────────────────

export function defaultHlNetwork(): HlNetwork {
  return 'Mainnet';
}
