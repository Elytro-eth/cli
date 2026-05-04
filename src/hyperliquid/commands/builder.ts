import type { Command } from 'commander';
import ora from 'ora';
import type { Address } from 'viem';
import { isAddress } from 'viem';
import type { AppContext } from '../../context.js';
import { outputResult } from '../../utils/display.js';
import { HlInfoClient } from '../infoClient.js';
import { HlExchangeClient } from '../exchangeClient.js';
import { HlAccountStore } from '../accountMapping.js';
import { withOwnerKey, withAgentKey } from '../agentWallet.js';
import { validateAmount, validateBuilderFeeRate } from '../validators.js';
import { buildFundPreview, renderFundPreview, confirmPrompt } from '../preview.js';
import { defaultHlNetwork } from '../constants.js';
import type { HlNetwork } from '../constants.js';
import { resolveHlAccount, requireHlAccount, handleHlError } from './helpers.js';
import { syncContextForAccount } from '../../context.js';

interface BuilderApproveOpts {
  builder: string;
  maxFee: string;
  dryRun?: boolean;
  confirm?: boolean;
  network?: string;
}

interface BuilderRevokeOpts {
  builder: string;
  dryRun?: boolean;
  confirm?: boolean;
  network?: string;
}

interface DexTransferOpts {
  fromDex: string;
  toDex: string;
  amount: string;
  dryRun?: boolean;
  confirm?: boolean;
  network?: string;
}

