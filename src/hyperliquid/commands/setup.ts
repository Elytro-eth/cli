import type { Command } from 'commander';
import ora from 'ora';
import type { Address } from 'viem';
import type { AppContext } from '../../context.js';
import { outputResult } from '../../utils/display.js';
import { HlInfoClient } from '../infoClient.js';
import { HlExchangeClient } from '../exchangeClient.js';
import { HlAccountStore } from '../accountMapping.js';
import { createAgentKey, authorizeAgent } from '../agentWallet.js';
import { defaultHlNetwork } from '../constants.js';
import type { HlNetwork } from '../constants.js';
import type { HlAccountInfo } from '../types.js';
import { resolveHlAccount, requireHlAccount, handleHlError } from './helpers.js';
import { syncContextForAccount } from '../../context.js';

export function registerSetupCommands(hl: Command, ctx: AppContext): void {
  const store = new HlAccountStore(ctx.store);

  const signer = hl.command('signer').description('Manage Hyperliquid signing keys');

  // ─── init ──────────────────────────────────────────────────────────────────

  hl
    .command('init')
    .description('Initialize Hyperliquid support for an Elytro account')
    .argument('[account]', 'Elytro account alias or address')
    .option('--network <network>', 'Mainnet | Testnet (default: Testnet in dev, Mainnet in prod)')
    .action(async (target?: string, opts?: { network?: string }) => {
      try {
        const { account } = await resolveHlAccount(ctx, store, target);
        await syncContextForAccount(ctx, account);

        const network = (opts?.network as HlNetwork) ?? defaultHlNetwork();
        const ownerAddress = account.owner as Address;

        const existing = await store.getAccount(account.address as Address);
        if (existing) {
          outputResult({
            status: 'already_initialized',
            account: account.alias,
            hlMainAddress: existing.hlMainAddress,
            agentAddress: existing.agentAddress ?? null,
            network: existing.network,
          });
          return;
        }

        const hlAccount: HlAccountInfo = {
          elytroAccountAddress: account.address as Address,
          elytroOwnerAddress: ownerAddress,
          hlMainAddress: ownerAddress,
          network,
          createdAt: new Date().toISOString(),
          lastUpdatedAt: new Date().toISOString(),
        };

        await store.setAccount(hlAccount);

        outputResult({
          status: 'initialized',
          account: account.alias,
          hlMainAddress: ownerAddress,
          network,
          note:
            'Run `elytro hyperliquid signer create-agent` to create a trading agent wallet (recommended).',
        });
      } catch (err) {
        handleHlError(err);
      }
    });

  // ─── signer show ───────────────────────────────────────────────────────────

  signer
    .command('show')
    .description('Show current Hyperliquid signer configuration')
    .argument('[account]', 'Elytro account alias or address')
    .action(async (target?: string) => {
      try {
        const { account, hlAccount } = await resolveHlAccount(ctx, store, target);
        requireHlAccount(hlAccount, account.alias);

        const agentInfo = await store.getAgentInfo(hlAccount.hlMainAddress as Address);

        outputResult({
          account: account.alias,
          hlMainAddress: hlAccount.hlMainAddress,
          network: hlAccount.network,
          agent: agentInfo
            ? {
                address: agentInfo.agentAddress,
                name: agentInfo.agentName,
                authorizedAt: agentInfo.authorizedAt,
              }
            : null,
          note: agentInfo
            ? 'Agent wallet is configured for trading. Owner key handles fund movements.'
            : 'No agent wallet. All actions use the owner key directly.',
        });
      } catch (err) {
        handleHlError(err);
      }
    });

  // ─── signer create-agent ───────────────────────────────────────────────────

  signer
    .command('create-agent')
    .description(
      'Generate a new Hyperliquid agent wallet and authorize it for trading',
    )
    .argument('[account]', 'Elytro account alias or address')
    .option('--name <name>', 'Agent wallet name (default: account alias)')
    .action(async (target?: string, opts?: { name?: string }) => {
      const spinner = ora('Creating agent wallet...').start();
      try {
        const { account, hlAccount } = await resolveHlAccount(ctx, store, target);
        requireHlAccount(hlAccount, account.alias);
        await syncContextForAccount(ctx, account);

        const agentName = opts?.name ?? `${account.alias}-agent`;

        // Generate a new keypair stored in the vault
        spinner.text = 'Generating agent keypair...';
        const { agentAddress } = await createAgentKey(ctx.keyring);

        // Switch to HL main account key to sign approveAgent
        spinner.text = 'Authorizing agent on Hyperliquid...';
        await ctx.keyring.switchOwner(hlAccount.hlMainAddress as Address);

        const agentInfo = await authorizeAgent(
          ctx.keyring,
          store,
          account,
          agentAddress,
          agentName,
          hlAccount.network,
          hlAccount.hlMainAddress as Address,
        );

        spinner.succeed('Agent wallet created and authorized.');

        outputResult({
          account: account.alias,
          agentAddress: agentInfo.agentAddress,
          agentName: agentInfo.agentName,
          ownerAddress: agentInfo.ownerAddress,
          network: agentInfo.network,
          authorizedAt: agentInfo.authorizedAt,
          note: 'Agent key is encrypted in your Elytro vault. It can trade but NOT withdraw funds.',
        });
      } catch (err) {
        spinner.stop();
        handleHlError(err);
      }
    });

  // ─── signer authorize-agent ────────────────────────────────────────────────

  signer
    .command('authorize-agent')
    .description('Authorize an existing external address as a Hyperliquid agent')
    .argument('[account]', 'Elytro account alias or address')
    .option('--agent <address>', 'Agent wallet address to authorize (required)')
    .option('--name <name>', 'Agent name')
    .action(async (target?: string, opts?: { agent?: string; name?: string }) => {
      if (!opts?.agent) {
        handleHlError(new Error('--agent <address> is required.'));
      }

      const spinner = ora('Authorizing agent...').start();
      try {
        const { account, hlAccount } = await resolveHlAccount(ctx, store, target);
        requireHlAccount(hlAccount, account.alias);
        await syncContextForAccount(ctx, account);

        await ctx.keyring.switchOwner(hlAccount.hlMainAddress as Address);

        const exchangeClient = new HlExchangeClient(hlAccount.network);
        await exchangeClient.approveAgent(ctx.keyring, {
          agentAddress: opts!.agent as Address,
          agentName: opts?.name ?? 'external-agent',
        });

        spinner.succeed('Agent authorized.');

        outputResult({
          account: account.alias,
          agentAddress: opts!.agent,
          agentName: opts?.name ?? 'external-agent',
          network: hlAccount.network,
          note: 'External agent authorized. Key management is your responsibility.',
        });
      } catch (err) {
        spinner.stop();
        handleHlError(err);
      }
    });

  // ─── signer revoke-agent ───────────────────────────────────────────────────

  signer
    .command('revoke-agent')
    .description('Revoke a Hyperliquid agent wallet')
    .argument('[account]', 'Elytro account alias or address')
    .option('--agent <address>', 'Agent wallet address to revoke')
    .action(async (target?: string, opts?: { agent?: string }) => {
      const spinner = ora('Revoking agent...').start();
      try {
        const { account, hlAccount } = await resolveHlAccount(ctx, store, target);
        requireHlAccount(hlAccount, account.alias);
        await syncContextForAccount(ctx, account);

        // Authorize with empty address (slot replacement effectively revokes)
        // Hyperliquid: approving a new agent for the same slot replaces the old one.
        // For full revocation: authorize a throwaway zero key or reuse the slot.
        const agentInfo = await store.getAgentInfo(hlAccount.hlMainAddress as Address);
        const targetAgent =
          (opts?.agent as Address | undefined) ?? agentInfo?.agentAddress;

        if (!targetAgent) {
          spinner.stop();
          handleHlError(new Error('No agent configured. Specify --agent <address>.'));
        }

        // Remove from local store
        await store.removeAgentInfo(hlAccount.hlMainAddress as Address);
        await store.setAccount({
          ...hlAccount!,
          agentAddress: undefined,
          agentName: undefined,
        });

        spinner.succeed('Agent removed from local config.');

        outputResult({
          account: account.alias,
          revokedAgent: targetAgent,
          network: hlAccount!.network,
          note:
            'Local agent config removed. On Hyperliquid the slot will be freed when a new agent is approved, or the next session expires.',
        });
      } catch (err) {
        spinner.stop();
        handleHlError(err);
      }
    });

  // ─── signer status ─────────────────────────────────────────────────────────

  signer
    .command('status')
    .description('Check Hyperliquid signer status (on-chain role)')
    .argument('[account]', 'Elytro account alias or address')
    .action(async (target?: string) => {
      const spinner = ora('Checking signer status...').start();
      try {
        const { account, hlAccount } = await resolveHlAccount(ctx, store, target);
        requireHlAccount(hlAccount, account.alias);

        const info = new HlInfoClient(hlAccount.network);
        const [mainRole, agentRole] = await Promise.all([
          info.getUserRole(hlAccount.hlMainAddress).catch(() => ({ role: 'unknown' })),
          hlAccount.agentAddress
            ? info.getUserRole(hlAccount.agentAddress).catch(() => ({ role: 'unknown' }))
            : Promise.resolve(null),
        ]);

        spinner.stop();

        outputResult({
          account: account.alias,
          network: hlAccount.network,
          mainAccount: {
            address: hlAccount.hlMainAddress,
            role: mainRole.role,
          },
          agentWallet: hlAccount.agentAddress
            ? {
                address: hlAccount.agentAddress,
                name: hlAccount.agentName,
                role: agentRole?.role ?? null,
              }
            : null,
        });
      } catch (err) {
        spinner.stop();
        handleHlError(err);
      }
    });
}
