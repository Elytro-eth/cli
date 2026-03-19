import type { Address, Hex } from 'viem';
import { zeroHash, padHex } from 'viem';
import type { FileStore } from '../storage';
import type { SDKService } from './sdk';
import type { ChainService } from './chain';
import type { AccountService } from './account';
import type { KeyringService } from './keyring';
import type { WalletClientService } from './walletClient';
import type {
  RecoveryContact,
  RecoveryContactsInfo,
  RecoveryBackup,
  LocalRecoveryRecord,
  RecoveryStatusResult,
  ChainConfig,
  AccountInfo,
  ActiveRecoveryInfo,
} from '../types';
import { RecoveryStatus } from '../types';
import {
  RECOVERY_APP_URL,
  RECOVERY_RECORD_STORAGE_KEY,
  GUARDIAN_LABELS_STORAGE_KEY,
} from '../constants/recovery';
import { encodeSetGuardian, encodeRecordGuardianInfo } from '../utils/contracts/socialRecovery';

/**
 * RecoveryService — social recovery business logic.
 *
 * Handles:
 * - Guardian contacts setup (generate UserOp transactions)
 * - Recovery initiation (off-chain computation + URL generation)
 * - Recovery status querying (read-only RPC calls)
 * - Local recovery record management
 * - Recovery guard (block writes on recovering accounts)
 */
export class RecoveryService {
  private store: FileStore;
  private sdk: SDKService;
  private chain: ChainService;
  private account: AccountService;
  private keyring: KeyringService;
  private walletClient: WalletClientService;

  constructor(deps: {
    store: FileStore;
    sdk: SDKService;
    chain: ChainService;
    account: AccountService;
    keyring: KeyringService;
    walletClient: WalletClientService;
  }) {
    this.store = deps.store;
    this.sdk = deps.sdk;
    this.chain = deps.chain;
    this.account = deps.account;
    this.keyring = deps.keyring;
    this.walletClient = deps.walletClient;
  }

  // ─── Contacts Query ─────────────────────────────────────────────

  /**
   * Query guardian contacts from chain (InfoRecorder event logs).
   * Returns null if no contacts are recorded.
   */
  async queryContacts(
    walletAddress: Address,
    chainConfig: ChainConfig
  ): Promise<RecoveryContactsInfo | null> {
    return this.sdk.queryRecoveryContacts(walletAddress, chainConfig);
  }

  /**
   * Read on-chain guardian hash and nonce from SocialRecoveryModule.
   */
  async getRecoveryInfo(
    walletAddress: Address,
    chainConfig: ChainConfig
  ): Promise<{ contactsHash: Hex; nonce: bigint; delayPeriod: bigint } | null> {
    return this.sdk.getRecoveryInfo(walletAddress, chainConfig);
  }

  /**
   * Calculate guardian hash from contact addresses and threshold.
   */
  calculateContactsHash(contacts: string[], threshold: number): Hex {
    return this.sdk.calculateGuardianHash(contacts, threshold);
  }

  /**
   * Check whether the contacts/threshold setting has changed vs on-chain state.
   */
  async isContactsSettingChanged(
    walletAddress: Address,
    contacts: string[],
    threshold: number,
    chainConfig: ChainConfig
  ): Promise<boolean> {
    const info = await this.sdk.getRecoveryInfo(walletAddress, chainConfig);
    if (!info) return true;

    const newHash = this.sdk.calculateGuardianHash(contacts, threshold);
    return info.contactsHash.toLowerCase() !== newHash.toLowerCase();
  }

  // ─── Contacts Write ─────────────────────────────────────────────

  /**
   * Generate transactions for setting guardian contacts.
   *
   * Always produces a setGuardian tx.
   * If !privacy, also includes a recordData tx to store plaintext contacts.
   */
  generateSetContactsTxs(
    contacts: string[],
    threshold: number,
    recoveryModuleAddress: Address,
    privacy: boolean
  ): Array<{ to: Address; value: string; data: Hex }> {
    const guardianHash = this.sdk.calculateGuardianHash(contacts, threshold);
    const txs: Array<{ to: Address; value: string; data: Hex }> = [
      encodeSetGuardian(guardianHash as Hex, recoveryModuleAddress),
    ];

    if (!privacy) {
      txs.push(encodeRecordGuardianInfo(contacts, threshold, zeroHash));
    }

    return txs;
  }

  // ─── Recovery Initiation ────────────────────────────────────────

