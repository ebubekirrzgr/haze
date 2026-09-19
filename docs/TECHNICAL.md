# HAZE — Technical Documentation

HAZE is a non-custodial spending account on Stellar. Salary and savings sit in a per-user Soroban vault as USDC, tokenized treasuries, gold and stocks. Every card purchase is a loan against that collateral, denominated in the currency of the purchase. Payday repays it. Nothing is ever sold.

This document explains how the system works. It runs end to end on Stellar testnet: [github.com/ebubekirrzgr/haze](https://github.com/ebubekirrzgr/haze).

Contents

1. [Overall architecture](#1-overall-architecture)
2. [Main components and their responsibilities](#2-main-components-and-their-responsibilities)
3. [Stellar integrations and protocols used](#3-stellar-integrations-and-protocols-used)
4. [Key design decisions and trade-offs](#4-key-design-decisions-and-trade-offs)
5. [Technical challenges and how we solved them](#5-technical-challenges-and-how-we-solved-them)
6. [Appendix: testnet deployment, testing, status](#6-appendix)

---

## 1. Overall architecture

```
            ┌──────────────────────┐        ┌──────────────────────┐
            │   apps/web  (PWA)    │        │  apps/terminal (POS) │
            │ passkey · earn · card│        │  TRY → USD → ASA     │
            └──────────┬───────────┘        └──────────┬───────────┘
                       │ user-signed tx, SEP-10 JWT     │ charge / clear / void
                       ▼                                ▼
            ┌──────────────────────────────────────────────────────┐
            │                 services/api  (Hono, Node 22)        │
            │  sponsor + allowlist · credit engine · card (ASA)    │
            │  operator queue · salary rule + FX desk · price bot  │
            │  market maker · indexer · anchor client · Lithic     │
            └──────────┬───────────────────┬───────────────────────┘
                       │ operator-signed    │ fee-bump / sponsored
                       ▼                    ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                          Stellar testnet                                  │
│                                                                           │
│  Soroban   VaultFactory ──deploys──▶ HazeVault (one per user)             │
│                                          │ submit(from = spender = to)    │
│                                          ▼                                │
│            Blend v2 pool (12 reserves) ◀─or─▶ HazeCredit (fallback pool)  │
│                                          │                                │
│                                    Price oracle (Blend PriceFeed API)     │
│                                                                           │
│  Classic   USDC + 11 issued assets, each with a Stellar Asset Contract    │
│            AMM liquidity pools · DEX offers · path payments               │
│            SEP-1 / SEP-10 / SEP-12 / SEP-38 / SEP-6 anchor (TRY on/off)   │
└───────────────────────────────────────────────────────────────────────────┘
                       ▲                                ▲
                       │ Auth Stream Access + webhooks  │ SEP-38 quotes, SEP-6 deposit/withdraw
            ┌──────────┴───────────┐        ┌───────────┴──────────┐
            │  Lithic (card issuer)│        │  TR mock anchor      │
            └──────────────────────┘        └──────────────────────┘
```

### Trust boundaries

- **User** holds the vault owner key in the browser, encrypted with a passkey (WebAuthn PRF). Only the owner can deposit, withdraw, borrow for themselves, repay, freeze the card or change the daily limit.
- **HAZE operator** (the API) can only do three kinds of things to a vault: open a card debt for an authorization (`borrow_for_card`, `borrow_for_card_asset`), refund one (`refund_for_card`, `refund_for_card_asset`), and run payday (`settle_salary`, `settle_fx`). It cannot move collateral to an arbitrary address.
- **Sponsor** pays reserves and fees for every user transaction, but only for an allowlisted set of operations.
- **Treasury** is the market maker, the liquidity provider of the pool and the funding side of the payday FX desk.
- **Lending pool** (Blend v2) enforces collateral factors and health; the vault is its own counterparty.

### The five flows

| Flow | Off-chain | On-chain |
|---|---|---|
| Onboarding | PWA generates a keypair, API builds a sponsored `createAccount` with sponsored trustlines, user signs, passkey encrypts the secret | `createAccount` + `beginSponsoringFutureReserves`, `VaultFactory.create_vault` (fee-bumped), SEP-10 login |
| Salary | Employer pays TRY to the anchor (SEP-38 quote, SEP-6 deposit-exchange) or USDC directly | USDC lands in the user's account; rule engine calls `settle_salary` via a USDC allowance; FX desk closes fiat debts with `settle_fx` |
| Allocation | User picks USDC / treasuries / gold / stocks percentages | One `PathPaymentStrictReceive` per chosen asset on the DEX, then `vault.deposit` for each |
| Card purchase | Lithic sends an Auth Stream Access request; API answers from the credit engine in milliseconds | Operator queue calls `borrow_for_card_asset(hTRY, amount)`; the vault borrows lira tokens from the pool and pays the settlement treasury |
| Cash out | SEP-38 quote + SEP-6 withdraw-exchange instructions | `vault.withdraw` (or `vault.borrow`), then a memo-tagged path payment to the anchor treasury for the exact USDC amount |

---

## 2. Main components and their responsibilities

### Smart contracts (Rust, soroban-sdk 28)

| Contract | Lines | Responsibility |
|---|---|---|
| `haze-vault` | 729 | Per-user vault. Holds the user's positions in the lending pool and always calls the pool with `from = spender = to = vault`. Owner functions: `deposit`, `withdraw`, `borrow`, `repay`, `borrow_asset`, `repay_asset`, `set_daily_limit`, `set_frozen`. Operator functions: `borrow_for_card`, `borrow_for_card_asset`, `refund_for_card`, `refund_for_card_asset`, `settle_salary`, `settle_fx`. Enforces freeze, daily limit (in USD, temporary storage keyed by day) and idempotency on `auth_id` (SHA-256 of the issuer's authorization token, persistent storage with TTL). |
| `vault-factory` | 250 | Deploys vaults deterministically with `salt = sha256(owner)`, so the API can compute a vault address without a chain query. Holds shared config (operator, pool, USDC, settlement, vault wasm hash, default daily limit). Admin can switch the pool and the vault wasm; new vaults pick up the new values. |
| `haze-credit` | 372 | Minimal lending pool that implements Blend's `submit(from, spender, to, requests)` and request types 0–5. Fixed-rate simple interest, collateral and liability factors, health check. Used as the fallback pool and as the pool that vault tests run against with real contract authorization. |
| `mock-oracle` | 132 | Blend `PriceFeed` interface (`lastprice`, `decimals`) with admin-written prices; batch `set_prices` for the price bot. |

Reserve set (defined once in `packages/stellar/src/config.ts`, `ASSET_META`):

| Group | Assets | Collateral factor | Borrowable |
|---|---|---|---|
| Stable | USDC | 0.95 | yes |
| RWA | hUSDY (treasuries), hXAU (gold), hNVDA, hSHEL, hBMW (stocks) | 0.65–0.90 | no |
| Fiat | hTRY, hEUR, hGBP, hCHF, hARS, hBRL | 0 | yes, borrow factor 0.85 |

### API (`services/api`, Hono on Node 22, SQLite)

| Module | Responsibility |
|---|---|
| `sponsor` | Sponsored account creation and fee-bump of user transactions behind an allowlist: calls to the user's own vault, `VaultFactory.create_vault`, USDC `approve` with the user's vault as spender, path payments between approved assets, memo-tagged payments to the anchor treasury, trustlines for approved assets. Verifies the source signature, caps operations per transaction, rate-limits per account. |
| `credit` | Pure credit engine (`packages/stellar/src/credit.ts`) over cached positions: effective collateral, effective liabilities including open holds, health target 1.25, available limit. Cache of 10 s with explicit invalidation. |
| `card` | Auth Stream Access decision (approve/decline), hold state machine `PENDING → BORROWED → CLEARED / REFUNDED`, operator queue with retries, refunds, and the terminal's currency hint. |
| `rules` | Salary rule: checks the USDC allowance, calls `settle_salary(amount, current USDC debt)`, then runs the FX desk for every fiat debt. |
| `prices` | One loop every 30 s: writes oracle prices (hUSDY accrues, gold and stocks random-walk around a base, hTRY from the anchor's SEP-38 rate), moves the market maker's DEX offers to the same prices, caches USD/TRY. |
| `indexer` | Reads Soroban events (`card_borrow`, `card_refund`, `salary_settled`, `vault_created`) via `getEvents` and reconciles the database. |
| `anchor` | SEP-1 discovery, SEP-10 challenge/JWT (signed client-side), SEP-38 quotes, SEP-6 deposit-exchange and withdraw-exchange, transaction polling. |
| `lithic` | Lithic sandbox client, ASA payload normalization, response mapping to Lithic result codes, Standard Webhooks signature verification (`webhook-id`, `webhook-timestamp`, `webhook-signature`, separate secrets for ASA and events). |
| `chain` | The only place that signs with server keys. Every Soroban call goes through the shared `SorobanClient` (simulate, pad resources, assemble, sign, fee-bump, send, poll). |

### Shared client (`packages/stellar`)

Transaction builders for vault and factory calls, sponsored account creation, path payments, memo payments; the credit math; Blend and HazeCredit position readers (`@blend-capital/blend-sdk` for Blend); anchor client; the asset registry. Browser and Node entry points.

### PWA (`apps/web`, Next.js 15)

Onboarding with passkeys, Earn (positions, add, allocate, withdraw, borrow), Card (virtual card, freeze, daily limit, purchases), Cash out, Profile (salary rule, employer panel, transparency). Four languages. All signing happens in the browser; the API never sees the owner key.

### Terminal (`apps/terminal`) and scripts (`scripts/`)

A dependency-free demo POS that converts TRY to USD and triggers a Lithic authorization (or a direct one when Lithic is off). Scripts issue assets and SACs, seed AMM pools, deploy contracts, deploy a self-hosted Blend v2 pool from `blend-utils`, supply pool liquidity, create the demo user, register Lithic webhooks, and replay the whole user journey (`rehearse`).

---

## 3. Stellar integrations and protocols used

| Integration | Where | Why it matters |
|---|---|---|
| **Soroban smart contracts** (soroban-sdk 28, protocol 28) | vault, factory, pool, oracle | Per-user vaults with scoped authorization; `authorize_as_current_contract` lets the vault pre-authorize the pool's token pulls for the exact amount. |
| **Stellar Asset Contracts** | every asset | The same token is a classic asset on the DEX and a Soroban token in the pool. No wrapping step between trading and collateralizing. |
| **Classic assets and trustlines** | issuance, onboarding | Twelve issued assets; onboarding opens sponsored trustlines so the user never needs XLM for reserves. |
| **Sponsored reserves** (`beginSponsoringFutureReserves`) | onboarding | The user's account is created with zero XLM; HAZE pays the base reserve and trustline reserves. |
| **Fee-bump transactions** | every user transaction | The user signs an inner transaction, the sponsor wraps it. The outer fee is computed from the inner fee so Soroban resource fees are covered. |
| **PathPaymentStrictReceive** | allocation, cash out | Converts salary USDC into treasuries, gold or stocks, and converts collateral into the exact USDC an anchor withdrawal needs, in one atomic operation. |
| **Liquidity pools and DEX offers** | `amm` script, market maker | Eleven USDC pools; the market maker keeps two-sided offers at oracle prices so path payments always find a route. |
| **SEP-1, SEP-10, SEP-12, SEP-38, SEP-6** | anchor client | Discovery, authentication with the passkey-unlocked key, KYC, quotes, deposit-exchange and withdraw-exchange for TRY on- and off-ramps. |
| **Blend v2** | lending pool | Isolated pool with twelve reserves, backstop and oracle, deployed with `blend-utils`. The vault calls `submit` on its own behalf; positions are read with `blend-sdk`. |
| **Soroban RPC** | `SorobanClient`, indexer | Simulation, sending, polling, `getEvents`; Horizon for classic account data, offers and path finding. |
| **Contract events** (`#[contractevent]`) | vault, factory | `card_borrow`, `card_borrow_asset`, `card_refund`, `salary_settled`, `fx_settled`, `vault_created` drive the indexer. |

Outside Stellar: Lithic Auth Stream Access for real-time card authorization, Lithic transaction webhooks, WebAuthn with the PRF extension for key encryption.

---

## 4. Key design decisions and trade-offs

**1. The vault is its own counterparty.** Blend's `submit` is always called with `from = spender = to = vault`, so pool authorization is satisfied by the contract call itself and the vault owns the position. Token pulls by the pool are pre-authorized for the exact amount with `authorize_as_current_contract`, and the tests verify this with real authorization rather than mocks. Trade-off: every user has their own contract instance (deterministic, ~13 KB wasm shared by hash), so upgrades apply to new vaults only.

**2. Authorization is off-chain, borrowing is asynchronous.** The card issuer needs an answer in under six seconds; Soroban finality takes about five. HAZE answers from cached positions plus open holds in milliseconds, and an operator queue opens the loan right after. Trade-off: a window of a few seconds in which the approved amount is not yet reserved on chain. Production would reserve on chain first or answer synchronously within the issuer window.

**3. Debt is denominated in the transaction currency.** A purchase in Türkiye borrows `hTRY`, not USDC (`borrow_for_card_asset`), while collateral stays in dollars and the daily limit is tracked in USD. On payday the FX desk closes fiat debts: the treasury sends the fiat token to the vault and `settle_fx` repays the pool, taking the USDC equivalent from collateral at the anchor's SEP-38 rate plus a 0.5% spread. Trade-off: the operator supplies that rate; the contract does not verify it. Production must bound it with an on-chain oracle.

**4. Operator scope is narrow and idempotent.** The API can only borrow for an authorization, refund it, and run payday. Each authorization is keyed by `auth_id`, so a retried or replayed webhook cannot double-borrow. Freeze and daily limit are enforced on chain, not in the API.

**5. One asset registry.** Names, kinds, base prices, risk parameters, issuance and demo amounts live in `ASSET_META`. Issuance, AMM seeding, pool reserve configuration, oracle ordering, the price bot, the market maker and the PWA all derive from it. Adding an asset is one line plus a pool redeploy. Trade-off: Blend reserves can only be added while the pool is in `Setup`, so a new asset means a fresh pool and fresh vaults.

**6. Two pools, one interface.** Blend v2 is the target; HazeCredit implements the same `submit` interface as a fallback and as the test pool. Switching is `VaultFactory.set_pool`; the vault code never changes. Trade-off: a second contract to maintain.

**7. Sponsorship behind an allowlist.** The sponsor pays for a fixed set of operations, verifies the source signature, caps operations per transaction and rate-limits per account. Trade-off: new user actions require an allowlist change.

**8. Passkey custody with a visible fallback.** WebAuthn PRF derives an AES-GCM key that encrypts the account secret in the browser. Browsers without PRF fall back to plain storage with a demo warning. Trade-off: no recovery path yet.

**9. Mocked real-world assets and anchor.** Treasuries, gold, stocks and fiat tokens are issued by the treasury and priced by a bot; the anchor is a mock. This makes the whole flow runnable on testnet today; each mock has a named mainnet counterpart (Circle USDC/EURC, Ondo USDY, Matrixdock XAUm, tokenized equities, licensed TRY anchors).

---

## 5. Technical challenges and how we solved them

| Challenge | What happened | Solution |
|---|---|---|
| **Simulated resources vs execution** | Transactions passed simulation but failed on chain with `resource_limit_exceeded` (1332 bytes written vs 1304 declared) because state changed between simulation and inclusion; testnet surge pricing also rejected 0.001 XLM inclusion fees. | `SorobanClient` pads simulated instructions and bytes by 30%, doubles the resource fee (the refundable part is returned), uses a 0.01 XLM inclusion fee, sizes fee-bumps from the inner fee, retries `TRY_AGAIN_LATER` and polls with a bounded fixed interval. |
| **Batch oracle writes** | `set_prices` called `require_auth` once per asset inside one call; Soroban rejects the second with `Auth, ExistingValue`. | Authorize once, then write in a loop. |
| **Operator queue deadlock** | An idle drain tick with no pending holds resolved synchronously, and the assignment overwrote the just-cleared guard with a resolved promise; every later card borrow stayed `PENDING`. | Start the drain body on the next microtask and clear the guard in `finally`; regression test added. |
| **Lithic Auth Stream Access** | The card token arrives nested (`card.token`), the response accepts only fixed `result` codes (`DECLINED` is malformed), the sandbox rewrites the merchant currency (a TRY authorization came back as GBP) and both webhooks are signed with Standard Webhooks using different secrets. | Payload normalization, result-code mapping, a per-card currency hint set by the terminal before the simulated authorization, and signature verification on both endpoints with a script that re-registers webhooks whenever the tunnel URL changes. |
| **Self-hosted Blend v2 on testnet** | The deployment stalled three ways: the price bot signed with the same admin key and raced sequence numbers; low fees under surge pricing; pre-existing BLND/USDC mocks bumped the local sequence. | Stop the API during deployment, reload account sequences after the token step, 0.2 XLM per operation, tolerate an already-transferred BLND admin, and generate the reserve list from the asset registry so a redeploy carries every reserve. |
| **Debt in the transaction currency** | A TRY purchase should create lira debt, but salary arrives in USDC and a contract cannot swap on the DEX. | `borrow_for_card_asset` borrows the fiat token; on payday the treasury funds the vault with fiat and `settle_fx` repays it against USDC collateral. |
| **Cash-out sizing** | Withdrawing collateral by oracle price left path payments underfunded once the AMM price drifted from the oracle. | Size the withdrawal from the DEX path estimate plus 2%. |
| **No XLM in the wallet** | Every user action needs fees and reserves. | Sponsored account creation with sponsored trustlines, fee-bump on every user transaction, and a strict allowlist so the sponsor is not a faucet. |
| **Settlement account trustlines** | Borrowing in a new currency failed with `trustline entry is missing` on the settlement account. | The key script opens a trustline on the settlement account for every issued fiat token. |

---

## 6. Appendix

### Testnet deployment (current)

| Contract | Address |
|---|---|
| VaultFactory | `CCIBB55YM743L4OVEPDFTPSLR3FCIKQA3DRKNOLO4B7KSLA3FVSZERWH` |
| HazeVault wasm hash | `6a918df8450effdab0bdd1d9bcbbf41d93001a2b1d9fbda753876bbcd2f407b2` |
| Blend v2 pool (active) | `CCC4YU3HJARU6H7V7L4NF7BIQFCYUJUVHDZ5PK6ZKA4TLGPD647H5QBN` |
| Blend oracle | `CA6YZVXRWHZJGW2X7LZLJM4WTLVQNPLIBAN7HWMFV3DBE3Y456277Y5L` |
| HazeCredit (fallback) | `CA2ZQTXBMR3UCALOV5DCLOIXGWNBPGRKDAXWZ4Z2IRWENVYQOCGLXWI2` |
| MockOracle | `CAISA7SFWH5APN7C67D4W4LDN3XUCZ2C6R5UM2WE2FRKKQZFLBQTVS4R` |

Asset contracts: USDC `CBIELTK6…QDAMA`, hUSDY `CD5I7KGZ…4TTM`, hXAU `CBLHUKCZ…CWSW`, hNVDA `CCY3Q77B…JKXZ`, hSHEL `CDOMOCIH…RPVE5`, hBMW `CCJCGRFJ…2NBZ`, hTRY `CBAL3RRE…JHJCS`, hEUR `CCUVSPXV…SIGR`, hGBP `CBC2JXED…THG77`, hCHF `CCABH7BB…PWGCC`, hARS `CDSHCIXU…NBPR`, hBRL `CA7JSY7G…CPUS`. Full addresses are in `testnet.contracts.json`.

### Testing

- Rust: 27 contract tests. HazeVault tests run against HazeCredit with real contract authorization and cover deposit, withdraw, borrow, repay, card borrow with idempotency and daily limits, refunds, salary settlement, transaction-currency borrow and refund, the FX desk, freeze and factory deployment.
- TypeScript: 25 tests on Node's built-in runner covering the credit engine, anchor chunking, the hold state machine and queue, the sponsor allowlist, Standard Webhooks verification, ASA normalization and the API end to end against a fake chain.
- `pnpm --filter @haze/scripts rehearse` replays the full user journey on testnet with a throwaway key in about three minutes.

### Status and scope

Runs on Stellar testnet with a self-hosted Blend v2 pool. Contracts are not audited. Regulatory and compliance topics are out of scope. Known gaps for production are listed in the README under *Status and scope* and in the trade-offs above: on-chain reservation of authorized amounts, oracle-bounded FX settlement, key rotation, liquidation, and real asset issuers and anchors.
