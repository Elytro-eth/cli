# Elytro — Agent cheat sheet & user messaging

**Purpose:** Fast lookup for agents: what to run, what needs extra user consent, and **fixed wording** for humans—not a full CLI spec.

**Behaviour rules & templates:** [SKILL.md](SKILL.md)

---

## Commands (essentials)

### Account

| Run                                                                    | Tell the user on success                                                                                  |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `account create -c <chainId> [-a alias] [-e email] [-l dailyLimitUsd]` | Use `Done: smart account created.` Then include alias and address; say it is not deployed until activate. |
| `account activate [alias\|address] [--no-sponsor]`                     | Use `Done: account deployed on-chain.` Mention hook/security state only if returned.                      |
| `account list [-c <chainId>]`                                          | Use `Found <n> item(s).` Then one line per account: alias, chain, deployed yes/no.                        |
| `account info [alias\|address]`                                        | Use `Status: ...` and include balance, deployment state, and security state in plain language.            |
| `account rename …`                                                     | Use `Done: account renamed to <new>.`                                                                     |
| `account switch <alias\|address>`                                      | Use `Done: active account is now <alias>.` **Always pass alias/address** (avoid interactive pick).        |

### Transaction

| Run                                                         | Tell the user                                                                                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `tx simulate [account] --tx <spec>… [--no-sponsor]`         | Use the exact `Preview:` template from [SKILL.md](SKILL.md): cost, sponsorship, every warning, then explicit confirmation request. |
| `tx send [account] --tx <spec>… [--no-sponsor] [--no-hook]` | Use the exact `Done:` or `Action needed:` template from [SKILL.md](SKILL.md); never send without prior simulate + user OK.         |
| `tx build …`                                                | Use `Done: unsigned operation prepared.` only if the user actually asked for a build artifact.                                     |

`--tx` shape: `to:0x…,value:0.1,data:0x…` (`to` + either `value` or `data`; repeat `--tx` for batch).

### Query

| Run                                        | Tell the user                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `query balance [account] [--token 0xAddr]` | Use `Status:` and include who the balance belongs to, amount, and symbol. |
| `query tokens …`                           | Use `Found <n> item(s).` then concise lines, or a short summary if many.  |
| `query tx <hash>`                          | Use `Status:` and say confirmed, pending, or not found in plain language. |
| `query chain`                              | Use `Status: current chain is <name> (<id>).`                             |
| `query address <0x…>`                      | Use `Status:` and summarize address type and balance.                     |

### Security / OTP / config

| Run                                      | Tell the user                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `security status`                        | Use `Status:` and explain hook state, email verification, and spending limit without jargon.                   |
| `security 2fa install …` / `uninstall …` | Only after user approval; then use `Done:` with a short plain-language result.                                 |
| `security email bind                     | change <email>`                                                                                                | Often returns OTP pending; use the exact `Action needed:` template from [SKILL.md](SKILL.md). |
| `security spending-limit [usd]`          | View: use `Status:`; set: may return OTP pending, so use the same OTP template.                                |
| `otp submit <id> <code>`                 | Run this only after the **user** supplies the code; the agent should execute the command on the user's behalf. |
| `otp list` / `otp cancel`                | For list, use `Found <n> item(s).`; for cancel, use `Done:`.                                                   |
| `config show                             | set                                                                                                            | remove`                                                                                       | Use `Status:` for show and `Done:` for set/remove. |
| `update check` / `update`                | Use `Status:` for availability and `Done:` for a completed upgrade; no auto-update without OK.                 |

### x402 / Delegations

| Run | Tell the user |
|-----|---------------|
| `delegation list|add|show|remove [--account alias]` | “Delegations listed / stored / removed.” Mention manager + token when relevant. |
| `request --dry-run <url>` | “Preview — paywall requires &lt;amount asset&gt; to &lt;payTo&gt;.” No funds moved. |
| `request <url> [--method POST --json …]` | “Paid &lt;amount asset&gt; to &lt;payTo&gt;. Tx hash from settlement header.” Only run after user approval. Mention whether it used ERC-7710 (delegation id) or EIP-3009 (authorization window). |

---

## Agent: user approval before running

Say what you will run, **wait for explicit yes**, then execute.

**Money & deploy:** `tx send` (especially `--no-hook`), `account activate`, `request <url>` (non-dry-run)  
**Security hook:** `security 2fa install`, `security 2fa uninstall` (any variant)  
**Account safety:** `security email bind|change`, `security spending-limit` **when setting**  
**OTP / config:** `otp submit` (user provides code; agent executes), `otp cancel`, `config remove`, `update`

---

## Error recovery (human)

Use this table for **uniform** reassurance and next steps (codes are optional in parentheses for debugging).

| User-visible situation                | Suggested **Try:** line                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Wallet / init missing                 | “Run `elytro init` once on this machine.”                                                                                       |
| Not deployed                          | “Run `account activate` for this account after we confirm.”                                                                     |
| Not enough balance                    | “Fund this smart account, then we’ll check balance again.”                                                                      |
| Sponsorship / paymaster issue         | “We can retry with `--no-sponsor` if you pay gas—only if you agree.”                                                            |
| Transaction build / estimation failed | “Check the transaction line (to, value, data) and chain.”                                                                       |
| Send / network failed                 | “Temporary network or bundler issue—retry shortly or check RPC keys.”                                                           |
| On-chain revert                       | “The chain rejected the call—adjust amount/calldata or ask the dApp.”                                                           |
| 2FA / email / OTP issues              | “Use the same account as when we started; ask the user for the latest code and then submit it, or redo the step if it expired.” |
| Wrong or unsupported chain            | “Use a supported chain ID from the error message.”                                                                              |

---

## Optional: error codes (debug only)

If the user cares about numbers: `-32602` bad parameters · `-32002` wallet/account not ready · `-32005` send failed · `-32007` hook auth · `-32010`–`-32014` OTP family · `-32000` generic.

Full internal list is not required for day-to-day agent use.
