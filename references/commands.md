# Elytro Command Reference

Full command reference. See SKILL.md for rules, workflows, and error recovery.

## Account

| Command | Returns |
|---------|---------|
| `account create -c <chainId> [-a <alias>] [-e <email>] [-l <dailyLimitUsd>]` | `{ alias, address, deployed: false, security }` |
| `account activate [alias\|address] [--no-sponsor]` | `{ transactionHash, hookInstalled, emailPending, dailyLimitPending }` |
| `account list [-c <chainId>]` | `{ accounts, total }` |
| `account info [alias\|address]` | `{ deployed, balance, securityStatus }` |
| `account rename <alias\|address> <newAlias>` | `{ alias, address }` |
| `account switch <alias\|address>` | Always pass alias/address; no interactive selector |

## Transaction

| Command | Returns |
|---------|---------|
| `tx send [account] --tx <spec> [--no-sponsor] [--no-hook]` | `status: "confirmed"` or `"otp_pending"` |
| `tx build [account] --tx <spec> [--no-sponsor]` | Unsigned UserOp |
| `tx simulate [account] --tx <spec> [--no-sponsor]` | `{ gas, sponsored, balance, warnings }` |

`--tx` spec: `to:0xAddr,value:0.1,data:0x...`. `to` required; `value` or `data` required. Multiple `--tx` = batch.

**Agents — before `tx send`:** Run `tx simulate` first with the **same** account, the **same** `--tx` specs, and matching sponsor flags (`--no-sponsor` if you plan to use it on send). Parse the JSON result and present the simulation to the user in the compact **Simulated** style from SKILL.md (gas, sponsorship, balance, warnings). **Wait for explicit user confirmation**, then run `tx send`.

## Query

| Command | Returns |
|---------|---------|
| `query balance [alias\|address] [--token 0xAddr]` | ETH or ERC-20 balance |
| `query tokens [alias\|address]` | All ERC-20 holdings |
| `query tx <hash>` | Transaction receipt |
| `query chain` | Current chain |
| `query address <0xAddress>` | Address type + balance |

## Security

| Command | Returns |
|---------|---------|
| `security status` | `{ hookInstalled, profile: { email, emailVerified, dailyLimitUsd } }` |
| `security 2fa install [--capability 1\|2\|3]` | Install hook |
| `security 2fa uninstall [--force [--execute]]` | Deferred OTP if normal path |
| `security email bind <email>` | `otp_pending` → user runs `otp submit` |
| `security email change <email>` | `otp_pending` → user runs `otp submit` |
| `security spending-limit [usd]` | View or set; set returns `otp_pending` |

## OTP

| Command | Returns |
|---------|---------|
| `otp submit <id> <code>` | Completes pending; `id` from `otpPending.id`. Current account must match initiator. |
| `otp list` | Pending OTPs for current account |
| `otp cancel [id]` | Cancel; omit id = all for current account |

## Config & Update

| Command | Returns |
|---------|---------|
| `config show` | Current config |
| `config set alchemy-key\|pimlico-key <KEY>` | Save key |
| `config remove <key>` | Remove key |
| `update check` | `{ updateAvailable, upgradeCommand }` |
| `update` | Install latest |

## Agent: user approval before running

The CLI **does not** show interactive yes/no prompts for on-chain or security actions. **Agents must obtain explicit user confirmation** (intent, amounts, recipient, and flags) before executing any command below.

### High impact — on-chain funds & account lifecycle

| Command | Why confirm |
|---------|-------------|
| `tx send` | Transfers ETH/tokens; arbitrary contract calls; irrecoverable if wrong target or `--tx` spec. Use **simulate → show result → user confirms → send** (see Transaction section above). |
| `tx send ... --no-hook` | Bypasses SecurityHook signing — higher abuse risk; user must understand. |
| `account activate` | Deploys the smart account; spends gas; irreversible deployment step. |

### High impact — 2FA / SecurityHook

| Command | Why confirm |
|---------|-------------|
| `security 2fa install` | Installs on-chain hook; changes validation path for the account. |
| `security 2fa uninstall` | Removes hook (normal path still needs email OTP afterward). |
| `security 2fa uninstall --force` | Starts force-uninstall safety countdown. |
| `security 2fa uninstall --force --execute` | Completes force uninstall; **removes** SecurityHook without hook signature. |

### Security profile & pending operations

| Command | Why confirm |
|---------|-------------|
| `security email bind` / `security email change` | Changes OTP email; phishing or mistake locks user out of recovery flow. |
| `security spending-limit <usd>` | When **setting** a limit (not read-only): changes policy; may require OTP after. |
| `otp submit` | Submits a one-time code — only run when the **user** provides `id` and `code`. |
| `otp cancel [id]` | Cancels pending OTP flows; can strand or confuse in-flight operations. |

### Config & tooling

| Command | Why confirm |
|---------|-------------|
| `config remove` | Removes API keys; can break RPC/sponsorship until reconfigured. |
| `update` | Installs a new CLI version; user may want to review release notes first. |

**Suggested agent pattern:** For `tx send`, follow simulate-then-confirm above. For other high-impact commands, state the exact `elytro ...` command, summarize impact (who pays gas, what asset/address), then wait for explicit user approval before running.

## Error Codes

| Code | Meaning |
|------|---------|
| -32000 | Internal / unknown error |
| -32001 | Insufficient balance *(or, on `query tx`, tx not found)* |
| -32002 | Account not ready (init, deploy, wrong chain, no account selected) |
| -32003 | Sponsorship failed |
| -32004 | Build / gas estimation failed |
| -32005 | Sign / send to bundler failed |
| -32006 | UserOp included but execution reverted on-chain |
| -32007 | Hook auth failed |
| -32010 | Email not bound |
| -32011 | Safety delay / force-uninstall timing (see command message) |
| -32012 | OTP verification failed |
| -32013 | OTP id not found |
| -32014 | OTP expired |
| -32602 | Invalid parameters (`error.data` may list `supportedChains`, hints) |
