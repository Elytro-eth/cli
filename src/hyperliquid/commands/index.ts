import type { Command } from 'commander';
import chalk from 'chalk';
import type { AppContext } from '../../context.js';
import { registerReadCommands } from './read.js';
import { registerSetupCommands } from './setup.js';
import { registerTradeCommands } from './trade.js';
import { registerSpotCommands } from './spot.js';
import { registerFundCommands } from './funds.js';
import { registerBuilderCommands } from './builder.js';

export function registerHyperliquidCommand(program: Command, ctx: AppContext): void {
  const hl = program
    .command('hyperliquid')
    .description('Native Hyperliquid perpetual and spot trading')
    .addHelpText(
      'after',
      [
        '',
        chalk.yellow('  Security notice:'),
        '  Hyperliquid trades are signed directly by your Elytro EOA or an agent wallet.',
        '  The Elytro SecurityHook (2FA / OTP / spending limit) does NOT automatically',
        '  protect Hyperliquid exchange actions unless you explicitly gate them here.',
        '',
        chalk.cyan('  Quick start:'),
        '    elytro hyperliquid init',
        '    elytro hyperliquid signer create-agent',
        '    elytro hyperliquid balances',
        '    elytro hyperliquid order --coin ETH --side buy --size 0.01 --type market --dry-run',
        '',
      ].join('\n'),
    );

  registerReadCommands(hl, ctx);
  registerSetupCommands(hl, ctx);
  registerTradeCommands(hl, ctx);
  registerSpotCommands(hl, ctx);
  registerFundCommands(hl, ctx);
  registerBuilderCommands(hl, ctx);
}
