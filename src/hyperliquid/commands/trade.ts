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
  validateCoin,
  validateNotional,
  checkSlippageBreached,
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
import { resolveHlAccount, requireHlAccount, handleHlError } from './helpers.js';
import { syncContextForAccount } from '../../context.js';

// Commander converts --dry-run → dryRun, --reduce-only → reduceOnly, etc.
interface OrderOpts {
  coin: string;
  side: string;
  size: string;
  type: string;
  price?: string;
  slippage: string;
  reduceOnly?: boolean;
  tif: string;
  dryRun?: boolean;
  confirm?: boolean;
  network?: string;
}

interface CloseOpts {
  coin: string;
  slippage: string;
  dryRun?: boolean;
  confirm?: boolean;
  network?: string;
}

interface CancelOpts {
  coin: string;
  orderId: string;
  dryRun?: boolean;
  confirm?: boolean;
  network?: string;
}

interface TpslOpts {
  coin: string;
  tpPx?: string;
  slPx?: string;
  dryRun?: boolean;
  confirm?: boolean;
  network?: string;
}

export function registerTradeCommands(hl: Command, ctx: AppContext): void {
  const store = new HlAccountStore(ctx.store);

  // ─── order ─────────────────────────────────────────────────────────────────

  hl
    .command('order')
    .description('Place a perpetual order (requires --dry-run or --confirm)')
    .argument('[account]', 'Elytro account alias or address')
    .requiredOption('--coin <coin>', 'Asset to trade (e.g. ETH, BTC)')
    .requiredOption('--side <side>', 'buy | sell')
    .requiredOption('--size <size>', 'Order size in asset units')
    .option('--type <type>', 'market | limit', 'market')
    .option('--price <price>', 'Limit price (required for limit orders)')
    .option('--slippage <pct>', 'Slippage tolerance in percent', '1.0')
    .option('--reduce-only', 'Reduce-only order')
    .option('--tif <tif>', 'Time-in-force for limit orders: Gtc | Ioc | Alo', 'Gtc')
    .option('--dry-run', 'Preview order without executing')
    .option('--confirm', 'Execute the order after showing preview')
    .option('--network <network>', 'Mainnet | Testnet')
    .action(async (target: string | undefined, opts: OrderOpts) => {
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
        const reduceOnly = opts.reduceOnly === true;
        const tif = opts.tif ?? 'Gtc';

        validateSide(side);
        validateOrderType(orderType);
        validateSize(size);
        validatePrice(limitPrice, orderType);
        validateSlippage(slippage);

        const info = new HlInfoClient(network);
        const [meta, mids] = await Promise.all([info.getMeta(), info.getAllMids()]);

        validateCoin(meta, coin);
        const assetIndex = meta.universe.findIndex(
          (a) => a.name.toUpperCase() === coin.toUpperCase(),
        );

        const midStr = mids[coin.toUpperCase()] ?? mids[coin];
        const midPrice = midStr ? parseFloat(midStr) : 0;

        const execPrice =
          orderType === 'limit'
            ? limitPrice!
            : estimateMarketFillPrice(side as 'buy' | 'sell', midPrice, slippage);

        validateNotional(size, execPrice);

        if (orderType === 'market' && midPrice > 0) {
          checkSlippageBreached(side as 'buy' | 'sell', midPrice, execPrice, slippage);
        }

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
          reduceOnly,
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

        const confirmed = await confirmPrompt('Execute this order?');
        if (!confirmed) {
          outputResult({ status: 'cancelled', preview });
          return;
        }

        const spinner = ora('Submitting order...').start();
        await syncContextForAccount(ctx, account);

        const wirePrice =
          orderType === 'limit' ? floatToWire(limitPrice!) : floatToWire(execPrice);

        const order: HlOrder = {
          a: assetIndex,
          b: side === 'buy',
          p: wirePrice,
          s: floatToWire(size),
          r: reduceOnly,
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

        spinner.succeed('Order submitted.');
        outputResult({ status: 'submitted', result, preview });
      } catch (err) {
        handleHlError(err);
      }
    });

  // ─── close ─────────────────────────────────────────────────────────────────

  hl
    .command('close')
    .description('Close an open position (market, reduce-only)')
    .argument('[account]', 'Elytro account alias or address')
    .requiredOption('--coin <coin>', 'Coin to close')
    .option('--slippage <pct>', 'Slippage tolerance percent', '1.0')
    .option('--dry-run', 'Preview close without executing')
    .option('--confirm', 'Execute close')
    .option('--network <network>', 'Mainnet | Testnet')
    .action(async (target: string | undefined, opts: CloseOpts) => {
      if (!opts.dryRun && !opts.confirm) {
        handleHlError(new Error('Specify --dry-run to preview or --confirm to execute.'));
      }

      try {
        const { account, hlAccount } = await resolveHlAccount(ctx, store, target);
        requireHlAccount(hlAccount, account.alias);

        const network = (opts.network as HlNetwork | undefined) ?? hlAccount.network;
        const coin = opts.coin;
        const slippage = parseFloat(opts.slippage ?? '1.0');
        validateSlippage(slippage);

        const info = new HlInfoClient(network);
        const [meta, state, mids] = await Promise.all([
          info.getMeta(),
          info.getClearinghouseState(hlAccount.hlMainAddress as Address),
          info.getAllMids(),
        ]);

        validateCoin(meta, coin);
        const assetIndex = meta.universe.findIndex(
          (a) => a.name.toUpperCase() === coin.toUpperCase(),
        );

        const pos = state.assetPositions.find(
          (p) => p.position.coin.toUpperCase() === coin.toUpperCase(),
        );

        if (!pos || parseFloat(pos.position.szi) === 0) {
          handleHlError(new Error(`No open position for ${coin}.`));
        }

        const posSize = parseFloat(pos!.position.szi);
        const closeSide = posSize > 0 ? 'sell' : 'buy';
        const closeSize = Math.abs(posSize);
        const midStr = mids[coin.toUpperCase()];
        const midPrice = midStr ? parseFloat(midStr) : 0;
        const execPrice = estimateMarketFillPrice(closeSide, midPrice, slippage);

        const agentInfo = await store.getAgentInfo(hlAccount.hlMainAddress as Address);
        const signerAddress = agentInfo?.agentAddress ?? hlAccount.hlMainAddress;

        const preview = buildOrderPreview({
          coin,
          side: closeSide,
          orderType: 'market',
          size: closeSize,
          midPrice,
          slippagePct: slippage,
          reduceOnly: true,
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

        const confirmed = await confirmPrompt('Close this position?');
        if (!confirmed) {
          outputResult({ status: 'cancelled' });
          return;
        }

        const spinner = ora('Closing position...').start();
        await syncContextForAccount(ctx, account);

        const order: HlOrder = {
          a: assetIndex,
          b: closeSide === 'buy',
          p: floatToWire(execPrice),
          s: floatToWire(closeSize),
          r: true,
          t: { limit: { tif: 'Ioc' } },
        };

        const exchange = new HlExchangeClient(network);
        const result = await withSignerKey(
          ctx.keyring,
          store,
          hlAccount.hlMainAddress as Address,
          async () => exchange.placeOrder(ctx.keyring, { orders: [order] }),
        );

        spinner.succeed('Position closed.');
        outputResult({ status: 'closed', result });
      } catch (err) {
        handleHlError(err);
      }
    });

  // ─── cancel ────────────────────────────────────────────────────────────────

  hl
    .command('cancel')
    .description('Cancel an open order')
    .argument('[account]', 'Elytro account alias or address')
    .requiredOption('--coin <coin>', 'Coin')
    .requiredOption('--order-id <id>', 'Order ID (oid)')
    .option('--dry-run', 'Preview cancel')
    .option('--confirm', 'Execute cancel')
    .option('--network <network>', 'Mainnet | Testnet')
    .action(async (target: string | undefined, opts: CancelOpts) => {
      if (!opts.dryRun && !opts.confirm) {
        handleHlError(new Error('Specify --dry-run to preview or --confirm to execute.'));
      }

      try {
        const { account, hlAccount } = await resolveHlAccount(ctx, store, target);
        requireHlAccount(hlAccount, account.alias);

        const network = (opts.network as HlNetwork | undefined) ?? hlAccount.network;
        const coin = opts.coin;
        const oid = parseInt(opts.orderId, 10);

        if (!Number.isFinite(oid)) {
          handleHlError(new Error('Invalid --order-id. Must be a number.'));
        }

        const info = new HlInfoClient(network);
        const meta = await info.getMeta();
        validateCoin(meta, coin);
        const assetIndex = meta.universe.findIndex(
          (a) => a.name.toUpperCase() === coin.toUpperCase(),
        );

        if (opts.dryRun) {
          outputResult({ dryRun: true, coin, oid, assetIndex, action: 'cancel' });
          return;
        }

        const confirmed = await confirmPrompt(`Cancel order ${oid} for ${coin}?`);
        if (!confirmed) {
          outputResult({ status: 'cancelled' });
          return;
        }

        const spinner = ora('Cancelling order...').start();
        await syncContextForAccount(ctx, account);

        const exchange = new HlExchangeClient(network);
        const result = await withSignerKey(
          ctx.keyring,
          store,
          hlAccount.hlMainAddress as Address,
          async () => exchange.cancelOrder(ctx.keyring, [{ a: assetIndex, o: oid }]),
        );

        spinner.succeed('Order cancelled.');
        outputResult({ status: 'cancelled', oid, result });
      } catch (err) {
        handleHlError(err);
      }
    });

  // ─── tpsl ──────────────────────────────────────────────────────────────────

  hl
    .command('tpsl')
    .description('Set take-profit and/or stop-loss for a position')
    .argument('[account]', 'Elytro account alias or address')
    .requiredOption('--coin <coin>', 'Coin')
    .option('--tp-px <price>', 'Take-profit trigger price')
    .option('--sl-px <price>', 'Stop-loss trigger price')
    .option('--dry-run', 'Preview')
    .option('--confirm', 'Execute')
    .option('--network <network>', 'Mainnet | Testnet')
    .action(async (target: string | undefined, opts: TpslOpts) => {
      if (!opts.dryRun && !opts.confirm) {
        handleHlError(new Error('Specify --dry-run to preview or --confirm to execute.'));
      }
      if (!opts.tpPx && !opts.slPx) {
        handleHlError(new Error('Specify at least one of --tp-px or --sl-px.'));
      }

      try {
        const { account, hlAccount } = await resolveHlAccount(ctx, store, target);
        requireHlAccount(hlAccount, account.alias);

        const network = (opts.network as HlNetwork | undefined) ?? hlAccount.network;
        const coin = opts.coin;
        const tpPx = opts.tpPx ? parseFloat(opts.tpPx) : undefined;
        const slPx = opts.slPx ? parseFloat(opts.slPx) : undefined;

        const info = new HlInfoClient(network);
        const [meta, state] = await Promise.all([
          info.getMeta(),
          info.getClearinghouseState(hlAccount.hlMainAddress as Address),
        ]);

        validateCoin(meta, coin);
        const assetIndex = meta.universe.findIndex(
          (a) => a.name.toUpperCase() === coin.toUpperCase(),
        );

        const pos = state.assetPositions.find(
          (p) => p.position.coin.toUpperCase() === coin.toUpperCase(),
        );

        if (!pos || parseFloat(pos.position.szi) === 0) {
          handleHlError(new Error(`No open position for ${coin}.`));
        }

        const posSize = parseFloat(pos!.position.szi);
        const closeSide = posSize > 0 ? 'sell' : 'buy';
        const closeSize = Math.abs(posSize);

        if (opts.dryRun) {
          outputResult({
            dryRun: true,
            coin,
            positionSize: posSize,
            closeSide,
            tpPrice: tpPx ?? null,
            slPrice: slPx ?? null,
          });
          return;
        }

        const confirmed = await confirmPrompt(`Set TP/SL for ${coin} position?`);
        if (!confirmed) {
          outputResult({ status: 'cancelled' });
          return;
        }

        const spinner = ora('Setting TP/SL...').start();
        await syncContextForAccount(ctx, account);

        const exchange = new HlExchangeClient(network);

        const tpslOrders: HlOrder[] = [];

        if (tpPx !== undefined) {
          tpslOrders.push({
            a: assetIndex,
            b: closeSide === 'buy',
            p: floatToWire(tpPx),
            s: floatToWire(closeSize),
            r: true,
            t: { trigger: { isMarket: true, triggerPx: floatToWire(tpPx), tpsl: 'tp' } },
          });
        }

        if (slPx !== undefined) {
          tpslOrders.push({
            a: assetIndex,
            b: closeSide === 'buy',
            p: floatToWire(slPx),
            s: floatToWire(closeSize),
            r: true,
            t: { trigger: { isMarket: true, triggerPx: floatToWire(slPx), tpsl: 'sl' } },
          });
        }

        const result = await withSignerKey(
          ctx.keyring,
          store,
          hlAccount.hlMainAddress as Address,
          async () => exchange.placeOrder(ctx.keyring, { orders: tpslOrders, grouping: 'positionTpsl' }),
        );

        spinner.succeed('TP/SL set.');
        outputResult({ status: 'set', result });
      } catch (err) {
        handleHlError(err);
      }
    });
}
