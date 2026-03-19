import type { Address, Hex } from 'viem';

// ─── Account ────────────────────────────────────────────────────────

export interface AccountInfo {
  /** Smart account contract address */
  address: Address;
  /** Chain ID this account is deployed on (or will be) */
  chainId: number;
  /** Human-readable alias (e.g. "swift-panda") */
  alias: string;
  /** EOA owner address — internal only, never exposed to user */
  owner: Address;
  /** CREATE2 index — allows multiple accounts per owner per chain */
  index: number;
  /** Whether the smart contract has been deployed on-chain */
  isDeployed: boolean;
  /** Whether social recovery guardians have been set */
  isRecoveryEnabled: boolean;
  /**
   * Temporary security intent from `account create`.
   * Consumed and deleted by `activate`. Existence = not yet executed.
   */
  securityIntent?: SecurityIntent;
  /**
   * Persistent on-chain security state, written by `activate`.
   * Absent = hook never installed via create→activate flow.
   */
  securityStatus?: SecurityStatus;
  /**
   * Active recovery state — present when a recovery has been initiated.
   * Null = recovery was cleared/completed. Absent = never initiated.
   */
  activeRecovery?: ActiveRecoveryInfo | null;
}

// ─── Security Intent (temporary, create → activate) ────────────

/**
 * User's security preferences captured at `account create` time.
 * Consumed and **deleted** during `activate` — existence implies
 * "not yet executed". Per-account, per-chain.
 *
 * After activate, relevant state moves to `SecurityStatus`.
 */
export interface SecurityIntent {
  /** Email for OTP-based 2FA */
  email?: string;
  /** Daily spending limit in whole USD */
  dailyLimitUsd?: number;
  /** Transient backend binding ID from requestEmailBinding attempt */
  emailBindingId?: string;
}

// ─── Security Status (persistent, post-activate) ───────────────

/**
 * On-chain security state tracked locally after `activate`.
 * Survives indefinitely — reflects what actually happened on-chain.
 * Backend-side state (email, spending limit) is queried via SecurityHookService.
 */
export interface SecurityStatus {
  /** Whether the SecurityHook was installed during activate */
  hookInstalled: boolean;
}

// ─── Keyring ────────────────────────────────────────────────────────

export interface OwnerKey {
  /** EOA address derived from the private key */
  id: Address;
  /** Hex-encoded private key (stored encrypted on disk) */
  key: Hex;
}

export interface VaultData {
  owners: OwnerKey[];
  currentOwnerId: Address;
}

export interface EncryptedData {
  data: string;
  iv: string;
  salt: string;
  /** 1 = PBKDF2 password-based, 2 = raw vault key (via SecretProvider). Absent treated as 1. */
  version?: 1 | 2;
}

// ─── Chain ──────────────────────────────────────────────────────────

export interface ChainConfig {
  id: number;
  name: string;
  /** RPC endpoint URL */
  endpoint: string;
  /** Pimlico bundler URL */
  bundler: string;
  /** Native currency symbol */
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  /** Block explorer URL */
  blockExplorer?: string;
  /** Stablecoin definitions for this chain */
  stablecoins?: { name: string; address: string[] }[];
}

// ─── Config ─────────────────────────────────────────────────────────

export interface CliConfig {
  /** Currently selected chain ID */
  currentChainId: number;
  /** Available chains */
  chains: ChainConfig[];
  /** GraphQL API endpoint */
  graphqlEndpoint: string;
}

/** User-configured API keys persisted in ~/.elytro/user-keys.json */
export interface UserKeys {
  /** Alchemy API key — unlocks higher RPC rate limits */
  alchemyKey?: string;
  /** Pimlico API key — unlocks higher bundler rate limits */
  pimlicoKey?: string;
}

// ─── Storage ────────────────────────────────────────────────────────

