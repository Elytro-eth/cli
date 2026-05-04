import type { Command } from 'commander';
import ora from 'ora';
import type { Address } from 'viem';
import { createPublicClient, encodeFunctionData, hashTypedData, http, parseUnits } from 'viem';
import { arbitrum } from 'viem/chains';
import type { AppContext } from '../../context.js';
import { outputResult } from '../../utils/display.js';
import { HlExchangeClient } from '../exchangeClient.js';
import { HlAccountStore } from '../accountMapping.js';
import { withOwnerKey } from '../agentWallet.js';
import { validateAmount } from '../validators.js';
import { buildFundPreview, renderFundPreview, confirmPrompt } from '../preview.js';
import {
  HL_BRIDGE_ARBITRUM,
  USDC_ARBITRUM,
  ARBITRUM_CHAIN_ID,
  HL_USDC_DECIMALS,
  HL_WITHDRAWAL_FEE_USDC,
} from '../constants.js';
import type { HlNetwork } from '../constants.js';
import { resolveHlAccount, requireHlAccount, handleHlError } from './helpers.js';
import { syncContextForAccount } from '../../context.js';

// ─── ABIs (minimal — only what we need) ──────────────────────────────────────

const USDC_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'nonces',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const HL_BRIDGE_ABI = [
  {
    name: 'batchedDepositWithPermit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'deposits',
        type: 'tuple[]',
        components: [
          { name: 'user', type: 'address' },
          { name: 'usd', type: 'uint64' },
          { name: 'deadline', type: 'uint64' },
          {
            name: 'signature',
            type: 'tuple',
            components: [
              { name: 'r', type: 'uint256' },
              { name: 's', type: 'uint256' },
              { name: 'v', type: 'uint8' },
            ],
          },
        ],
      },
    ],
    outputs: [],
  },
] as const;

interface DepositOpts {
  amount: string;
  chain: string;
  dryRun?: boolean;
  confirm?: boolean;
}

interface WithdrawOpts {
  amount: string;
  destination?: string;
  dryRun?: boolean;
  confirm?: boolean;
}

interface TransferOpts {
  direction: string;
  amount: string;
  dryRun?: boolean;
  confirm?: boolean;
}

