import type { Address } from 'viem';
import type { FileStore } from '../storage/fileStore.js';
import type { HlAccountInfo, HlAgentInfo } from './types.js';
import { HL_ACCOUNTS_KEY, HL_AGENTS_KEY_PREFIX } from './constants.js';

type HlAccountsFile = Record<string, HlAccountInfo>;

/**
 * Persists Hyperliquid account metadata and agent info under ~/.elytro/hyperliquid/.
 * Uses the existing FileStore for atomic writes and consistent permissions.
 */
export class HlAccountStore {
  private readonly store: FileStore;

  constructor(store: FileStore) {
    this.store = store;
  }

  private agentKey(ownerAddress: Address): string {
    return `${HL_AGENTS_KEY_PREFIX}/${ownerAddress.toLowerCase()}`;
  }

  // ─── HL Account (Elytro account → Hyperliquid mapping) ───────────────────

  async getAllAccounts(): Promise<HlAccountsFile> {
    return (await this.store.load<HlAccountsFile>(HL_ACCOUNTS_KEY)) ?? {};
  }

  async getAccount(elytroAccountAddress: Address): Promise<HlAccountInfo | null> {
    const all = await this.getAllAccounts();
    return all[elytroAccountAddress.toLowerCase()] ?? null;
  }

  async setAccount(info: HlAccountInfo): Promise<void> {
    const all = await this.getAllAccounts();
    all[info.elytroAccountAddress.toLowerCase()] = {
      ...info,
      lastUpdatedAt: new Date().toISOString(),
    };
    await this.store.save(HL_ACCOUNTS_KEY, all);
  }

  async removeAccount(elytroAccountAddress: Address): Promise<void> {
    const all = await this.getAllAccounts();
    delete all[elytroAccountAddress.toLowerCase()];
    await this.store.save(HL_ACCOUNTS_KEY, all);
  }

  // ─── Agent Info ───────────────────────────────────────────────────────────

  async getAgentInfo(ownerAddress: Address): Promise<HlAgentInfo | null> {
    return this.store.load<HlAgentInfo>(this.agentKey(ownerAddress));
  }

  async setAgentInfo(info: HlAgentInfo): Promise<void> {
    await this.store.save(this.agentKey(info.ownerAddress), info);
  }

  async removeAgentInfo(ownerAddress: Address): Promise<void> {
    await this.store.remove(this.agentKey(ownerAddress));
  }
}
