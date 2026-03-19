import { Command } from 'commander';
import ora, { type Ora } from 'ora';
import { readFileSync, writeFileSync } from 'fs';
import type { Address, Hex } from 'viem';
import { isAddress, zeroHash } from 'viem';
import type { AppContext } from '../context';
import type { AccountInfo, ChainConfig, ElytroUserOperation, RecoveryContact } from '../types';
import { RecoveryStatus } from '../types';
import { address as shortAddr, sanitizeErrorMessage, outputResult, outputError } from '../utils/display';
import {
  ERR_RECOVERY_INVALID_PARAMS,
  ERR_RECOVERY_NO_RECORD,
  ERR_ACCOUNT_RECOVERING,
} from '../constants/recovery';
import { encodeSetGuardian } from '../utils/contracts/socialRecovery';

// ─── Error Handling ───────────────────────────────────────────────────

const ERR_ACCOUNT_NOT_READY = -32002;
const ERR_INTERNAL = -32000;

class RecoveryError extends Error {
  code: number;
  data?: Record<string, unknown>;

  constructor(code: number, message: string, data?: Record<string, unknown>) {
    super(message);
    this.name = 'RecoveryError';
    this.code = code;
    this.data = data;
  }
}

function handleRecoveryError(err: unknown): void {
  if (err instanceof RecoveryError) {
    outputError(err.code, err.message, err.data);
  } else {
    outputError(ERR_INTERNAL, sanitizeErrorMessage((err as Error).message ?? String(err)));
  }
}

// ─── Context Setup ────────────────────────────────────────────────

interface RecoveryContext {
  account: AccountInfo;
  chainConfig: ChainConfig;
}

function initRecoveryContext(ctx: AppContext): RecoveryContext {
  if (!ctx.keyring.isUnlocked) {
    throw new RecoveryError(
      ERR_ACCOUNT_NOT_READY,
      'Keyring is locked. Run `elytro init` to initialize.'
    );
  }

  const current = ctx.account.currentAccount;
  if (!current) {
    throw new RecoveryError(ERR_ACCOUNT_NOT_READY, 'No account selected. Run `elytro account create` first.');
  }

  const account = ctx.account.resolveAccount(current.alias ?? current.address);
  if (!account) {
    throw new RecoveryError(ERR_ACCOUNT_NOT_READY, 'Account not found.');
  }

  if (!account.isDeployed) {
    throw new RecoveryError(ERR_ACCOUNT_NOT_READY, 'Account not deployed. Run `elytro account activate` first.');
  }

  const chainConfig = ctx.chain.chains.find((c) => c.id === account.chainId);
  if (!chainConfig) {
    throw new RecoveryError(ERR_ACCOUNT_NOT_READY, `No chain config for chainId ${account.chainId}.`);
  }

  ctx.walletClient.initForChain(chainConfig);

  return { account, chainConfig };
}

// ─── Shared UserOp Pipeline ───────────────────────────────────────

async function buildUserOp(
  ctx: AppContext,
  chainConfig: ChainConfig,
  account: AccountInfo,
  txs: Array<{ to: Address; value: string; data: Hex }>,
  spinner: Ora
): Promise<ElytroUserOperation> {
  const userOp = await ctx.sdk.createSendUserOp(
    account.address,
    txs.map((tx) => ({ to: tx.to, value: tx.value, data: tx.data }))
  );

  const feeData = await ctx.sdk.getFeeData(chainConfig);
  userOp.maxFeePerGas = feeData.maxFeePerGas;
  userOp.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;

  spinner.text = 'Estimating gas...';
  const gasEstimate = await ctx.sdk.estimateUserOp(userOp, { fakeBalance: true });
  userOp.callGasLimit = gasEstimate.callGasLimit;
  userOp.verificationGasLimit = gasEstimate.verificationGasLimit;
  userOp.preVerificationGas = gasEstimate.preVerificationGas;

  spinner.text = 'Checking sponsorship...';
  try {
    const { requestSponsorship, applySponsorToUserOp } = await import('../utils/sponsor');
    const { sponsor: sponsorResult } = await requestSponsorship(
      ctx.chain.graphqlEndpoint,
      account.chainId,
      ctx.sdk.entryPoint,
      userOp
    );
    if (sponsorResult) applySponsorToUserOp(userOp, sponsorResult);
  } catch {
    // Self-pay fallback
  }

  return userOp;
}