  /**
   * Initiate recovery — purely off-chain.
   *
   * Computes recoveryId, approveHash, and generates the Recovery App URL.
   * No transactions are sent. The recovering device does not need to be the
   * wallet's current controller.
   */
  async initiateRecovery(params: {
    walletAddress: Address;
    chainId: number;
    newOwner: Address;
    contacts?: RecoveryContact[];
    threshold?: number;
    chainConfig: ChainConfig;
  }): Promise<{
    walletAddress: Address;
    newOwner: Address;
    chainId: number;
    recoveryId: Hex;
    approveHash: Hex;
    contacts: RecoveryContact[];
    threshold: number;
    recoveryUrl: string;
    fromBlock: bigint;
  }> {
    const { walletAddress, chainId, newOwner, chainConfig } = params;

    // Resolve contacts
    let contacts = params.contacts;
    let threshold = params.threshold;

    if (!contacts || contacts.length === 0) {
      const info = await this.sdk.queryRecoveryContacts(walletAddress, chainConfig);
      if (!info || info.contacts.length === 0) {
        throw new Error(
          'No guardian contacts found on-chain. Use --from-backup to provide them, ' +
            'or set contacts first with `elytro recovery contacts set`.'
        );
      }
      const labels = await this.getLocalLabels(walletAddress);
      contacts = info.contacts.map((addr) => ({
        address: addr,
        ...(labels[addr.toLowerCase()] ? { label: labels[addr.toLowerCase()] } : {}),
      }));
      threshold = info.threshold;
    }

    if (!threshold) throw new Error('Threshold is required.');

    // Get current nonce and block
    const nonce = await this.sdk.getRecoveryNonce(walletAddress, chainConfig);
    const { createPublicClient, http } = await import('viem');
    const client = createPublicClient({ transport: http(chainConfig.endpoint) });
    const fromBlock = await client.getBlockNumber();

    const newOwners: Address[] = [newOwner];

    // Compute IDs
    const recoveryId = this.sdk.getRecoveryOnchainID(walletAddress, nonce, newOwners, chainId);
    const approveHash = this.sdk.generateRecoveryApproveHash(walletAddress, nonce, newOwners, chainId);

    // Build recovery URL — matches extension's generateShareLink format
    const contactsParam = contacts.map((c) => c.address).join(',');
    const url = new URL(RECOVERY_APP_URL);
    url.searchParams.set('id', recoveryId);
    url.searchParams.set('address', walletAddress);
    url.searchParams.set('chainId', String(chainId));
    url.searchParams.set('hash', approveHash);
    url.searchParams.set('from', walletAddress);
    url.searchParams.set('owner', newOwner);
    url.searchParams.set('contacts', contactsParam);
    url.searchParams.set('threshold', String(threshold));

    const recoveryUrl = url.toString();

    // Persist local record
    const record: LocalRecoveryRecord = {
      walletAddress,
      chainId,
      newOwner,
      recoveryId,
      approveHash,
      contacts,
      threshold,
      fromBlock: fromBlock.toString(),
      recoveryUrl,
    };
    await this.saveLocalRecoveryRecord(record);

    return {
      walletAddress,
      newOwner,
      chainId,
      recoveryId: recoveryId as Hex,
      approveHash: approveHash as Hex,
      contacts,
      threshold,
      recoveryUrl,
      fromBlock,
    };
  }

  // ─── Recovery Status ────────────────────────────────────────────

  /**
   * Query recovery status using the local record.
   * Checks each guardian's signature and the on-chain operation state.
   */
  async queryRecoveryStatusFromLocal(chainConfig: ChainConfig): Promise<RecoveryStatusResult> {
    const record = await this.getLocalRecoveryRecord();
    if (!record) {
      throw new Error('No local recovery record. Run `elytro recovery initiate` first.');
    }

    const fromBlock = BigInt(record.fromBlock);
    const recoveryId = record.recoveryId as Hex;
    const approveHash = record.approveHash as Hex;
    const walletAddress = record.walletAddress;
    const newOwner = record.newOwner;

    // Check each guardian's signature
    const contactsWithSigned = await Promise.all(
      record.contacts.map(async (contact) => {
        const signed = await this.sdk.checkIsGuardianSigned(
          contact.address,
          fromBlock,
          approveHash,
          chainConfig
        );
        return { ...contact, signed };
      })
    );

    const signedCount = contactsWithSigned.filter((c) => c.signed).length;

    // Check on-chain operation state
    const operationState = await this.sdk.getOperationState(walletAddress, recoveryId, chainConfig);

    // Check if recovery already completed (owner changed)
    const isCompleted = await this.sdk.checkIsOwner(walletAddress, newOwner, chainConfig);
    if (isCompleted) {
      return {
        walletAddress,
        newOwner,
        status: RecoveryStatus.RECOVERY_COMPLETED,
        contacts: contactsWithSigned,
        signedCount,
        threshold: record.threshold,
        recoveryUrl: record.recoveryUrl,
        validTime: null,
        remainingSeconds: null,
      };
    }

    // Determine status from operation state
    // operationState: 0=unset, 1=pending/started, 2=ready
    let status: RecoveryStatus;
    let validTime: number | null = null;
    let remainingSeconds: number | null = null;

    if (operationState === 2) {
      status = RecoveryStatus.RECOVERY_READY;
    } else if (operationState === 1) {
      const validTimeBigInt = await this.sdk.getOperationValidTime(
        walletAddress,
        recoveryId,
        chainConfig
      );
      validTime = Number(validTimeBigInt);
      const nowSec = Math.floor(Date.now() / 1000);
      remainingSeconds = validTime > nowSec ? validTime - nowSec : 0;
      status = RecoveryStatus.RECOVERY_STARTED;
    } else if (signedCount >= record.threshold) {
      status = RecoveryStatus.SIGNATURE_COMPLETED;
    } else {
      status = RecoveryStatus.WAITING_FOR_SIGNATURE;
    }

    return {
      walletAddress,
      newOwner,
      status,
      contacts: contactsWithSigned,
      signedCount,
      threshold: record.threshold,
      recoveryUrl: record.recoveryUrl,
      validTime,
      remainingSeconds,
    };
  }

