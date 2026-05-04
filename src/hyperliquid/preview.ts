import chalk from 'chalk';
import type { OrderSide, OrderType, OrderPreview, FundPreview } from './types.js';
import type { HlNetwork } from './constants.js';

const TAKER_FEE_BPS = 2.5; // 0.025% taker fee (approximate, varies by tier)

/**
 * Estimate fill price for a market order given mid price and slippage.
 * Buy orders fill higher, sell orders fill lower.
 */
export function estimateMarketFillPrice(
  side: OrderSide,
  midPrice: number,
  slippagePct: number,
): number {
  const slip = midPrice * (slippagePct / 100);
  const raw = side === 'buy' ? midPrice + slip : midPrice - slip;
  // HL requires prices rounded to 5 significant figures (mirrors Python SDK: f"{px:.5g}")
  return parseFloat(raw.toPrecision(5));
}

/**
 * Estimate taker fee for an order.
 */
export function estimateFee(notional: number): number {
  return (notional * TAKER_FEE_BPS) / 10000;
}

/**
 * Build an order preview object (used for --dry-run display).
 */
export function buildOrderPreview(params: {
  coin: string;
  side: OrderSide;
  orderType: OrderType;
  size: number;
  midPrice: number | null;
  limitPrice?: number;
  slippagePct?: number;
  reduceOnly?: boolean;
  hlMainAddress: string;
  signerAddress: string;
  signerRole: 'main-account' | 'agent';
  network: HlNetwork;
}): OrderPreview {
  const mid = params.midPrice ?? 0;
  const price =
    params.orderType === 'limit'
      ? (params.limitPrice ?? mid)
      : estimateMarketFillPrice(params.side, mid, params.slippagePct ?? 0.5);

  const notional = params.size * price;
  const fee = estimateFee(notional);

  return {
    action: `${params.side.toUpperCase()} ${params.coin} ${params.orderType.toUpperCase()}`,
    coin: params.coin,
    side: params.side,
    orderType: params.orderType,
    estimatedSize: params.size.toString(),
    estimatedPrice: price.toFixed(4),
    estimatedFee: fee.toFixed(4),
    estimatedNotional: notional.toFixed(2),
    slippage: params.slippagePct !== undefined ? `${params.slippagePct}%` : undefined,
    reduceOnly: params.reduceOnly ?? false,
    hlMainAddress: params.hlMainAddress,
    signerAddress: params.signerAddress,
    signerRole: params.signerRole,
    network: params.network,
  };
}

/**
 * Build a fund movement preview object.
 */
export function buildFundPreview(params: {
  action: string;
  amount: string;
  fromAddress?: string;
  toAddress?: string;
  fee?: string;
  estimatedTime?: string;
  network: HlNetwork;
}): FundPreview {
  return { ...params };
}

// ─── Terminal rendering ───────────────────────────────────────────────────────

function row(label: string, value: string): void {
  console.log(`  ${chalk.gray(label.padEnd(22))} ${value}`);
}

export function renderOrderPreview(preview: OrderPreview): void {
  const networkColor =
    preview.network === 'Mainnet' ? chalk.red.bold : chalk.yellow.bold;

  console.log('');
  console.log(chalk.bold.cyan('─── Hyperliquid Order Preview ──────────────────────'));
  row('Action:', chalk.bold(preview.action));
  row('Coin:', preview.coin);
  row('Size:', preview.estimatedSize);
  row('Est. Price:', `$${preview.estimatedPrice}`);
  row('Est. Notional:', `$${preview.estimatedNotional}`);
  row('Est. Fee:', `$${preview.estimatedFee}`);
  if (preview.slippage) row('Slippage:', preview.slippage);
  if (preview.reduceOnly) row('Reduce Only:', 'yes');
  console.log(chalk.gray('  ' + '─'.repeat(46)));
  row('HL Main Account:', shortenAddr(preview.hlMainAddress));
  row('Signer:', `${shortenAddr(preview.signerAddress)} (${preview.signerRole})`);
  row('Network:', networkColor(preview.network));
  if (preview.network === 'Mainnet') {
    console.log('');
    console.log(chalk.red('  ⚠  MAINNET — real funds at risk'));
    console.log(chalk.yellow('  ⚠  SecurityHook/OTP does NOT protect HL trades'));
  }
  console.log('');
}

export function renderFundPreview(preview: FundPreview): void {
  const networkColor =
    preview.network === 'Mainnet' ? chalk.red.bold : chalk.yellow.bold;

  console.log('');
  console.log(chalk.bold.cyan('─── Hyperliquid Fund Movement Preview ──────────────'));
  row('Action:', chalk.bold(preview.action));
  row('Amount:', preview.amount);
  if (preview.fromAddress) row('From:', shortenAddr(preview.fromAddress));
  if (preview.toAddress) row('To:', shortenAddr(preview.toAddress));
  if (preview.fee) row('Fee:', preview.fee);
  if (preview.estimatedTime) row('Est. Time:', preview.estimatedTime);
  row('Network:', networkColor(preview.network));
  if (preview.network === 'Mainnet') {
    console.log('');
    console.log(chalk.red('  ⚠  MAINNET — real funds at risk'));
  }
  console.log('');
}

function shortenAddr(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

/**
 * Ask for TTY confirmation. Returns true if confirmed.
 * Non-TTY contexts (piped / scripted) require explicit --confirm flag.
 */
export async function confirmPrompt(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return true;
  const { input } = await import('@inquirer/prompts');
  const answer = await input({ message: `${message} (type CONFIRM to execute): ` });
  return answer.trim() === 'CONFIRM';
}
