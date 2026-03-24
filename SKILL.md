---
name: elytro
description: >
  Elytro smart-account wallet CLI for agents: multi-chain ERC-4337, 2FA email OTP, spending limits.
  Teaches agents to simulate before send, get user approval on risky steps, and explain outcomes in a
  fixed, user-friendly format (no raw JSON unless asked). Deferred OTP completed with otp submit.
  Use for: accounts, transfers, contract calls, email/security setup. Node >= 24.
version: 0.6.1
homepage: https://elytro.com
metadata:
  openclaw:
    requires:
      bins:
        - elytro
      node: '>=24.0.0'
    emoji: '🔐'
    homepage: https://github.com/Elytro-eth/skills
    os: ['macos', 'windows', 'linux']
    install:
      - id: npm
        kind: npm
        package: '@elytro/cli'
        bins: ['elytro']
        label: 'Install Elytro CLI (npm)'
---

# Elytro CLI — Agent Skill

**Purpose:** Help users and agents use Elytro correctly: initialize a wallet, create accounts, preview and send transactions, and complete OTP-based security steps.

**Install:** `npm install -g @elytro/cli` (Node ≥ 24)

**Command reference & consent list:** [references/commands.md](references/commands.md)

---

## Quick start

Create a wallet and your first smart account:

```bash
elytro init
elytro account create --chain 11155420 --alias agent-primary
elytro account activate agent-primary
```

Recommended security setup after activation:

```bash
elytro security email bind user@example.com
elytro security spending-limit 100
elytro security status
```

## x402 payments (beta)

- Delegations: ask the provider for their ERC-7710 DelegationManager + permission context, then store it with `elytro delegation add --manager <addr> --token <addr> --payee <addr> --amount <atomic> --permission 0x...`. Use `delegation list/show/remove` to manage entries per account. If the provider only offers EIP-3009 (USDC) on an EVM chain, Elytro will auto-sign the authorization—no delegation needed.
- Dry run paywalls with `elytro request --dry-run <url>` — prints the resource info, transfer method (ERC-7710 vs EIP-3009), and required token amount directly from the `PAYMENT-REQUIRED` header.
- To pay, run `elytro request <url> [--method POST --json '{"topic":"defi"}']` (after confirming with the user). The command replays the request automatically with `PAYMENT-SIGNATURE` once a matching delegation is found or it has synthesized an EIP-3009 authorization.
- Results include the settlement header (transaction hash + network). Reference [docs/x402.md](docs/x402.md) for the full workflow and troubleshooting tips.

---

## Daily use

Check the active chain and wallet balance:

```bash
elytro query chain
elytro query balance
```

Preview a transaction before sending it:

```bash
elytro tx simulate agent-primary --tx "to:0xRecipient,value:0.1"
```

Send only after the user explicitly approves:

```bash
elytro tx send agent-primary --tx "to:0xRecipient,value:0.1"
```

For batch calls, repeat `--tx` in the same order for `simulate` and `send`.

---

## OTP flow

Some commands pause for email verification and return an `otpPending` object.

Typical flow:

```bash
elytro security email bind user@example.com
```

Rules:

1. Only the user should provide the OTP code.
2. The agent should run `elytro otp submit <id> <6-digit-code>` on the user's behalf after the user shares the code.
3. Do not ask the user to run CLI commands for OTP unless they explicitly want to operate the CLI themselves.
4. `elytro otp list` shows pending verifications for the current account.

---

## Agent rules

1. Use `elytro query` to confirm chain state, balances, and account status before giving advice.
2. Require explicit user approval before running anything listed in [references/commands.md](references/commands.md) under _Agent: user approval before running_.
3. Always run `tx simulate` before `tx send`, with the same account and the same ordered `--tx` arguments.
4. Treat `--no-hook` as exceptional and call it out clearly before use.
5. Never paste secrets or API keys into chat.
6. Prefer account alias/address arguments instead of interactive selection.

---

## How to explain results

Agent must translate CLI output faithfully. Do not paraphrase away important fields, and do not invent details that were not returned.

Translation rules:

1. Read `success`, then `result` or `error`.
2. Preserve exact identifiers when present: account alias, address, chain name, chainId, tx hash, userOp hash, OTP id.
3. Preserve exact status meaning. For example:
   - `confirmed` means confirmed on-chain.
   - `sent` means submitted/sent but not necessarily the same as a confirmed receipt unless the command says so.
   - `otp_pending` means the action is not complete yet.
4. If the CLI returns warnings, include all warnings.
5. If the CLI returns a next step or submit command, copy it exactly.
6. Do not show raw JSON unless the user asks for it.

Use these fixed output shapes when replying to humans:

### Generic success

Format:

`Done: <what changed>.`

Optional second line:

`Next: <single most useful next command or action>.`

Examples:

- `Done: wallet initialized on this machine.`
- `Done: active account is now agent-primary.`
- `Done: Pimlico API key saved.`

### Query or status result

Format:

`Status: <plain-language summary>.`

Then one short line with the most relevant facts.

Examples:

- `Status: current chain is Optimism Sepolia (11155420).`
- `Status: security hook is installed and email is verified.`
- `Status: balance for agent-primary is 0.482 ETH.`

### Transaction preview

Use this exact structure:

`Preview: <transaction type>.`
`Cost: <estimated cost or max cost from CLI>. Sponsored: <yes/no>.`
`Warnings: <every warning, or "none">.`
`Please confirm if you want me to send it.`

Rules:

- Mention the account alias/address being used.
- Mention every transaction in a batch in the same order if the result makes that available.
- Never skip the confirmation line.

### Transaction sent or confirmed

If confirmed on-chain:

`Done: transaction confirmed for <account or address>.`
`Tx: <transactionHash>.`
`Explorer: <url>` if present.

If only submitted:

`Done: transaction submitted for <account or address>.`
`UserOp: <userOpHash or tx hash returned by CLI>.`

Do not claim confirmation unless the CLI returned a confirmed/receipt-style result.

### OTP pending

Use this exact structure:

`Action needed: email verification is required to continue.`
`Code sent to: <maskedEmail or "your email">.`
`Please send me the 6-digit code and I’ll complete it for you.`

If `otpExpiresAt` is present, add:

`Expires at: <timestamp>.`

If the user asks what the agent will do next, the agent may mention that it will submit the pending OTP after receiving the code, but should not instruct the user to run the command by default.

### Error

Use this exact structure:

`Couldn’t complete: <plain-language reason>.`
`Try: <one concrete next step>.`

Rules:

- Base the reason on `error.message`.
- If `error.data.hint` exists, prefer that for the `Try:` line.
- If the failure is about approval, OTP, chain, balance, or deployment state, say that explicitly.
- Do not dump internal stack traces or implementation details.

### Lists

For account lists, token lists, or pending OTP lists:

- Start with a one-line summary: `Found <n> item(s).`
- Then present each item in a short human-readable line.
- For accounts, include alias, chain, and whether deployed.
- For pending OTPs, include id, action, masked email if present, and the submit command.

### Translation accuracy checklist

Before replying, verify:

1. Did I preserve the exact status meaning?
2. Did I include all warnings, ids, hashes, and next-step commands returned by the CLI?
3. Did I avoid claiming success when the result is only pending?
4. Is the wording short, clear, and friendly for a human user?
5. For OTP, did I ask the user for the code instead of telling them to run the command themselves?

---

## Common commands

```bash
elytro account list
elytro account info agent-primary
elytro account switch agent-primary
elytro query tx <hash>
elytro security status
elytro config show
elytro update check
```

Use [references/commands.md](references/commands.md) for command-specific messaging and approval requirements.

---