  // ─── Recovery Guard ─────────────────────────────────────────────

  /**
   * Check and update the activeRecovery state for an account.
   *
   * Called at the start of every recovery command. Returns the activeRecovery
   * info if the account is currently recovering, null otherwise.
   * Side-effect: updates account.activeRecovery and persists if status changed.
   */
  async checkAndUpdateRecoveryState(
    account: AccountInfo,
    chainConfig: ChainConfig
  ): Promise<ActiveRecoveryInfo | null> {
    if (!account.activeRecovery) return null;

    const ar = account.activeRecovery;
    const now = Date.now();

    // Re-check at most once per 30 seconds to avoid hammering RPC
    if (now - ar.lastCheckedAt < 30_000) {
      return ar.status === RecoveryStatus.RECOVERY_COMPLETED ? null : ar;
    }

    // Re-query status
    const isCompleted = await this.sdk.checkIsOwner(
      account.address,
      ar.newOwner,
      chainConfig
    );

    if (isCompleted) {
      account.activeRecovery = null;
      await this.account.persistAccountUpdate(account);
      return null;
    }

    // Update last checked timestamp
    ar.lastCheckedAt = now;
    await this.account.persistAccountUpdate(account);
    return ar;
  }

  /**
   * Mark an account as actively recovering.
   */
  async setActiveRecovery(
    account: AccountInfo,
    recoveryId: string,
    newOwner: Address
  ): Promise<void> {
    account.activeRecovery = {
      status: RecoveryStatus.WAITING_FOR_SIGNATURE,
      newOwner,
      recoveryId,
      lastCheckedAt: Date.now(),
    };
    await this.account.persistAccountUpdate(account);
  }

  // ─── Local Record Management ────────────────────────────────────

  async getLocalRecoveryRecord(): Promise<LocalRecoveryRecord | null> {
    return this.store.load<LocalRecoveryRecord>(RECOVERY_RECORD_STORAGE_KEY);
  }

  async saveLocalRecoveryRecord(record: LocalRecoveryRecord): Promise<void> {
    await this.store.save(RECOVERY_RECORD_STORAGE_KEY, record);
  }

  async clearLocalRecoveryRecord(): Promise<void> {
    await this.store.remove(RECOVERY_RECORD_STORAGE_KEY);
  }

  // ─── Backup ─────────────────────────────────────────────────────

  /**
   * Export guardian info + local labels as a portable backup.
   */
  async exportBackup(
    walletAddress: Address,
    chainId: number,
    chainConfig: ChainConfig
  ): Promise<RecoveryBackup> {
    const contactsInfo = await this.sdk.queryRecoveryContacts(walletAddress, chainConfig);
    if (!contactsInfo || contactsInfo.contacts.length === 0) {
      throw new Error(
        'No guardian contacts found on-chain. Set contacts first with `elytro recovery contacts set`.'
      );
    }

    const labels = await this.getLocalLabels(walletAddress);
    const contacts: RecoveryContact[] = contactsInfo.contacts.map((addr) => ({
      address: addr,
      ...(labels[addr.toLowerCase()] ? { label: labels[addr.toLowerCase()] } : {}),
    }));

    return {
      address: walletAddress,
      chainId,
      contacts,
      threshold: String(contactsInfo.threshold),
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * Parse and validate a backup file.
   */
  parseBackupFile(content: string): RecoveryBackup {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('Invalid backup file: not valid JSON.');
    }

    const b = parsed as Record<string, unknown>;
    if (!b.address || !b.chainId || !Array.isArray(b.contacts) || !b.threshold) {
      throw new Error(
        'Invalid backup file: missing required fields (address, chainId, contacts, threshold).'
      );
    }

    return b as unknown as RecoveryBackup;
  }

  // ─── Local Labels ───────────────────────────────────────────────

  async getLocalLabels(walletAddress: Address): Promise<Record<string, string>> {
    const key = `${GUARDIAN_LABELS_STORAGE_KEY}-${walletAddress.toLowerCase()}`;
    const labels = await this.store.load<Record<string, string>>(key);
    return labels ?? {};
  }

  async saveLocalLabels(walletAddress: Address, labels: Record<string, string>): Promise<void> {
    const key = `${GUARDIAN_LABELS_STORAGE_KEY}-${walletAddress.toLowerCase()}`;
    const existing = await this.getLocalLabels(walletAddress);
    await this.store.save(key, { ...existing, ...labels });
  }
}
