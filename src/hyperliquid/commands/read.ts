import type { Command } from 'commander';
import ora from 'ora';
import type { Address } from 'viem';
import type { AppContext } from '../../context.js';
import { outputResult, outputError, sanitizeErrorMessage } from '../../utils/display.js';
import { HlInfoClient } from '../infoClient.js';
import { HlAccountStore } from '../accountMapping.js';
import { defaultHlNetwork } from '../constants.js';
import type { HlNetwork } from '../constants.js';
import { HyperliquidError } from '../errors.js';
import { resolveHlAccount } from './helpers.js';

export function registerReadCommands(hl: Command, ctx: AppContext): void {
  const store = new HlAccountStore(ctx.store);

  // ─── address ───────────────────────────────────────────────────────────────

  hl
    .command('address')
    .description('Show Hyperliquid account and signer addresses')
    .argument('[account]', 'Elytro account alias or address')
    .option('--network <network>', 'Hyperliquid network: Mainnet | Testnet')
    .action(async (target?: string, opts?: { network?: string }) => {
      try {
        const { account, hlAccount } = await resolveHlAccount(ctx, store, target);
        const network = (opts?.network as HlNetwork) ?? hlAccount?.network ?? defaultHlNetwork();

        outputResult({
          elytroAccount: account.alias,
          elytroAddress: account.address,
          hlMainAddress: hlAccount?.hlMainAddress ?? account.owner,
          agentAddress: hlAccount?.agentAddress ?? null,
          agentName: hlAccount?.agentName ?? null,
          network,
        });
      } catch (err) {
        handleHlError(err);
      }
    });

  // ─── balances ──────────────────────────────────────────────────────────────

  hl
    .command('balances')
    .description('Show Hyperliquid perp account balances and margin summary')
    .argument('[account]', 'Elytro account alias or address')
    .option('--network <network>', 'Mainnet | Testnet')
    .action(async (target?: string, opts?: { network?: string }) => {
      const spinner = ora('Fetching balances...').start();
      try {
        const { account, hlAccount } = await resolveHlAccount(ctx, store, target);
        const network = (opts?.network as HlNetwork) ?? hlAccount?.network ?? defaultHlNetwork();
        const user = (hlAccount?.hlMainAddress ?? account.owner) as Address;

        const info = new HlInfoClient(network);
        const state = await info.getClearinghouseState(user);
        spinner.stop();

        outputResult({
          account: account.alias,
          hlAddress: user,
          network,
          accountValue: state.marginSummary.accountValue,
          withdrawable: state.withdrawable,
          totalMarginUsed: state.marginSummary.totalMarginUsed,
          totalNotional: state.marginSummary.totalNtlPos,
        });
      } catch (err) {
        spinner.stop();
        handleHlError(err);
      }
    });

  // ─── positions ─────────────────────────────────────────────────────────────

  hl
    .command('positions')
    .description('Show open Hyperliquid perp positions')
    .argument('[account]', 'Elytro account alias or address')
    .option('--coin <coin>', 'Filter by coin (e.g. ETH, BTC)')
    .option('--network <network>', 'Mainnet | Testnet')
    .action(async (target?: string, opts?: { coin?: string; network?: string }) => {
      const spinner = ora('Fetching positions...').start();
      try {
        const { account, hlAccount } = await resolveHlAccount(ctx, store, target);
        const network = (opts?.network as HlNetwork) ?? hlAccount?.network ?? defaultHlNetwork();
        const user = (hlAccount?.hlMainAddress ?? account.owner) as Address;

        const info = new HlInfoClient(network);
        const state = await info.getClearinghouseState(user);
        spinner.stop();

        let positions = state.assetPositions
          .filter((p) => parseFloat(p.position.szi) !== 0);

        if (opts?.coin) {
          positions = positions.filter(
            (p) => p.position.coin.toUpperCase() === opts.coin!.toUpperCase(),
          );
        }

        outputResult({
          account: account.alias,
          hlAddress: user,
          network,
          positions: positions.map((p) => ({
            coin: p.position.coin,
            size: p.position.szi,
            entryPrice: p.position.entryPx,
            markPrice: null,
            unrealizedPnl: p.position.unrealizedPnl,
            leverage: p.position.leverage,
            liquidationPrice: p.position.liquidationPx,
            marginUsed: p.position.marginUsed,
          })),
          count: positions.length,
        });
      } catch (err) {
        spinner.stop();
        handleHlError(err);
      }
    });

  // ─── orders ────────────────────────────────────────────────────────────────

  hl
    .command('orders')
    .description('Show open Hyperliquid orders')
    .argument('[account]', 'Elytro account alias or address')
    .option('--coin <coin>', 'Filter by coin')
    .option('--network <network>', 'Mainnet | Testnet')
    .action(async (target?: string, opts?: { coin?: string; network?: string }) => {
      const spinner = ora('Fetching open orders...').start();
      try {
        const { account, hlAccount } = await resolveHlAccount(ctx, store, target);
        const network = (opts?.network as HlNetwork) ?? hlAccount?.network ?? defaultHlNetwork();
        const user = (hlAccount?.hlMainAddress ?? account.owner) as Address;

        const info = new HlInfoClient(network);
        let orders = await info.getOpenOrders(user);
        spinner.stop();

        if (opts?.coin) {
          orders = orders.filter(
            (o) => o.coin.toUpperCase() === opts.coin!.toUpperCase(),
          );
        }

        outputResult({
          account: account.alias,
          hlAddress: user,
          network,
          orders: orders.map((o) => ({
            oid: o.oid,
            coin: o.coin,
            side: o.side === 'B' ? 'buy' : 'sell',
            size: o.sz,
            limitPrice: o.limitPx,
            orderType: o.orderType,
            reduceOnly: o.reduceOnly,
            timestamp: new Date(o.timestamp).toISOString(),
          })),
          count: orders.length,
        });
      } catch (err) {
        spinner.stop();
        handleHlError(err);
      }
    });

  // ─── prices ────────────────────────────────────────────────────────────────

  hl
    .command('prices')
    .description('Show mid prices for perp markets')
    .option('--coin <coin>', 'Filter to a specific coin')
    .option('--network <network>', 'Mainnet | Testnet')
    .action(async (opts?: { coin?: string; network?: string }) => {
      const spinner = ora('Fetching prices...').start();
      try {
        const network = (opts?.network as HlNetwork) ?? defaultHlNetwork();
        const info = new HlInfoClient(network);
        const mids = await info.getAllMids();
        spinner.stop();

        if (opts?.coin) {
          const upper = opts.coin.toUpperCase();
          const price = mids[upper];
          if (!price) {
            outputError(-32602, `Coin "${opts.coin}" not found.`);
          }
          outputResult({ coin: upper, midPrice: price, network });
        } else {
          const prices = Object.entries(mids).map(([coin, price]) => ({ coin, midPrice: price }));
          outputResult({ prices, count: prices.length, network });
        }
      } catch (err) {
        spinner.stop();
        handleHlError(err);
      }
    });

  // ─── markets ───────────────────────────────────────────────────────────────

  hl
    .command('markets')
    .description('Show available Hyperliquid markets')
    .option('--type <type>', 'perp | spot', 'perp')
    .option('--coin <coin>', 'Filter by coin')
    .option('--network <network>', 'Mainnet | Testnet')
    .action(async (opts?: { type?: string; coin?: string; network?: string }) => {
      const spinner = ora('Fetching markets...').start();
      try {
        const network = (opts?.network as HlNetwork) ?? defaultHlNetwork();
        const info = new HlInfoClient(network);

        if (opts?.type === 'spot') {
          const meta = await info.getSpotMeta();
          spinner.stop();
          let markets = meta.universe;
          if (opts?.coin) {
            markets = markets.filter(
              (m) => m.name.toUpperCase().includes(opts.coin!.toUpperCase()),
            );
          }
          outputResult({ type: 'spot', markets, count: markets.length, network });
        } else {
          const meta = await info.getMeta();
          spinner.stop();
          let markets = meta.universe;
          if (opts?.coin) {
            markets = markets.filter(
              (m) => m.name.toUpperCase() === opts.coin!.toUpperCase(),
            );
          }
          outputResult({
            type: 'perp',
            markets: markets.map((m, i) => ({
              index: i,
              name: m.name,
              maxLeverage: m.maxLeverage,
              szDecimals: m.szDecimals,
            })),
            count: markets.length,
            network,
          });
        }
      } catch (err) {
        spinner.stop();
        handleHlError(err);
      }
    });

  // ─── spot-balances ─────────────────────────────────────────────────────────

  hl
    .command('spot-balances')
    .description('Show Hyperliquid spot token balances')
    .argument('[account]', 'Elytro account alias or address')
    .option('--network <network>', 'Mainnet | Testnet')
    .action(async (target?: string, opts?: { network?: string }) => {
      const spinner = ora('Fetching spot balances...').start();
      try {
        const { account, hlAccount } = await resolveHlAccount(ctx, store, target);
        const network = (opts?.network as HlNetwork) ?? hlAccount?.network ?? defaultHlNetwork();
        const user = (hlAccount?.hlMainAddress ?? account.owner) as Address;

        const info = new HlInfoClient(network);
        const state = await info.getSpotClearinghouseState(user);
        spinner.stop();

        outputResult({
          account: account.alias,
          hlAddress: user,
          network,
          balances: state.balances.filter((b) => parseFloat(b.total) > 0),
        });
      } catch (err) {
        spinner.stop();
        handleHlError(err);
      }
    });

  // ─── spot-prices ───────────────────────────────────────────────────────────

  hl
    .command('spot-prices')
    .description('Show Hyperliquid spot market prices')
    .option('--coin <coin>', 'Filter by token name (e.g. HYPE)')
    .option('--network <network>', 'Mainnet | Testnet')
    .action(async (opts?: { coin?: string; network?: string }) => {
      const spinner = ora('Fetching spot prices...').start();
      try {
        const network = (opts?.network as HlNetwork) ?? defaultHlNetwork();
        const info = new HlInfoClient(network);
        const [meta, ctxs] = await info.getSpotMetaAndAssetCtxs();
        spinner.stop();

        let markets = meta.universe.map((m, i) => ({
          name: m.name,
          index: m.index,
          context: ctxs[i],
        }));

        if (opts?.coin) {
          markets = markets.filter((m) =>
            m.name.toUpperCase().includes(opts.coin!.toUpperCase()),
          );
        }

        outputResult({
          markets: markets.map((m) => ({
            name: m.name,
            markPrice: (m.context as Record<string, unknown>)?.['markPx'] ?? null,
            midPrice: (m.context as Record<string, unknown>)?.['midPx'] ?? null,
          })),
          count: markets.length,
          network,
        });
      } catch (err) {
        spinner.stop();
        handleHlError(err);
      }
    });
}

// ─── Error handler ───────────────────────────────────────────────────────────

function handleHlError(err: unknown): never {
  if (err instanceof HyperliquidError) {
    outputError(err.code, err.message, err.data);
  }
  outputError(-32000, sanitizeErrorMessage((err as Error).message ?? String(err)));
}
