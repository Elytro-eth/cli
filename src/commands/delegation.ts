import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { isAddress } from 'viem';
import type { Address } from 'viem';
import type { AppContext } from '../context';
import { outputError, outputResult } from '../utils/display';
import type { DelegationInfo } from '../types';

const ERR_INVALID_PARAMS = -32602;
const ERR_ACCOUNT_NOT_READY = -32002;

function parseAddress(label: string, value: string): Address {
  if (!isAddress(value)) {
    throw new Error(`${label} must be a valid address.`);
  }
  return value as Address;
}

function ensureHex(label: string, value: string): string {
  if (!value || !value.startsWith('0x')) {
    throw new Error(`${label} must be a 0x-prefixed hex string.`);
  }
  return value;
}

function mapDelegation(d: DelegationInfo) {
  return {
    id: d.id,
    manager: d.manager,
    token: d.token,
    payee: d.payee,
    amount: d.amount,
    permissionContext: d.permissionContext,
    expiresAt: d.expiresAt ?? null,
    note: d.note ?? null,
  };
}

export function registerDelegationCommand(program: Command, ctx: AppContext): void {
  const delegationCmd = program.command('delegation').description('Manage ERC-7710 delegations for x402');

  delegationCmd
    .command('list')
    .description('List delegations stored for an account')
    .option('--account <aliasOrAddress>', 'Account alias/address (default: current)')
    .action((options: { account?: string }) => {
      try {
        const delegations = ctx.account.listDelegations(options.account);
        outputResult({ delegations: delegations.map(mapDelegation) });
      } catch (err) {
        outputError(
          err instanceof Error && err.message.includes('No active account') ? ERR_ACCOUNT_NOT_READY : ERR_INVALID_PARAMS,
          (err as Error).message
        );
      }
    });

  delegationCmd
    .command('add')
    .description('Add an existing delegation (permission context) to an account')
    .requiredOption('--manager <address>', 'DelegationManager contract address')
    .requiredOption('--token <address>', 'Token contract address')
    .requiredOption('--payee <address>', 'Recipient/payee address this delegation covers')
    .requiredOption('--amount <amount>', 'Authorized amount (token smallest unit)')
    .requiredOption('--permission <hex>', 'Permission context blob provided by the manager/server')
    .option('--account <aliasOrAddress>', 'Account alias/address (default: current)')
    .option('--id <id>', 'Custom delegation identifier (default: random UUID)')
    .option('--expires-at <iso>', 'Optional expiration timestamp (ISO 8601)')
    .option('--note <text>', 'Optional note/description')
    .action(async (options: {
      manager: string;
      token: string;
      payee: string;
      amount: string;
      permission: string;
      account?: string;
      id?: string;
      expiresAt?: string;
      note?: string;
    }) => {
      try {
        if (!options.amount) {
          throw new Error('Amount is required.');
        }

        const delegation: DelegationInfo = {
          id: options.id ?? randomUUID(),
          manager: parseAddress('manager', options.manager),
          token: parseAddress('token', options.token),
          payee: parseAddress('payee', options.payee),
          amount: options.amount,
          permissionContext: ensureHex('permission', options.permission),
          ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
          ...(options.note ? { note: options.note } : {}),
        };

        await ctx.account.addDelegation(options.account, delegation);
        outputResult({ delegation: mapDelegation(delegation) });
      } catch (err) {
        outputError(
          err instanceof Error && err.message.includes('No active account') ? ERR_ACCOUNT_NOT_READY : ERR_INVALID_PARAMS,
          (err as Error).message
        );
      }
    });

  delegationCmd
    .command('show <delegationId>')
    .description('Show a specific delegation')
    .option('--account <aliasOrAddress>', 'Account alias/address (default: current)')
    .action((delegationId: string, options: { account?: string }) => {
      try {
        const delegation = ctx.account.getDelegation(options.account, delegationId);
        if (!delegation) {
          outputError(ERR_INVALID_PARAMS, `Delegation "${delegationId}" not found.`);
          return;
        }
        outputResult({ delegation: mapDelegation(delegation) });
      } catch (err) {
        outputError(
          err instanceof Error && err.message.includes('No active account') ? ERR_ACCOUNT_NOT_READY : ERR_INVALID_PARAMS,
          (err as Error).message
        );
      }
    });

  delegationCmd
    .command('remove <delegationId>')
    .description('Remove a stored delegation')
    .option('--account <aliasOrAddress>', 'Account alias/address (default: current)')
    .action(async (delegationId: string, options: { account?: string }) => {
      try {
        await ctx.account.removeDelegation(options.account, delegationId);
        outputResult({ removed: delegationId });
      } catch (err) {
        outputError(
          err instanceof Error && err.message.includes('No active account') ? ERR_ACCOUNT_NOT_READY : ERR_INVALID_PARAMS,
          (err as Error).message
        );
      }
    });
}
