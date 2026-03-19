import type { Hex } from "viem";

/**
 * Recovery App URL — same URL used by the browser extension.
 * Guardians visit this to sign and execute recovery.
 */
export const RECOVERY_APP_URL = "https://recovery.elytro.com/";

/**
 * Guardian info category key for the InfoRecorder contract.
 * keccak256(toBytes('GUARDIAN_INFO'))
 */
export const GUARDIAN_INFO_KEY =
  "0x1ace5ad304fe21562a90af48910fa441fc548c59f541c00cc8338faaa3de3990" as Hex;

/**
 * InfoRecorder contract address — same across all supported chains.
 * Stores plaintext guardian data via event logs.
 */
export const INFO_RECORDER_ADDRESS =
  "0xB21689a23048D39c72EFE96c320F46151f18b22F" as `0x${string}`;

/**
 * ABI for the InfoRecorder contract.
 * Used to record and query guardian data.
 */
export const ABI_RECOVERY_INFO_RECORDER = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "wallet",
        type: "address",
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "category",
        type: "bytes32",
      },
      { indexed: false, internalType: "bytes", name: "data", type: "bytes" },
    ],
    name: "DataRecorded",
    type: "event",
  },
  {
    inputs: [
      { internalType: "bytes32", name: "category", type: "bytes32" },
      { internalType: "bytes", name: "data", type: "bytes" },
    ],
    name: "recordData",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "addr", type: "address" },
      { internalType: "bytes32", name: "category", type: "bytes32" },
    ],
    name: "latestRecordAt",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * Storage keys for recovery-related local data.
 */
export const RECOVERY_RECORD_STORAGE_KEY = "recovery-record";
export const GUARDIAN_LABELS_STORAGE_KEY = "guardian-labels";

/**
 * Error codes for recovery operations.
 */
export const ERR_RECOVERY_NOT_SETUP = -32020;
export const ERR_RECOVERY_INVALID_PARAMS = -32021;
export const ERR_RECOVERY_NO_RECORD = -32022;
export const ERR_ACCOUNT_RECOVERING = -32023;