async function signAndSend(
  ctx: AppContext,
  _chainConfig: ChainConfig,
  userOp: ElytroUserOperation,
  spinner: Ora
): Promise<{ opHash: Hex; txHash: Hex }> {
  spinner.text = 'Signing...';
  const { packedHash, validationData } = await ctx.sdk.getUserOpHash(userOp);
  const rawSignature = await ctx.keyring.signDigest(packedHash);
  userOp.signature = await ctx.sdk.packUserOpSignature(rawSignature, validationData);

  spinner.text = 'Sending UserOp...';
  const opHash = await ctx.sdk.sendUserOp(userOp);

  spinner.text = 'Waiting for receipt...';
  const receipt = await ctx.sdk.waitForReceipt(opHash);
  spinner.stop();

  if (!receipt.success) {
    throw new RecoveryError(ERR_INTERNAL, 'Transaction reverted on-chain.', {
      txHash: receipt.transactionHash,
    });
  }

  return { opHash, txHash: receipt.transactionHash };
}

// ─── Recovery Guard ───────────────────────────────────────────────

function buildBlockedResponse(account: AccountInfo): Record<string, unknown> {
  const ar = account.activeRecovery!;
  return {
    success: false,
    error: {
      code: ERR_ACCOUNT_RECOVERING,
      message: `Account ${account.alias} (${shortAddr(account.address)}) is currently being recovered. Write operations are blocked.`,
    },
    context: {
      account: account.alias,
      address: account.address,
      recoveryStatus: ar.status,
    },
    suggestion: [
      { action: 'elytro recovery status', description: 'Check the latest recovery progress' },
      { action: 'elytro account switch <other-account>', description: 'Switch to a different account that is not in recovery' },
    ],
  };
}

// ─── Recovery Status Suggestions ─────────────────────────────────

function buildStatusSuggestion(
  status: RecoveryStatus,
  recoveryUrl: string,
  signedCount: number,
  threshold: number,
  remainingSeconds?: number | null
): Array<{ action: string; description: string }> {
  switch (status) {
    case RecoveryStatus.WAITING_FOR_SIGNATURE:
      return [
        {
          action: `open ${recoveryUrl}`,
          description: `Share this link with your guardians to collect signatures. ${signedCount} of ${threshold} required signatures collected so far.`,
        },
        {
          action: 'elytro recovery status',
          description: 'Re-run after guardians have signed to check updated progress.',
        },
      ];

    case RecoveryStatus.SIGNATURE_COMPLETED:
      return [
        {
          action: `open ${recoveryUrl}`,
          description:
            'All required signatures have been collected. Open the Recovery App using a different wallet (not the one being recovered) to submit the recovery transaction on-chain.',
        },
      ];

    case RecoveryStatus.RECOVERY_STARTED: {
      const waitHint =
        remainingSeconds != null && remainingSeconds > 0
          ? `Approximately ${Math.ceil(remainingSeconds / 60)} minutes remaining.`
          : 'The delay period should elapse soon.';
      return [
        {
          action: 'elytro recovery status',
          description: `Recovery transaction is on-chain. Waiting for the mandatory delay period to elapse before control can be transferred. ${waitHint}`,
        },
      ];
    }

    case RecoveryStatus.RECOVERY_READY:
      return [
        {
          action: `open ${recoveryUrl}`,
          description:
            'The delay period has elapsed. Open the Recovery App to finalize and complete the wallet control transfer.',
        },
      ];

    case RecoveryStatus.RECOVERY_COMPLETED:
      return [
        {
          action: 'elytro account list',
          description: 'Recovery is complete. The wallet is now accessible from this device.',
        },
      ];

    default:
      return [];
  }
}

// ─── Command Registration ─────────────────────────────────────────