export function registerFundCommands(hl: Command, ctx: AppContext): void {
  const store = new HlAccountStore(ctx.store);

  // ─── deposit ───────────────────────────────────────────────────────────────

  hl
    .command('deposit')
    .description('Deposit USDC from Elytro smart account into Hyperliquid via Arbitrum bridge')
    .argument('[account]', 'Elytro account alias or address')
    .requiredOption('--amount <amount>', 'USDC amount to deposit (e.g. 100)')
    .option('--chain <chainId>', 'Source chain ID (must be 42161 — Arbitrum)', '42161')
    .option('--dry-run', 'Preview without executing')
    .option('--confirm', 'Execute the deposit')
    .action(async (target: string | undefined, opts: DepositOpts) => {
      if (!opts.dryRun && !opts.confirm) {
        handleHlError(new Error('Specify --dry-run to preview or --confirm to execute.'));
      }

      try {
        const { account, hlAccount } = await resolveHlAccount(ctx, store, target);
        requireHlAccount(hlAccount, account.alias);

        const chainId = parseInt(opts.chain ?? '42161', 10);
        if (chainId !== ARBITRUM_CHAIN_ID) {
          handleHlError(
            new Error(
              `Deposits only supported from Arbitrum (chain 42161). Got chain ${chainId}.`,
            ),
          );
        }

        validateAmount(opts.amount, 'deposit amount');
        const amountBigInt = parseUnits(opts.amount, HL_USDC_DECIMALS);

        const preview = buildFundPreview({
          action: `Deposit ${opts.amount} USDC → Hyperliquid`,
          amount: `${opts.amount} USDC`,
          fromAddress: account.address,
          toAddress: HL_BRIDGE_ARBITRUM,
          fee: 'Gas only (Elytro smart account pays)',
          estimatedTime: '~30 seconds (validator confirmation)',
          network: hlAccount.network,
        });

        renderFundPreview(preview);

        if (opts.dryRun) {
          outputResult({
            dryRun: true,
            preview,
            bridgeContract: HL_BRIDGE_ARBITRUM,
            usdcContract: USDC_ARBITRUM,
          });
          return;
        }

        const confirmed = await confirmPrompt('Execute this deposit?');
        if (!confirmed) {
          outputResult({ status: 'cancelled' });
          return;
        }

        const arbChain = ctx.chain.chains.find((c) => c.id === ARBITRUM_CHAIN_ID);
        if (!arbChain) {
          handleHlError(
            new Error(
              'Arbitrum (chain 42161) is not configured in your Elytro CLI. ' +
                'Add it with `elytro config chain`.',
            ),
          );
        }

        if (!account.isDeployed) {
          handleHlError(
            new Error(
              `Account "${account.alias}" is not deployed on Arbitrum. ` +
                'Run `elytro account activate` first.',
            ),
          );
        }

        const spinner = ora('Reading permit nonce...').start();

        ctx.walletClient.initForChain(arbChain!);
        await ctx.sdk.initForChain(arbChain!);
        await syncContextForAccount(ctx, account);

        const ownerAddress = hlAccount!.elytroOwnerAddress;

        // Preflight: verify Elytro smart account has enough USDC
        const arbPublicClient = createPublicClient({ chain: arbitrum, transport: http() });
        const [smartAccountBalance, permitNonce] = await Promise.all([
          arbPublicClient.readContract({
            address: USDC_ARBITRUM,
            abi: USDC_ABI,
            functionName: 'balanceOf',
            args: [account.address as Address],
          }),
          arbPublicClient.readContract({
            address: USDC_ARBITRUM,
            abi: USDC_ABI,
            functionName: 'nonces',
            args: [ownerAddress],
          }),
        ]);

        if (smartAccountBalance < amountBigInt) {
          spinner.stop();
          handleHlError(
            new Error(
              `Insufficient USDC balance. ` +
              `Required: ${opts.amount} USDC, available: ${Number(smartAccountBalance) / 1e6} USDC.`,
            ),
          );
        }

        // Sign EIP-2612 permit: owner authorises bridge to pull USDC
        spinner.text = 'Signing permit...';
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
        const permitSigHex = await withOwnerKey(ctx.keyring, ownerAddress, async () => {
          const digest = hashTypedData({
            domain: {
              name: 'USD Coin',
              version: '2',
              chainId: ARBITRUM_CHAIN_ID,
              verifyingContract: USDC_ARBITRUM,
            },
            types: {
              Permit: [
                { name: 'owner', type: 'address' },
                { name: 'spender', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'nonce', type: 'uint256' },
                { name: 'deadline', type: 'uint256' },
              ],
            },
            primaryType: 'Permit',
            message: {
              owner: ownerAddress,
              spender: HL_BRIDGE_ARBITRUM,
              value: amountBigInt,
              nonce: permitNonce,
              deadline,
            },
          });
          return ctx.keyring.signDigest(digest);
        });

        // Parse r/s/v from 65-byte hex sig
        const rawHex = permitSigHex.startsWith('0x') ? permitSigHex.slice(2) : permitSigHex;
        const permitR = BigInt('0x' + rawHex.slice(0, 64));
        const permitS = BigInt('0x' + rawHex.slice(64, 128));
        const vRaw = parseInt(rawHex.slice(128, 130), 16);
        const permitV = vRaw < 27 ? vRaw + 27 : vRaw;

        spinner.text = 'Building deposit UserOp...';

        // 1. Move USDC from smart account to owner EOA
        const transferCalldata = encodeFunctionData({
          abi: USDC_ABI,
          functionName: 'transfer',
          args: [ownerAddress, amountBigInt],
        });

        // 2. Bridge pulls USDC from owner EOA via permit and credits owner EOA on HL
        const depositCalldata = encodeFunctionData({
          abi: HL_BRIDGE_ABI,
          functionName: 'batchedDepositWithPermit',
          args: [[{
            user: ownerAddress,
            usd: amountBigInt,
            deadline,
            signature: { r: permitR, s: permitS, v: permitV },
          }]],
        });

        const txs = [
          { to: USDC_ARBITRUM as string, value: '0x0', data: transferCalldata },
          { to: HL_BRIDGE_ARBITRUM as string, value: '0x0', data: depositCalldata },
        ];

        let userOp = await ctx.sdk.createSendUserOp(account.address as Address, txs);

        spinner.text = 'Estimating gas...';
        const feeData = await ctx.sdk.getFeeData(arbChain!);
        userOp.maxFeePerGas = feeData.maxFeePerGas;
        userOp.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;

        const gasEstimate = await ctx.sdk.estimateUserOp(userOp);
        userOp.callGasLimit = gasEstimate.callGasLimit;
        userOp.verificationGasLimit = gasEstimate.verificationGasLimit;
        userOp.preVerificationGas = gasEstimate.preVerificationGas;

        spinner.text = 'Signing and submitting...';
        const { packedHash, validationData } = await ctx.sdk.getUserOpHash(userOp);
        const rawSig = await ctx.keyring.signDigest(packedHash);
        userOp.signature = await ctx.sdk.packUserOpSignature(rawSig, validationData);

        const hash = await ctx.sdk.sendUserOp(userOp);

        spinner.succeed('Deposit submitted.');
        outputResult({
          status: 'submitted',
          userOpHash: hash,
          amount: opts.amount,
          bridge: HL_BRIDGE_ARBITRUM,
          network: hlAccount.network,
        });
      } catch (err) {
        handleHlError(err);
      }
    });

  // ─── withdraw ──────────────────────────────────────────────────────────────

  hl
    .command('withdraw')
    .description('Withdraw USDC from Hyperliquid back to Elytro smart account')
    .argument('[account]', 'Elytro account alias or address')
    .requiredOption('--amount <amount>', 'USDC amount to withdraw')
    .option('--destination <address>', 'Destination address (default: Elytro smart account)')
    .option('--dry-run', 'Preview without executing')
    .option('--confirm', 'Execute withdrawal')
    .action(async (target: string | undefined, opts: WithdrawOpts) => {
      if (!opts.dryRun && !opts.confirm) {
        handleHlError(new Error('Specify --dry-run to preview or --confirm to execute.'));
      }

      try {
        const { account, hlAccount } = await resolveHlAccount(ctx, store, target);
        requireHlAccount(hlAccount, account.alias);

        validateAmount(opts.amount, 'withdrawal amount');
        const destination = (opts.destination as Address | undefined) ?? (account.address as Address);

        const preview = buildFundPreview({
          action: `Withdraw ${opts.amount} USDC from Hyperliquid`,
          amount: `${opts.amount} USDC`,
          fromAddress: hlAccount.hlMainAddress,
          toAddress: destination,
          fee: `~${HL_WITHDRAWAL_FEE_USDC} USDC`,
          estimatedTime: '~5 minutes',
          network: hlAccount.network,
        });

        renderFundPreview(preview);

        if (opts.dryRun) {
          outputResult({ dryRun: true, preview });
          return;
        }

        const confirmed = await confirmPrompt('Execute this withdrawal?');
        if (!confirmed) {
          outputResult({ status: 'cancelled' });
          return;
        }

        const spinner = ora('Submitting withdrawal...').start();
        await syncContextForAccount(ctx, account);

        const exchange = new HlExchangeClient(hlAccount.network);

        await withOwnerKey(ctx.keyring, hlAccount.hlMainAddress as Address, async () =>
          exchange.withdraw(ctx.keyring, { destination, amount: opts.amount }),
        );

        spinner.succeed('Withdrawal submitted. Funds arrive in ~5 minutes.');
        outputResult({
          status: 'submitted',
          amount: opts.amount,
          destination,
          fee: `${HL_WITHDRAWAL_FEE_USDC} USDC`,
          network: hlAccount.network,
        });
      } catch (err) {
        handleHlError(err);
      }
    });

  // ─── transfer ──────────────────────────────────────────────────────────────

  hl
    .command('transfer')
    .description('Transfer between Hyperliquid perp and spot accounts')
    .argument('[account]', 'Elytro account alias or address')
    .requiredOption('--direction <dir>', 'perp-to-spot | spot-to-perp')
    .requiredOption('--amount <amount>', 'USDC amount')
    .option('--dry-run', 'Preview')
    .option('--confirm', 'Execute')
    .action(async (target: string | undefined, opts: TransferOpts) => {
      if (!opts.dryRun && !opts.confirm) {
        handleHlError(new Error('Specify --dry-run to preview or --confirm to execute.'));
      }

      const direction = opts.direction;
      if (direction !== 'perp-to-spot' && direction !== 'spot-to-perp') {
        handleHlError(new Error('--direction must be "perp-to-spot" or "spot-to-perp".'));
      }

      try {
        const { account, hlAccount } = await resolveHlAccount(ctx, store, target);
        requireHlAccount(hlAccount, account.alias);

        validateAmount(opts.amount, 'transfer amount');

        const toPerp = direction === 'spot-to-perp';
        const dirLabel = toPerp ? 'Spot → Perp' : 'Perp → Spot';

        const preview = buildFundPreview({
          action: `Transfer ${opts.amount} USDC (${dirLabel})`,
          amount: `${opts.amount} USDC`,
          network: hlAccount.network,
        });

        renderFundPreview(preview);

        if (opts.dryRun) {
          outputResult({ dryRun: true, preview, direction });
          return;
        }

        const confirmed = await confirmPrompt(`Execute ${dirLabel} transfer?`);
        if (!confirmed) {
          outputResult({ status: 'cancelled' });
          return;
        }

        const spinner = ora('Transferring...').start();
        await syncContextForAccount(ctx, account);

        const exchange = new HlExchangeClient(hlAccount.network);

        await withOwnerKey(ctx.keyring, hlAccount.hlMainAddress as Address, async () =>
          exchange.usdClassTransfer(ctx.keyring, { amount: opts.amount, toPerp }),
        );

        spinner.succeed('Transfer complete.');
        outputResult({
          status: 'transferred',
          direction,
          amount: opts.amount,
          network: hlAccount.network,
        });
      } catch (err) {
        handleHlError(err);
      }
    });
}