export function registerBuilderCommands(hl: Command, ctx: AppContext): void {
  const store = new HlAccountStore(ctx.store);

  const builder = hl.command('builder').description('Manage HIP-3 builder fee approvals');

  // ─── builder status ────────────────────────────────────────────────────────

  builder
    .command('status')
    .description('Show approved builders for an account')
    .argument('[account]', 'Elytro account alias or address')
    .option('--network <network>', 'Mainnet | Testnet')
    .action(async (target?: string, opts?: { network?: string }) => {
      const spinner = ora('Fetching approved builders...').start();
      try {
        const { account, hlAccount } = await resolveHlAccount(ctx, store, target);
        const network = (opts?.network as HlNetwork) ?? hlAccount?.network ?? defaultHlNetwork();
        const user = (hlAccount?.hlMainAddress ?? account.owner) as Address;

        const info = new HlInfoClient(network);
        const builders = await info.getApprovedBuilders(user);
        spinner.stop();

        outputResult({
          account: account.alias,
          hlAddress: user,
          network,
          approvedBuilders: builders,
          count: builders.length,
        });
      } catch (err) {
        spinner.stop();
        handleHlError(err);
      }
    });

  // ─── builder approve ───────────────────────────────────────────────────────

  builder
    .command('approve')
    .description('Approve a builder to charge fees on your orders')
    .argument('[account]', 'Elytro account alias or address')
    .requiredOption('--builder <address>', 'Builder wallet address')
    .requiredOption('--max-fee <rate>', 'Max fee rate e.g. "0.001%"')
    .option('--dry-run', 'Preview')
    .option('--confirm', 'Execute')
    .option('--network <network>', 'Mainnet | Testnet')
    .action(async (target: string | undefined, opts: BuilderApproveOpts) => {
      if (!opts.dryRun && !opts.confirm) {
        handleHlError(new Error('Specify --dry-run to preview or --confirm to execute.'));
      }

      if (!opts.builder || !isAddress(opts.builder)) {
        handleHlError(new Error('--builder must be a valid Ethereum address.'));
      }
      if (!opts.maxFee) {
        handleHlError(new Error('--max-fee is required.'));
      }

      validateBuilderFeeRate(opts.maxFee);

      try {
        const { account, hlAccount } = await resolveHlAccount(ctx, store, target);
        requireHlAccount(hlAccount, account.alias);

        const network = (opts.network as HlNetwork | undefined) ?? hlAccount.network;

        const preview = buildFundPreview({
          action: `Approve builder ${opts.builder} (max ${opts.maxFee})`,
          amount: opts.maxFee,
          network,
        });

        renderFundPreview(preview);

        if (opts.dryRun) {
          outputResult({ dryRun: true, builder: opts.builder, maxFeeRate: opts.maxFee, network });
          return;
        }

        const confirmed = await confirmPrompt(`Approve builder ${opts.builder}?`);
        if (!confirmed) {
          outputResult({ status: 'cancelled' });
          return;
        }

        const spinner = ora('Approving builder...').start();
        await syncContextForAccount(ctx, account);

        const exchange = new HlExchangeClient(network);

        await withOwnerKey(ctx.keyring, account.owner as Address, async () =>
          exchange.approveBuilderFee(ctx.keyring, {
            builder: opts.builder as Address,
            maxFeeRate: opts.maxFee,
          }),
        );

        spinner.succeed('Builder approved.');
        outputResult({ status: 'approved', builder: opts.builder, maxFeeRate: opts.maxFee, network });
      } catch (err) {
        handleHlError(err);
      }
    });

  // ─── builder revoke ────────────────────────────────────────────────────────

  builder
    .command('revoke')
    .description('Revoke a builder approval (set max fee to 0%)')
    .argument('[account]', 'Elytro account alias or address')
    .requiredOption('--builder <address>', 'Builder wallet address to revoke')
    .option('--dry-run', 'Preview')
    .option('--confirm', 'Execute')
    .option('--network <network>', 'Mainnet | Testnet')
    .action(async (target: string | undefined, opts: BuilderRevokeOpts) => {
      if (!opts.dryRun && !opts.confirm) {
        handleHlError(new Error('Specify --dry-run to preview or --confirm to execute.'));
      }

      if (!opts.builder || !isAddress(opts.builder)) {
        handleHlError(new Error('--builder must be a valid Ethereum address.'));
      }

      try {
        const { account, hlAccount } = await resolveHlAccount(ctx, store, target);
        requireHlAccount(hlAccount, account.alias);

        const network = (opts.network as HlNetwork | undefined) ?? hlAccount.network;

        if (opts.dryRun) {
          outputResult({ dryRun: true, action: 'revoke-builder', builder: opts.builder, network });
          return;
        }

        const confirmed = await confirmPrompt(`Revoke builder ${opts.builder}?`);
        if (!confirmed) {
          outputResult({ status: 'cancelled' });
          return;
        }

        const spinner = ora('Revoking builder...').start();
        await syncContextForAccount(ctx, account);

        const exchange = new HlExchangeClient(network);

        // Revoking = approve with 0% max fee
        await withOwnerKey(ctx.keyring, account.owner as Address, async () =>
          exchange.approveBuilderFee(ctx.keyring, {
            builder: opts.builder as Address,
            maxFeeRate: '0%',
          }),
        );

        spinner.succeed('Builder revoked.');
        outputResult({ status: 'revoked', builder: opts.builder, network });
      } catch (err) {
        handleHlError(err);
      }
    });

  // ─── dex-list ──────────────────────────────────────────────────────────────

  hl
    .command('dex-list')
    .description('List available Hyperliquid DEX platforms (HIP-3)')
    .option('--network <network>', 'Mainnet | Testnet')
    .action(async (opts?: { network?: string }) => {
      const spinner = ora('Fetching DEX list...').start();
      try {
        const network = (opts?.network as HlNetwork) ?? defaultHlNetwork();
        const info = new HlInfoClient(network);
        const dexs = await info.getPerpDexs();
        spinner.stop();

        outputResult({ dexs, count: dexs.length, network });
      } catch (err) {
        spinner.stop();
        handleHlError(err);
      }
    });

  // ─── dex-transfer ──────────────────────────────────────────────────────────

  hl
    .command('dex-transfer')
    .description('Transfer funds between HIP-3 DEX platforms')
    .argument('[account]', 'Elytro account alias or address')
    .requiredOption('--from-dex <dex>', 'Source DEX name')
    .requiredOption('--to-dex <dex>', 'Destination DEX name')
    .requiredOption('--amount <amount>', 'USDC amount (must be multiple of 1000)')
    .option('--dry-run', 'Preview')
    .option('--confirm', 'Execute')
    .option('--network <network>', 'Mainnet | Testnet')
    .action(async (target: string | undefined, opts: DexTransferOpts) => {
      if (!opts.dryRun && !opts.confirm) {
        handleHlError(new Error('Specify --dry-run to preview or --confirm to execute.'));
      }

      validateAmount(opts.amount, 'DEX transfer amount');
      const amountNum = parseFloat(opts.amount);
      if (amountNum % 1000 !== 0) {
        handleHlError(new Error('DEX transfer amount must be a multiple of 1000 USDC.'));
      }

      try {
        const { account, hlAccount } = await resolveHlAccount(ctx, store, target);
        requireHlAccount(hlAccount, account.alias);

        const network = (opts.network as HlNetwork | undefined) ?? hlAccount.network;

        const preview = buildFundPreview({
          action: `DEX Transfer ${opts.amount} USDC: ${opts.fromDex} → ${opts.toDex}`,
          amount: `${opts.amount} USDC`,
          network,
        });

        renderFundPreview(preview);

        if (opts.dryRun) {
          outputResult({
            dryRun: true,
            fromDex: opts.fromDex,
            toDex: opts.toDex,
            amount: opts.amount,
            network,
          });
          return;
        }

        const confirmed = await confirmPrompt(
          `Execute DEX transfer ${opts.fromDex} → ${opts.toDex}?`,
        );
        if (!confirmed) {
          outputResult({ status: 'cancelled' });
          return;
        }

        const spinner = ora('Executing DEX transfer...').start();
        await syncContextForAccount(ctx, account);

        const exchange = new HlExchangeClient(network);
        const agentInfo = await store.getAgentInfo(account.owner as Address);
        const ntl = amountNum * 1_000_000;

        const doTransfer = async () => {
          await exchange.hip3LiquidatorTransfer(ctx.keyring, {
            dex: opts.fromDex,
            ntl,
            isDeposit: false,
          });
          await exchange.hip3LiquidatorTransfer(ctx.keyring, {
            dex: opts.toDex,
            ntl,
            isDeposit: true,
          });
        };

        if (agentInfo) {
          await withAgentKey(ctx.keyring, store, account.owner as Address, doTransfer);
        } else {
          await withOwnerKey(ctx.keyring, account.owner as Address, doTransfer);
        }

        spinner.succeed('DEX transfer complete.');
        outputResult({
          status: 'transferred',
          fromDex: opts.fromDex,
          toDex: opts.toDex,
          amount: opts.amount,
          network,
        });
      } catch (err) {
        handleHlError(err);
      }
    });
}
