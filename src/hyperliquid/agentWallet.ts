import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import type { Address } from 'viem';
import type { KeyringService } from '../services/keyring.js';
import type { AccountInfo } from '../types/index.js';
import { HlExchangeClient } from './exchangeClient.js';
import { HlAccountStore } from './accountMapping.js';
import type { HlAgentInfo } from './types.js';
import type { HlNetwork } from './constants.js';
import {
  HyperliquidError,
  HL_ERR_AGENT_NOT_CONFIGURED,
  HL_ERR_INTERNAL,
} from './errors.js';

/**
 * Agent wallet key ID format stored in KeyringService vault.
 * Uses a namespaced address so it doesn't collide with Elytro account owners.
 * The "address" stored is the agent's EOA address (not a real Elytro account).
 */
export function agentKeyId(ownerAddress: Address, agentAddress: Address): string {
  return `hl-agent-${ownerAddress.toLowerCase()}-${agentAddress.toLowerCase()}`;
}

/**
 * Create a new Hyperliquid agent wallet keypair and store it in the vault.
 *
 * The agent private key is stored in KeyringService as an extra owner entry.
 * The owner address slot is a synthetic identifier (not a real Elytro account).
 */
export async function createAgentKey(
  keyring: KeyringService,
): Promise<{ agentAddress: Address }> {
  const agentAddress = await keyring.addOwner();
  return { agentAddress };
}

/**
 * Authorize a Hyperliquid agent wallet on-chain.
 *
 * Prerequisites:
 *   - keyring must be switched to the OWNER key (not the agent)
 *   - agentAddress must already exist in the vault (via createAgentKey)
 */
export async function authorizeAgent(
  keyring: KeyringService,
  store: HlAccountStore,
  account: AccountInfo,
  agentAddress: Address,
  agentName: string,
  network: HlNetwork,
  hlMainAddress?: Address,
): Promise<HlAgentInfo> {
  const ownerAddress = hlMainAddress ?? (account.owner as Address);

  // Ensure keyring is on the HL main account key
  if (keyring.currentOwner?.toLowerCase() !== ownerAddress.toLowerCase()) {
    await keyring.switchOwner(ownerAddress);
  }

  // Submit approveAgent action to Hyperliquid
  const exchangeClient = new HlExchangeClient(network);
  await exchangeClient.approveAgent(keyring, { agentAddress, agentName });

  const agentInfo: HlAgentInfo = {
    agentAddress,
    agentName,
    ownerAddress,
    authorizedAt: new Date().toISOString(),
    network,
  };

  await store.setAgentInfo(agentInfo);

  // Update account mapping with agent address
  const hlAccount = await store.getAccount(account.address as Address);
  if (hlAccount) {
    await store.setAccount({
      ...hlAccount,
      agentAddress,
      agentName,
    });
  }

  return agentInfo;
}

/**
 * Switch keyring to the agent key for a given owner.
 * Saves and restores the current owner so callers can restore state.
 */
export async function withAgentKey<T>(
  keyring: KeyringService,
  store: HlAccountStore,
  ownerAddress: Address,
  fn: (agentAddress: Address) => Promise<T>,
): Promise<T> {
  const agentInfo = await store.getAgentInfo(ownerAddress);
  if (!agentInfo) {
    throw new HyperliquidError(
      HL_ERR_AGENT_NOT_CONFIGURED,
      `No Hyperliquid agent configured for owner ${ownerAddress}. ` +
        'Run `elytro hyperliquid signer create-agent` first.',
    );
  }

  const previousOwner = keyring.currentOwner;

  try {
    await keyring.switchOwner(agentInfo.agentAddress);
    return await fn(agentInfo.agentAddress);
  } finally {
    if (previousOwner) {
      await keyring.switchOwner(previousOwner);
    }
  }
}

/**
 * Switch keyring to the agent key if one is configured; otherwise fall back
 * to the owner key. Use this for trading actions that support both signers.
 */
export async function withSignerKey<T>(
  keyring: KeyringService,
  store: HlAccountStore,
  ownerAddress: Address,
  fn: () => Promise<T>,
): Promise<T> {
  const agentInfo = await store.getAgentInfo(ownerAddress);
  if (agentInfo) {
    const previousOwner = keyring.currentOwner;
    try {
      await keyring.switchOwner(agentInfo.agentAddress);
      return await fn();
    } finally {
      if (previousOwner) {
        await keyring.switchOwner(previousOwner);
      }
    }
  }
  return withOwnerKey(keyring, ownerAddress, fn);
}

/**
 * Switch keyring to the owner key, run fn, then restore.
 */
export async function withOwnerKey<T>(
  keyring: KeyringService,
  ownerAddress: Address,
  fn: () => Promise<T>,
): Promise<T> {
  const previousOwner = keyring.currentOwner;
  try {
    await keyring.switchOwner(ownerAddress);
    return await fn();
  } finally {
    if (previousOwner && previousOwner !== ownerAddress) {
      await keyring.switchOwner(previousOwner);
    }
  }
}
