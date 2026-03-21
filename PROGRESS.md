# x402 Implementation Progress

Tracking tasks for the initial ERC-7710-based x402 support. I’ll pause after each task for review.

## TODO

1. ✅ **Finalize design doc** — ensure `docs/x402.md` and high-level spec references capture the plan.
2. ✅ **Add x402 core types/constants** — introduce shared interfaces (PaymentRequired, PaymentPayload, etc.) and CAIP helpers.
3. ✅ **Extend account storage for delegations** — persist delegation metadata per account and expose read/write helpers.
4. ✅ **Delegation commands** — implement `elytro delegation create/list/info/revoke`.
5. ✅ **x402 payment service** — HTTP 402 handling, ERC-7710 payload builder, ERC-1271 signing, dry-run logic.
   - ERC-1271 signing defers to stored delegations (initial version). Future work can add interactive signing.
6. ✅ **Request command** — CLI surface (`elytro request …`) with structured output and error handling.
7. ✅ **Tests** — smoke test now covers delegation storage & x402 round-trip (`npm run test`).
8. ✅ **Docs & SKILL updates** — README/SKILL/references updated plus `docs/x402.md` added.

## New Tasks

9. ⬜️ **EIP-3009 (USDC) signature support** — build typed-data helpers so smart accounts can authorize `transferWithAuthorization` (ERC-1271) when the server only offers EIP-3009.