export function registerRecoveryCommand(program: Command, ctx: AppContext): void {
  const recovery = program.command('recovery').description('Social recovery — guardian contacts, backup, initiate recovery');

  // ─── contacts ─────────────────────────────────────────────

  const contacts = recovery.command('contacts').description('Manage recovery contacts (guardians)');

  // ─── contacts list ────────────────────────────────────────

  contacts
    .command('list')
    .description('Query current on-chain guardian settings')
    .action(async () => {
      try {
        const { account, chainConfig } = initRecoveryContext(ctx);
        await ctx.sdk.initForChain(chainConfig);

        await ctx.recovery.checkAndUpdateRecoveryState(account, chainConfig);

        const spinner = ora('Querying guardian contacts...').start();

        let contactsInfo, recoveryInfo;
        try {
          [contactsInfo, recoveryInfo] = await Promise.all([
            ctx.recovery.queryContacts(account.address, chainConfig),
            ctx.recovery.getRecoveryInfo(account.address, chainConfig),
          ]);
        } finally {
          spinner.stop();
        }

        const labels = await ctx.recovery.getLocalLabels(account.address);

        const result: Record<string, unknown> = {
          address: account.address,
          chainId: account.chainId,
        };

        if (contactsInfo) {
          result.contacts = contactsInfo.contacts.map((addr) => ({
            address: addr,
            ...(labels[addr.toLowerCase()] ? { label: labels[addr.toLowerCase()] } : {}),
          }));
          result.threshold = contactsInfo.threshold;
        } else {
          result.contacts = [];
          result.threshold = 0;
        }

        if (recoveryInfo) {
          result.contactsHash = recoveryInfo.contactsHash;
          result.nonce = Number(recoveryInfo.nonce);
          result.delayPeriod = Number(recoveryInfo.delayPeriod);
        }

        if (account.activeRecovery) {
          result.recoveryInfo = {
            status: account.activeRecovery.status,
            message: 'This account is being recovered. Write operations are blocked.',
          };
        }

        outputResult(result);
      } catch (err) {
        handleRecoveryError(err);
      }
    });

  // ─── contacts set ─────────────────────────────────────────

  contacts
    .command('set')
    .description('Set guardian contacts and threshold (on-chain transaction)')
    .argument('<addresses>', 'Comma-separated guardian addresses')
    .requiredOption('--threshold <n>', 'Minimum signatures required', parseInt)
    .option('--label <labels>', 'Labels: "0xAddr=Name,0xAddr=Name"')
    .option('--privacy', 'Privacy mode: only store hash on-chain, not plaintext contacts')
    .action(async (addressesStr: string, opts: { threshold: number; label?: string; privacy?: boolean }) => {
      try {
        const { account, chainConfig } = initRecoveryContext(ctx);
        await ctx.sdk.initForChain(chainConfig);

        const recoveryState = await ctx.recovery.checkAndUpdateRecoveryState(account, chainConfig);
        if (recoveryState) {
          console.log(JSON.stringify(buildBlockedResponse(account), null, 2));
          process.exitCode = 1;
          return;
        }

        const addressList = addressesStr.split(',').map((a) => a.trim());
        for (const addr of addressList) {
          if (!isAddress(addr)) {
            throw new RecoveryError(ERR_RECOVERY_INVALID_PARAMS, `Invalid address: ${addr}`);
          }
        }

        if (opts.threshold < 1 || opts.threshold > addressList.length) {
          throw new RecoveryError(
            ERR_RECOVERY_INVALID_PARAMS,
            `Threshold must be between 1 and ${addressList.length} (number of contacts).`
          );
        }

        const changed = await ctx.recovery.isContactsSettingChanged(
          account.address,
          addressList,
          opts.threshold,
          chainConfig
        );
        if (!changed) {
          outputResult({ status: 'no_changes', message: 'Guardian settings are already up to date.' });
          return;
        }

        const recoveryModuleAddress = ctx.sdk.contracts.recovery as Address;
        const txs = ctx.recovery.generateSetContactsTxs(
          addressList,
          opts.threshold,
          recoveryModuleAddress,
          !!opts.privacy
        );

        const spinner = ora('Building UserOp...').start();
        try {
          const userOp = await buildUserOp(ctx, chainConfig, account, txs, spinner);
          const { txHash } = await signAndSend(ctx, chainConfig, userOp, spinner);

          if (opts.label) {
            const labels: Record<string, string> = {};
            for (const pair of opts.label.split(',')) {
              const [addr, name] = pair.split('=');
              if (addr && name) {
                labels[addr.trim().toLowerCase()] = name.trim();
              }
            }
            await ctx.recovery.saveLocalLabels(account.address, labels);
          }

          account.isRecoveryEnabled = true;
          await ctx.account.persistAccountUpdate(account);

          const contactsHash = ctx.recovery.calculateContactsHash(addressList, opts.threshold);
          outputResult({
            status: 'contacts_set',
            txHash,
            contacts: addressList,
            threshold: opts.threshold,
            contactsHash,
            privacyMode: !!opts.privacy,
          });
        } catch (innerErr) {
          spinner.stop();
          throw innerErr;
        }
      } catch (err) {
        handleRecoveryError(err);
      }
    });

  // ─── contacts clear ───────────────────────────────────────

  contacts
    .command('clear')
    .description('Clear all guardian contacts (on-chain transaction)')
    .action(async () => {
      try {
        const { account, chainConfig } = initRecoveryContext(ctx);
        await ctx.sdk.initForChain(chainConfig);

        const recoveryState = await ctx.recovery.checkAndUpdateRecoveryState(account, chainConfig);
        if (recoveryState) {
          console.log(JSON.stringify(buildBlockedResponse(account), null, 2));
          process.exitCode = 1;
          return;
        }

        const info = await ctx.recovery.getRecoveryInfo(account.address, chainConfig);
        if (!info || info.contactsHash === zeroHash) {
          outputResult({ status: 'no_contacts', message: 'No guardian contacts are set.' });
          return;
        }

        const recoveryModuleAddress = ctx.sdk.contracts.recovery as Address;
        const txs = [encodeSetGuardian(zeroHash, recoveryModuleAddress)];

        const spinner = ora('Building UserOp...').start();
        try {
          const userOp = await buildUserOp(ctx, chainConfig, account, txs, spinner);
          const { txHash } = await signAndSend(ctx, chainConfig, userOp, spinner);

          account.isRecoveryEnabled = false;
          await ctx.account.persistAccountUpdate(account);

          outputResult({ status: 'contacts_cleared', txHash });
        } catch (innerErr) {
          spinner.stop();
          throw innerErr;
        }
      } catch (err) {
        handleRecoveryError(err);
      }
    });

  // ─── backup ─────────────────────────────────────────────────

  const backup = recovery.command('backup').description('Backup and import guardian info');

  // ─── backup export ──────────────────────────────────────────

  backup
    .command('export')
    .description('Export recovery backup JSON')
    .option('--output <path>', 'Output file path (default: stdout)')
    .action(async (opts: { output?: string }) => {
      try {
        const { account, chainConfig } = initRecoveryContext(ctx);
        await ctx.sdk.initForChain(chainConfig);

        const spinner = ora('Exporting backup...').start();
        let backupData;
        try {
          backupData = await ctx.recovery.exportBackup(account.address, account.chainId, chainConfig);
        } finally {
          spinner.stop();
        }

        const json = JSON.stringify(backupData, null, 2);

        if (opts.output) {
          writeFileSync(opts.output, json, 'utf-8');
          outputResult({ status: 'exported', path: opts.output });
        } else {
          outputResult({ status: 'exported', backup: backupData });
        }
      } catch (err) {
        handleRecoveryError(err);
      }
    });

  // ─── backup import ──────────────────────────────────────────

  backup
    .command('import')
    .description('Import recovery backup JSON')
    .argument('<file>', 'Path to backup JSON file')
    .action(async (filePath: string) => {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const backupData = ctx.recovery.parseBackupFile(content);

        const labels: Record<string, string> = {};
        for (const contact of backupData.contacts) {
          if (contact.label) {
            labels[contact.address.toLowerCase()] = contact.label;
          }
        }
        if (Object.keys(labels).length > 0) {
          await ctx.recovery.saveLocalLabels(backupData.address, labels);
        }

        outputResult({
          status: 'imported',
          address: backupData.address,
          chainId: backupData.chainId,
          contacts: backupData.contacts.length,
          threshold: backupData.threshold,
        });
      } catch (err) {
        handleRecoveryError(err);
      }
    });

  // ─── initiate ───────────────────────────────────────────────

  recovery
    .command('initiate')
    .description('Initiate recovery for a wallet — returns Recovery App URL')
    .argument('<wallet-address>', 'Address of the wallet to recover')
    .option('--chain-id <n>', 'Target chain ID (default: current chain)', parseInt)
    .option('--from-backup <file>', 'Import guardian info from backup file')
    .action(async (walletAddress: string, opts: { chainId?: number; fromBackup?: string }) => {
      try {
        if (!isAddress(walletAddress)) {
          throw new RecoveryError(ERR_RECOVERY_INVALID_PARAMS, 'Invalid wallet address.');
        }

        const chainId = opts.chainId ?? ctx.chain.currentChain.id;
        const chainConfig = ctx.chain.chains.find((c) => c.id === chainId);
        if (!chainConfig) {
          throw new RecoveryError(ERR_RECOVERY_INVALID_PARAMS, `No chain config for chainId ${chainId}.`);
        }

        ctx.walletClient.initForChain(chainConfig);
        await ctx.sdk.initForChain(chainConfig);

        // Always use the current keyring EOA as the new controller
        const newOwner = ctx.keyring.currentOwner;
        if (!newOwner) {
          throw new RecoveryError(
            ERR_ACCOUNT_NOT_READY,
            'Keyring is locked. Run `elytro init` to initialize.'
          );
        }

        // Guard: if the local keyring already controls this wallet, recovery is unnecessary
        const alreadyControls = await ctx.sdk.checkIsOwner(
          walletAddress as Address,
          newOwner,
          chainConfig
        );
        if (alreadyControls) {
          outputResult({
            status: 'no_recovery_needed',
            message: `The current device already controls wallet ${walletAddress}. No recovery needed.`,
            walletAddress,
          });
          return;
        }

        let contacts: RecoveryContact[] | undefined;
        let threshold: number | undefined;
        if (opts.fromBackup) {
          const content = readFileSync(opts.fromBackup, 'utf-8');
          const backupData = ctx.recovery.parseBackupFile(content);
          contacts = backupData.contacts;
          threshold = parseInt(backupData.threshold, 10);
        }

        const spinner = ora('Initiating recovery...').start();
        try {
          const result = await ctx.recovery.initiateRecovery({
            walletAddress: walletAddress as Address,
            chainId,
            newOwner,
            contacts,
            threshold,
            chainConfig,
          });
          spinner.stop();

          const managedAccount = ctx.account.resolveAccount(walletAddress);
          if (managedAccount) {
            await ctx.recovery.setActiveRecovery(managedAccount, result.recoveryId, newOwner);
          }

          outputResult({
            walletAddress: result.walletAddress,
            chainId: result.chainId,
            recoveryId: result.recoveryId,
            approveHash: result.approveHash,
            contacts: result.contacts,
            threshold: result.threshold,
            recoveryUrl: result.recoveryUrl,
          });
        } catch (innerErr) {
          spinner.stop();
          throw innerErr;
        }
      } catch (err) {
        handleRecoveryError(err);
      }
    });

  // ─── status ─────────────────────────────────────────────────

  recovery
    .command('status')
    .description('Query recovery progress (read-only)')
    .option('--wallet <address>', 'Wallet address being recovered')
    .option('--recovery-id <hex>', 'Recovery operation ID')
    .action(async (opts: { wallet?: string; recoveryId?: string }) => {
      try {
        let chainConfig: ChainConfig;

        const localRecord = await ctx.recovery.getLocalRecoveryRecord();

        if (localRecord) {
          const resolvedChain = ctx.chain.chains.find((c) => c.id === localRecord.chainId);
          if (!resolvedChain) {
            throw new RecoveryError(ERR_RECOVERY_INVALID_PARAMS, `No chain config for chainId ${localRecord.chainId}.`);
          }
          chainConfig = resolvedChain;
        } else {
          chainConfig = ctx.chain.currentChain;
        }

        ctx.walletClient.initForChain(chainConfig);
        await ctx.sdk.initForChain(chainConfig);

        const spinner = ora('Querying recovery status...').start();
        try {
          let result;

          if (localRecord && !opts.wallet) {
            result = await ctx.recovery.queryRecoveryStatusFromLocal(chainConfig);
          } else {
            throw new RecoveryError(
              ERR_RECOVERY_NO_RECORD,
              'No local recovery record found. Run `elytro recovery initiate` first.'
            );
          }

          spinner.stop();

          const suggestion = buildStatusSuggestion(
            result.status,
            result.recoveryUrl,
            result.signedCount,
            result.threshold,
            result.remainingSeconds
          );

          outputResult(
            {
              walletAddress: result.walletAddress,
              status: result.status,
              contacts: result.contacts,
              signedCount: result.signedCount,
              threshold: result.threshold,
              recoveryUrl: result.recoveryUrl,
              validTime: result.validTime ?? null,
              remainingSeconds: result.remainingSeconds ?? null,
            },
            suggestion
          );
        } catch (innerErr) {
          spinner.stop();
          throw innerErr;
        }
      } catch (err) {
        handleRecoveryError(err);
      }
    });
}
