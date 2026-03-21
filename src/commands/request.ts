import { Command } from 'commander';
import { outputError, outputResult } from '../utils/display';
import type { AppContext } from '../context';
import { X402Service } from '../services/x402';

interface RequestOptions {
  method?: string;
  header?: string[];
  body?: string;
  json?: string;
  account?: string;
  dryRun?: boolean;
  verbose?: boolean;
}

function parseHeaders(values: string[] | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!values) return headers;
  for (const entry of values) {
    const idx = entry.indexOf(':');
    if (idx === -1) {
      throw new Error(`Invalid header "${entry}". Use "Key: Value" format.`);
    }
    const key = entry.slice(0, idx).trim();
    const value = entry.slice(idx + 1).trim();
    if (!key) {
      throw new Error(`Header "${entry}" has an empty key.`);
    }
    headers[key] = value;
  }
  return headers;
}

function buildBody(options: RequestOptions, headers: Record<string, string>): string | undefined {
  if (options.body && options.json) {
    throw new Error('Use either --body or --json, not both.');
  }
  if (options.json) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(options.json);
    } catch (err) {
      throw new Error(`Invalid JSON for --json: ${(err as Error).message}`);
    }
    const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === 'content-type');
    if (!hasContentType) {
      headers['Content-Type'] = 'application/json';
    }
    return JSON.stringify(parsed);
  }
  return options.body;
}

export function registerRequestCommand(program: Command, ctx: AppContext): void {
  const x402 = new X402Service({ account: ctx.account, keyring: ctx.keyring, sdk: ctx.sdk });

  program
    .command('request')
    .description('Send an HTTP request with automatic x402 payment handling')
    .argument('<url>', 'Target URL')
    .option('--method <method>', 'HTTP method (default: GET)')
    .option('--header <key:value>', 'Custom headers', (value, prev: string[]) => {
      prev.push(value);
      return prev;
    }, [])
    .option('--body <string>', 'Raw request body (string)')
    .option('--json <json>', 'JSON body (stringified). Sets Content-Type: application/json if missing.')
    .option('--account <aliasOrAddress>', 'Account alias/address to pay from (default: current)')
    .option('--dry-run', 'Preview payment requirements without paying')
    .option('--verbose', 'Log request/response debug details')
    .action(async (url: string, options: RequestOptions & { header: string[] }) => {
      const method = (options.method ?? 'GET').toUpperCase();
      try {
        const headers = parseHeaders(options.header);
        const body = buildBody(options, headers);

        const result = await x402.performRequest({
          url,
          method,
          headers,
          body,
          account: options.account,
          dryRun: options.dryRun ?? false,
          verbose: options.verbose ?? false,
        });

        if (result.type === 'preview') {
          outputResult({
            type: 'preview',
            method: result.payment?.method,
            initialStatus: result.initial.status,
            requirement: {
              amount: result.payment?.requirement.amount,
              asset: result.payment?.requirement.asset,
              payTo: result.payment?.requirement.payTo,
              network: result.payment?.requirement.network,
              maxTimeoutSeconds: result.payment?.requirement.maxTimeoutSeconds,
            },
            resource: result.payment?.resource,
          });
          return;
        }

        if (result.type === 'paid') {
          outputResult({
            type: 'paid',
            method: result.payment?.method,
            initialStatus: result.initial.status,
            finalStatus: result.final?.status,
            responseBody: result.final?.body,
            payment: {
              amount: result.payment?.requirement.amount,
              asset: result.payment?.requirement.asset,
              payTo: result.payment?.requirement.payTo,
              network: result.payment?.requirement.network,
              delegationId: result.payment?.delegationId,
              authorization: result.payment?.authorization ?? null,
              settlement: result.payment?.settlement ?? null,
            },
          });
          return;
        }

        outputResult({
          type: 'plain',
          status: result.final?.status,
          responseBody: result.final?.body,
        });
      } catch (err) {
        outputError(-32000, (err as Error).message);
      }
    });
}
