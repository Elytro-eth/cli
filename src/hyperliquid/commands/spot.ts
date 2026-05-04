import type { Command } from 'commander';
import ora from 'ora';
import type { Address } from 'viem';
import type { AppContext } from '../../context.js';
import { outputResult } from '../../utils/display.js';
import { HlInfoClient } from '../infoClient.js';
import { HlExchangeClient } from '../exchangeClient.js';
import { HlAccountStore } from '../accountMapping.js';
import { withSignerKey } from '../agentWallet.js';
import {
  validateSide,
  validateOrderType,
  validateSize,
  validatePrice,
  validateSlippage,
  validateNotional,
} from '../validators.js';
import {
  buildOrderPreview,
  renderOrderPreview,
  estimateMarketFillPrice,
  confirmPrompt,
} from '../preview.js';
import { floatToWire } from '../signing.js';
import type { HlNetwork } from '../constants.js';
import type { HlOrder } from '../types.js';
import { HyperliquidError, HL_ERR_INVALID_PARAMS } from '../errors.js';
import { resolveHlAccount, requireHlAccount, handleHlError } from './helpers.js';
import { syncContextForAccount } from '../../context.js';

interface SpotOrderOpts {
  coin: string;
  side: string;
  size: string;
  type: string;
  price?: string;
  slippage: string;
  tif: string;
  dryRun?: boolean;
  confirm?: boolean;
  network?: string;
}

export function registerSpotCommands(hl: Command, ctx: AppContext): void {
  const store = new HlAccountStore(ctx.store);

  // ─── spot-order ────────────────────────────────────────────────────────────

  hl
    .command('spot-order')
    .description('Place a spot order (requires --dry-run or --confirm)')
    .argument('[account]', 'Elytro account alias or address')
    .requiredOption('--coin <coin>', 'Spot token name (e.g. HYPE, PURR)')
    .requiredOption('--side <side>', 'buy | sell')
    .requiredOption('--size <size>', 'Order size')
    .option('--type <type>', 'market | limit', 'market')
    .option('--price <price>', 'Limit price (required for limit orders)')
    .option('--slippage <pct>', 'Slippage tolerance percent', '1.0')
    .option('--tif <tif>', 'Time-in-force for limit: Gtc | Ioc | Alo', 'Gtc')
    .option('--dry-run', 'Preview without executing')
    .option('--confirm', 'Execute the order')
    .option('--network <network>', 'Mainnet | Testnet')
    .action(async (target: string | undefined, opts: SpotOrderOpts) => {
      if (!opts.dryRun && !opts.confirm) {
        handleHlError(new Error('Specify --dry-run to preview or --confirm to execute.'));
      }

      try {
        const { account, hlAccount } = await resolveHlAccount(ctx, store, target);
        requireHlAccount(hlAccount, account.alias);

        const network = (opts.network as HlNetwork | undefined) ?? hlAccount.network;
        const coin = opts.coin;
        const side = opts.side;
        const size = parseFloat(opts.size);
        const orderType = opts.type ?? 'market';
        const limitPrice = opts.price ? parseFloat(opts.price) : undefined;
        const slippage = parseFloat(opts.slippage ?? '1.0');
        const tif = opts.tif ?? 'Gtc';

        validateSide(side);
        validateOrderType(orderType);
        validateSize(size);
        validatePrice(limitPrice, orderType);
        validateSlippage(slippage);

        const info = new HlInfoClient(network);
        const [spotMeta, ctxs] = await info.getSpotMetaAndAssetCtxs();

        const marketIdx = spotMeta.universe.findIndex(
          (m) =>
            m.name.toUpperCase() === coin.toUpperCase() ||
            m.name.toUpperCase() === `${coin.toUpperCase()}/USDC`,
        );

        if (marketIdx < 0) {
          const names = spotMeta.universe.map((m) => m.name).join(', ');
          throw new HyperliquidError(
            HL_ERR_INVALID_PARAMS,
            `Spot coin "${coin}" not found. Available: ${names}`,
          );
        }

        const market = spotMeta.universe[marketIdx];
        const assetIndex = 10000 + market.index;

        const ctx_ = ctxs[marketIdx] as Record<string, unknown> | undefined;
        const midStr = ctx_?.['midPx'] as string | undefined;
        const midPrice = midStr ? parseFloat(midStr) : 0;

        const execPrice =
          orderType === 'limit'
            ? limitPrice!
            : estimateMarketFillPrice(side as 'buy' | 'sell', midPrice, slippage);

        validateNotional(size, execPrice, 1);

        const agentInfo = await store.getAgentInfo(hlAccount.hlMainAddress as Address);
        const signerAddress = agentInfo?.agentAddress ?? hlAccount.hlMainAddress;

        const preview = buildOrderPreview({
          coin,
          side: side as 'buy' | 'sell',
          orderType: orderType as 'market' | 'limit',
          size,
          midPrice,
          limitPrice,
          slippagePct: slippage,
          reduceOnly: false,
          hlMainAddress: hlAccount.hlMainAddress,
          signerAddress: signerAddress as string,
          signerRole: agentInfo ? 'agent' : 'main-account',
          network,
        });

        renderOrderPreview(preview);

        if (opts.dryRun) {
          outputResult({ dryRun: true, preview });
          return;
        }

        const confirmed = await confirmPrompt('Execute this spot order?');
        if (!confirmed) {
          outputResult({ status: 'cancelled' });
          return;
        }

        const spinner = ora('Submitting spot order...').start();
        await syncContextForAccount(ctx, account);

        const wirePrice =
          orderType === 'limit' ? floatToWire(limitPrice!) : floatToWire(execPrice);

        const order: HlOrder = {
          a: assetIndex,
          b: side === 'buy',
          p: wirePrice,
          s: floatToWire(size),
          r: false,
          t:
            orderType === 'limit'
              ? { limit: { tif: tif as 'Gtc' | 'Ioc' | 'Alo' } }
              : { limit: { tif: 'Ioc' } },
        };

        const exchange = new HlExchangeClient(network);
        const result = await withSignerKey(
          ctx.keyring,
          store,
          hlAccount.hlMainAddress as Address,
          async () => exchange.placeOrder(ctx.keyring, { orders: [order] }),
        );

        spinner.succeed('Spot order submitted.');
        outputResult({ status: 'submitted', result, preview });
      } catch (err) {
        handleHlError(err);
      }
    });
}