export interface StorageAdapter {
  load<T>(key: string): Promise<T | null>;
  save<T>(key: string, data: T): Promise<void>;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

// ─── UserOperation (ERC-4337) ───────────────────────────────────────

export interface ElytroUserOperation {
  sender: Address;
  nonce: bigint;
  factory: Address | null;
  factoryData: Hex | null;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymaster: Address | null;
  paymasterVerificationGasLimit: bigint | null;
  paymasterPostOpGasLimit: bigint | null;
  paymasterData: Hex | null;
  signature: Hex;
}

// ─── Sponsor ────────────────────────────────────────────────────────

export interface SponsorResult {
  paymaster: Address;
  paymasterData: Hex;
  callGasLimit: string;
  verificationGasLimit: string;
  preVerificationGas: string;
  paymasterVerificationGasLimit?: string;
  paymasterPostOpGasLimit?: string;
}

// ─── UserOp Receipt ─────────────────────────────────────────────────

export interface UserOpReceipt {
  userOpHash: Hex;
  entryPoint: Address;
  sender: Address;
  nonce: string;
  paymaster?: Address;
  actualGasCost: string;
  actualGasUsed: string;
  success: boolean;
  reason?: string;
  receipt?: {
    transactionHash: Hex;
    blockNumber: string;
    blockHash: Hex;
    gasUsed: string;
  };
}

// ─── Security Hook ─────────────────────────────────────────────────

export interface HookStatus {
  installed: boolean;
  hookAddress: Address;
  capabilities: {
    preUserOpValidation: boolean;
    preIsValidSignature: boolean;
  };
  forceUninstall: {
    initiated: boolean;
    canExecute: boolean;
    /** ISO timestamp or null */
    availableAfter: string | null;
  };
}

export interface SecurityProfile {
  email?: string;
  emailVerified?: boolean;
  maskedEmail?: string;
  dailyLimitUsdCents?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface HookError {
  code?: string;
  challengeId?: string;
  currentSpendUsdCents?: number;
  dailyLimitUsdCents?: number;
  maskedEmail?: string;
  otpExpiresAt?: string;
  projectedSpendUsdCents?: number;
  message?: string;
}

// ─── Social Recovery ────────────────────────────────────────────────

export interface RecoveryContact {
  address: Address;
  label?: string;
}

export interface RecoveryContactsInfo {
  contacts: Address[];
  threshold: number;
}

export interface RecoveryBackup {
  address: Address;
  chainId: number;
  contacts: RecoveryContact[];
  threshold: string;
  exportedAt: string;
}

export interface LocalRecoveryRecord {
  walletAddress: Address;
  chainId: number;
  newOwner: Address;
  recoveryId: string;
  approveHash: string;
  contacts: RecoveryContact[];
  threshold: number;
  fromBlock: string;
  recoveryUrl: string;
}

export enum RecoveryStatus {
  WAITING_FOR_SIGNATURE = 'WAITING_FOR_SIGNATURE',
  SIGNATURE_COMPLETED = 'SIGNATURE_COMPLETED',
  RECOVERY_STARTED = 'RECOVERY_STARTED',
  RECOVERY_READY = 'RECOVERY_READY',
  RECOVERY_COMPLETED = 'RECOVERY_COMPLETED',
}

export interface RecoveryStatusResult {
  walletAddress: Address;
  newOwner: Address;
  status: RecoveryStatus;
  contacts: Array<RecoveryContact & { signed: boolean }>;
  signedCount: number;
  threshold: number;
  recoveryUrl: string;
  /** Unix timestamp — only present when RECOVERY_STARTED */
  validTime: number | null;
  /** Seconds remaining — only present when RECOVERY_STARTED */
  remainingSeconds: number | null;
}

export interface ActiveRecoveryInfo {
  status: RecoveryStatus;
  /** Internal — the EOA that will take control after recovery */
  newOwner: Address;
  recoveryId: string;
  lastCheckedAt: number;
}

// ─── Nullable helper ────────────────────────────────────────────────

export type Nullable<T> = T | null | undefined;
