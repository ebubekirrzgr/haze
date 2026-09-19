<p align="center">
  <img src="apps/web/public/logo/haze-logo-sepya.svg" alt="HAZE" width="220">
</p>

<h3 align="center">Spend without selling.</h3>

<p align="center">
  Collateral-backed spending on Stellar. Salary and savings sit in a personal Soroban vault as USDC, tokenized treasuries and tokenized gold. Every card purchase is a USDC loan against that collateral. Payday repays it. The assets are never sold.
</p>

<p align="center">
  <a href="#getting-started">Getting started</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#smart-contracts">Smart contracts</a> ·
  <a href="#design-decisions">Design decisions</a> ·
  <a href="#api-reference">API</a> ·
  <a href="RUNBOOK.md">Runbook</a> ·
  <a href="README.tr.md">Türkçe</a>
</p>

---

## Overview

HAZE is a non-custodial spending account built on Stellar. Users hold yield-bearing assets in a per-user smart contract vault (**HazeVault**) and pay with a Visa card. Instead of liquidating assets at the point of sale, each authorization opens a small USDC borrow position in a lending pool against the vault's collateral. When the next salary arrives, the debt is repaid automatically and the remainder is added back as collateral.

The result is a card that lets people keep their savings invested while spending against them, with no XLM in the user's wallet, no seed phrase, and no exchange in the loop.

**What the user sees**

| Screen | What happens |
|---|---|
| **Onboarding** | Interface in Turkish, English, Portuguese or Spanish (auto-detected, switchable on the profile page). A passkey creates the account. Reserves are sponsored, fees are fee-bumped, and a deterministic vault is deployed. The user never touches XLM. |
| **Earn** | Incoming salary (via a SEP-6 anchor) is split across USDC, tokenized treasuries, gold and stocks (NVIDIA, Shell, BMW) with a single passkey approval. The Borrow tab lends fiat tokens (TRY, EUR, GBP, CHF, ARS, BRL) against that collateral. |
| **Card** | Contactless payments are authorized off-chain, in milliseconds from cached positions and about a second on a cold read. The on-chain borrow follows seconds later from an operator queue. |
| **Cash out** | Withdraw to a bank account in local currency without selling the underlying asset, via path payment and anchor withdrawal. |
| **Payday** | The salary rule repays outstanding debt and re-collateralizes the rest. |

**Assets**

| Symbol | Description | Role | Collateral factor |
|---|---|---|---|
| `USDC` | Circle USDC (testnet issuer) | Borrow asset, primary collateral | 0.95 |
| `hUSDY` | Tokenized short-term treasury exposure | Yield-bearing collateral | 0.90 |
| `hXAU` | Tokenized gold | Store-of-value collateral | 0.75 |
| `hNVDA` | Tokenized NVIDIA stock | Equity collateral | 0.65 |
| `hSHEL` | Tokenized Shell stock | Equity collateral | 0.70 |
| `hBMW` | Tokenized BMW stock | Equity collateral | 0.70 |
| `hTRY` | Tokenized Turkish lira | Borrowable fiat reserve, on/off-ramp leg | 0 (borrow factor 0.85) |
| `hEUR` `hGBP` `hCHF` `hARS` `hBRL` | Tokenized euro, pound, franc, Argentine peso, Brazilian real | Borrowable fiat reserves | 0 (borrow factor 0.85) |

**Card debt is denominated in the transaction currency.** A purchase at a Turkish POS borrows `hTRY` for the TRY amount (`vault.borrow_for_card_asset`), not USDC; the dollar collateral is untouched and the daily limit is tracked in USD. On payday the salary rule repays USDC debt first, then the **HAZE FX desk** settles every fiat debt: the treasury sends the fiat tokens to the vault, `vault.settle_fx` repays the debt and takes the equivalent USDC (SEP-38 rate plus a 0.5% spread) from collateral. Trust assumption: the operator sets that rate; a production version would read it from an oracle inside the contract.

Fiat tokens are **borrow-only** reserves: they never count as collateral, but a user can borrow them against USD-denominated collateral (`vault.borrow_asset`) and repay in kind (`vault.repay_asset`). Dollar collateral, lira debt: as the lira weakens the debt shrinks in dollar terms, so the FX risk sits with the pool's fiat suppliers rather than the borrower. hTRY is priced from the anchor's SEP-38 USD/TRY rate; the other fiat prices are static demo bases with a tiny random walk.

The asset set is defined once in [`packages/stellar/src/config.ts`](packages/stellar/src/config.ts) (`ASSET_META`): name, kind, base price, risk parameters, issuance and demo amounts. Issuance, AMM seeding, pool reserves, the price bot, the market maker and the PWA all derive from that registry, so adding another real-world asset is a one-line change plus a redeploy of the pool reserves.

Turkey is the launch market. Amounts are presented in TRY and settled in USDC.

---

## Architecture

```
                 ┌──────────────────────┐        ┌──────────────────────┐
                 │   apps/web  (PWA)    │        │  apps/terminal (POS) │
                 │ passkey · earn · card│        │  TRY → USD → ASA     │
                 └──────────┬───────────┘        └──────────┬───────────┘
                            │ signed tx / JWT                │ ASA JSON
                            ▼                                ▼
                 ┌──────────────────────────────────────────────────────┐
                 │                 services/api  (Hono)                 │
                 │  sponsor · credit engine · card hold state machine   │
                 │  salary rule · price bot + market maker · indexer    │
                 │  anchor orchestration · optional Lithic integration  │
                 └──────────┬──────────────────────────┬────────────────┘
                            │ operator-signed calls     │ fee-bump / sponsored
                            ▼                           ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │                        Stellar testnet (Soroban)                        │
   │                                                                         │
   │   VaultFactory ──deploys──▶ HazeVault (one per user)                    │
   │                                 │ submit(from = spender = to = vault)   │
   │                                 ▼                                       │
   │              Blend v2 pool  ◀── or ──▶  HazeCredit (fallback pool)      │
   │                                 │                                       │
   │                          MockOracle (Blend PriceFeed interface)         │
   │                                                                         │
   │   Classic layer: USDC / hUSDY / hXAU / hTRY assets + SACs,              │
   │   AMM liquidity pools, path payments, SEP-10/38/6 anchor                │
   └─────────────────────────────────────────────────────────────────────────┘
```

### Repository layout

```
haze/
├── apps/web            Next.js 15 PWA: passkey onboarding, Earn, Card, Cash out, Profile / employer panel
├── apps/terminal       Dependency-free demo POS: TRY amount → USD → authorization (ASA)
├── contracts/          Rust · soroban-sdk 28
│   ├── haze-vault        Per-user vault: deposit / withdraw / borrow / repay (owner);
│   │                     borrow_for_card / refund_for_card / settle_salary (operator)
│   ├── vault-factory     Deterministic vault deployment, salt = sha256(owner)
│   ├── haze-credit       Minimal lending pool implementing Blend's `submit` interface (fallback + test pool)
│   └── mock-oracle       Blend PriceFeed-compatible price source
├── services/api        Hono service: sponsor, credit engine, card flow, salary rule, prices, indexer, anchor
├── packages/stellar    Shared client: SEP-1/10/38/6, transaction builders, credit math, Blend / HazeCredit readers
├── scripts/            Keys, asset issuance + SACs, AMM, contract + Blend v2 deployment, pool liquidity, demo user, Lithic registration, end-to-end rehearsal
└── docs/brand-kit      HAZE design system
```

---

## Why Stellar

HAZE leans on properties that are specific to Stellar rather than generic EVM-style tooling.

- **Classic assets and Stellar Asset Contracts share one token.** The same hUSDY that trades on the DEX through path payments is deposited as collateral in a Soroban contract with no wrapping step.
- **Sponsored reserves and fee-bump transactions** remove XLM from the user's experience entirely. The user's account holds zero XLM; HAZE pays reserves and fees behind an allowlist.
- **Path payments** convert salary and cash-outs across assets atomically in a single operation, with the anchor as the final leg.
- **Stellar Ecosystem Proposals** provide a standard on/off-ramp: SEP-1 discovery, SEP-10 authentication, SEP-38 quotes, SEP-6 deposit-exchange and withdraw-exchange.
- **Blend v2** provides isolated lending pools with a small, stable `submit` interface that a contract can call on its own behalf.
- **Passkeys with the WebAuthn PRF extension** encrypt the account key locally, so custody stays with the user without a seed phrase.

---

## Smart contracts

All contracts are written in Rust with `soroban-sdk` 28 and live in [`contracts/`](contracts/).

### HazeVault

One vault per user. The **owner** is the user's Stellar account. The **operator** is the HAZE API. The vault holds the user's lending pool positions and always calls the pool with `from = spender = to = vault`, so pool authorization is satisfied by the contract call itself.

| Function | Caller | Purpose |
|---|---|---|
| `deposit(asset, amount)` | Owner | Pull asset from owner and supply as collateral |
| `withdraw(asset, amount)` | Owner | Withdraw collateral to owner; reverts if the position becomes unhealthy |
| `borrow(amount)` | Owner | Borrow USDC against collateral and send to owner |
| `borrow_asset(asset, amount)` / `repay_asset(asset, amount)` | Owner | Borrow or repay any pool reserve (fiat tokens); excess repayment is returned |
| `repay(amount)` | Owner | Repay debt with owner's USDC; any excess is re-supplied as collateral |
| `set_daily_limit(limit)` / `set_frozen(bool)` | Owner | Card controls enforced on-chain |
| `borrow_for_card(amount, auth_id)` | Operator | Borrow USDC for a card authorization and transfer to the settlement treasury. Idempotent on `auth_id` (SHA-256 of the issuer authorization token). Enforces daily limit and freeze. |
| `borrow_for_card_asset(asset, amount, usd_amount, auth_id)` / `refund_for_card_asset(amount, auth_id)` | Operator | Same, but in the transaction currency (e.g. hTRY for a TRY purchase); `usd_amount` feeds the daily limit |
| `settle_fx(asset, fiat_amount, usdc_amount)` | Operator | Payday FX desk: repay a fiat debt with tokens the treasury sent to the vault, move the USDC equivalent from collateral to settlement |
| `refund_for_card(amount, auth_id)` | Operator | Void / refund: repay with USDC returned by the treasury, decrement the daily counter |
| `settle_salary(amount, repay_amount)` | Operator | Pull salary via the owner's allowance, repay debt up to `repay_amount`, supply the remainder as collateral |
| `positions()` / `card_state()` / `auth_amount(auth_id)` | Anyone | Read views |

The operator surface is intentionally narrow. It cannot move collateral to an arbitrary address, and it cannot borrow beyond a card authorization.

### VaultFactory

Deploys vaults deterministically with `salt = sha256(owner)`, so the API can compute a user's vault address without querying the chain. The factory holds the shared configuration (operator, pool, USDC, settlement treasury). The admin can switch the pool address, which is how the Blend-to-HazeCredit fallback works without touching vault code.

### HazeCredit

A minimal lending pool that mirrors Blend's `submit(from, spender, to, requests)` signature and request types (`Supply`, `Withdraw`, `SupplyCollateral`, `WithdrawCollateral`, `Borrow`, `Repay`). It serves two purposes: the fallback pool if a self-hosted Blend deployment is unavailable, and the pool that HazeVault's native tests run against with real contract authorization.

### MockOracle

Implements Blend's `PriceFeed` interface (`lastprice`, `decimals`). Both Blend and HazeCredit read from it, so the price bot writes to a single contract.

---

## Design decisions

**Authorization is scoped, not delegated.** The operator key can only call `borrow_for_card`, `refund_for_card` and `settle_salary`. Collateral withdrawal and free-form borrowing require the owner's passkey signature. A compromised API cannot drain a vault.

**The vault is its own counterparty.** Blend's `submit` is always called with `from = spender = to = vault`. The pool's token pulls from the vault are pre-authorized with `authorize_as_current_contract` for the exact amount, and the contract tests verify this with real authorization rather than mocks.

**Authorization is off-chain, borrowing is asynchronous.** The card issuer's authorization stream (ASA) is answered from a credit calculation over cached positions, in milliseconds when warm and about a second on a cold read, well inside Lithic's 6-second window. The on-chain borrow is opened immediately afterwards from an operator queue with retries. This is the only exposure window in the system, and the UI locks withdrawals while an authorization hold is open.

**One price loop.** The oracle, the market maker's order book and the SEP-38 rate cache are updated in the same tick, so the pool and the DEX never disagree. In demo mode, hUSDY yield is modelled as price appreciation under accelerated time.

**A fallback is part of the design.** If the self-hosted Blend v2 deployment is not ready, `VaultFactory.set_pool(HazeCredit)` switches new vaults to the fallback pool. Vault bytecode is identical in both modes.

**Sponsorship is an allowlist, not a faucet.** The sponsor only fee-bumps a fixed set of operations: calls to the user's own vault, `VaultFactory.create_vault`, USDC approvals where the spender is the user's own vault, path payments between approved pairs, memo-tagged payments to the anchor treasury and trustlines for approved assets. Rate-limited per account.

### Credit engine

The authorization decision is a pure function in [`packages/stellar/src/credit.ts`](packages/stellar/src/credit.ts). All amounts are 7-decimal integers.

```
Effective collateral   EC = Σ amount × price × c_factor
Effective liabilities  EL = Σ debt × price / l_factor  +  open holds / l_factor(USDC)
Approve when           EC / (EL + amount / l_factor(USDC)) ≥ 1.25
Displayed limit        (EC / 1.25 − EL) × l_factor(USDC)
```

### Card hold state machine

```
PENDING  ──borrow tx confirmed / card_borrow event──▶  BORROWED
PENDING  ──3 failed attempts──────────────────────▶  FAILED     (surfaced in admin panel)
BORROWED ──clearing webhook───────────────────────▶  CLEARED
BORROWED ──void webhook───────────────────────────▶  REFUNDED   (treasury returns USDC, operator calls refund_for_card)
```

---

## Getting started

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22.x | The API runs TypeScript natively with `--experimental-transform-types`. Node 26 removed this flag; use Node 22. |
| pnpm | 10.x | `npm install -g pnpm@10` or Corepack |
| Rust | stable | With the `wasm32v1-none` target |
| stellar-cli | latest | Only for testnet deployment |
| cloudflared | latest | Optional: exposes the API for Lithic webhooks and phone demos |

```bash
rustup target add wasm32v1-none
cargo install --locked stellar-cli        # or: brew install stellar-cli
stellar network add testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
```

### Quick start without a chain

The API ships with a fake chain (`CHAIN=fake`) that seeds a demo user with collateral, so the full UI and card flow can be exercised without testnet.

```bash
pnpm install
cp services/api/.env.example services/api/.env       # fill *_SECRET with any valid S... keys, or run the keys script
cp apps/web/.env.local.example apps/web/.env.local

CHAIN=fake pnpm dev:api        # http://localhost:8787
pnpm dev:web                   # http://localhost:3000
pnpm dev:terminal              # http://localhost:3001
```

Open the PWA, choose **Import demo account** and paste the `DEMO_USER_SECRET` from `.env`. Then open the terminal, select the card and tap **Contactless pay**.

### Testnet deployment

The full sequence, with checks at each step, is in [RUNBOOK.md](RUNBOOK.md). In summary:

```bash
pnpm --filter @haze/scripts keys          # generate and fund 8 keypairs, write .env and testnet.contracts.json
pnpm --filter @haze/scripts fund-usdc TREASURY_SECRET 8   # ~60 USDC per round from the mock anchor; run several in parallel for more
pnpm --filter @haze/scripts assets        # issue hUSDY / hXAU / hTRY, deploy 4 SACs
pnpm --filter @haze/scripts haze:deploy   # build wasm, deploy MockOracle, HazeCredit, VaultFactory
pnpm --filter @haze/scripts amm           # seed USDC/hUSDY, USDC/hXAU, USDC/hTRY liquidity pools
pnpm --filter @haze/scripts pool:supply all   # treasury supplies USDC + every fiat reserve to the active pool (borrows are paid from the pool balance)
pnpm dev:api                              # price bot starts updating oracle + order book
pnpm --filter @haze/scripts demo-user     # sponsored account, vault, collateral, allowance, card, anchor JWT
pnpm --filter @haze/scripts rehearse      # end-to-end smoke test of every client flow with a throwaway key (see below)
pnpm dev:web && pnpm dev:terminal
```

The `rehearse` script replays exactly what the PWA does, signed by a random key instead of a passkey: sponsored account, vault, SEP-10, card, salary (SEP-38 + SEP-6 + `settle_salary`), withdraw, two path payments, three deposits, a card authorization and its on-chain borrow. It is the fastest way to confirm a fresh deployment before a demo.

At this point the demo runs end-to-end on the HazeCredit pool. Switching to a self-hosted Blend v2 deployment is one more step:

```bash
pnpm --filter @haze/scripts blend:deploy  # clones blend-utils, deploys BLND / backstop / pool, activates, sets blend.mode = blend
# restart the API; GET /credit/<G> now reports poolMode: blend
```

### Card issuer (optional)

HAZE integrates with the Lithic sandbox for real virtual Visa cards. Expose the API (for example `cloudflared tunnel --url http://localhost:8787`), set `LITHIC_API_KEY`, then run:

```bash
pnpm --filter @haze/scripts lithic https://<your-tunnel>.trycloudflare.com
```

The script enrols the Auth Stream Access webhook, subscribes to `card_transaction.updated`, stores both webhook secrets and turns on Standard Webhooks signature verification. Card authorizations are then answered by HAZE inside Lithic's 6-second window, and clearing or void events arrive as signed webhooks. Without Lithic, the demo terminal drives the same authorization flow directly, which is sufficient for a full demo.

---

## Testing

```bash
cargo test          # contract tests: HazeVault against HazeCredit with real contract authorization
pnpm test           # credit math, anchor chunking, ASA / hold state machine, sponsor allowlist, end-to-end API
pnpm typecheck
```

Contract tests cover deposit, withdraw, borrow, repay, card borrow with idempotency and daily limits, refund, salary settlement, freeze, health checks and factory deployment. The TypeScript suites run on Node's built-in test runner with no additional framework.

---

## API reference

The API is a Hono service on port `8787`. All amounts in request and response bodies are 7-decimal strings unless suffixed `Float`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness, pool mode, issuer status |
| `GET` | `/config` | Public network and contract configuration for clients |
| `POST` | `/onboard` · `/onboard/submit` | Sponsored account creation and vault deployment |
| `POST` | `/tx/sponsor` | Fee-bump an allowlisted user transaction |
| `GET` | `/users/:id` · `/users/:id/holds` · `/users/:id/notifications` · `/users/:id/anchor-txs` | User state |
| `GET` | `/credit/:id` | Positions, reserves, prices, card state and available limit |
| `POST` | `/rules` · `/allowance` | Salary rule and USDC allowance registration |
| `POST` | `/anchor/token` | Store the user's SEP-10 JWT (signed client-side by the passkey-unlocked key) |
| `POST` | `/salary/start` · `/salary/settle` | Salary deposit via SEP-38 + SEP-6, then `settle_salary` |
| `POST` | `/cashout/start` · `GET /cashout/:userId/:id` | Withdraw to bank via SEP-6 withdraw-exchange |
| `POST` | `/card/create` · `/card/asa` · `/card/webhook` | Card issuance, authorization stream, clearing / void |
| `POST` | `/terminal/charge` · `/terminal/clear` · `/terminal/void` | Demo POS entry points |
| `GET` | `/prices` · `POST /prices/tick` | Price service state and manual tick |
| `GET` | `/admin/users` · `/admin/holds` · `POST /admin/holds/:authId/retry` | Operations panel |

---

## Demo scenario

| Scene | Where | On-chain |
|---|---|---|
| Create account with a passkey | PWA | Sponsored account (0 XLM), `VaultFactory.create_vault`, SEP-10 |
| Receive salary | Profile → Employer panel | SEP-38 quote, SEP-6 deposit-exchange, `settle_salary` |
| Allocate savings | Earn → Allocation | One `PathPaymentStrictReceive` per chosen asset + `vault.deposit` for each |
| Pay at a café (450 TRY) | Terminal → Contactless pay | ASA answered off-chain, then `borrow_for_card_asset(hTRY, 450)` → settlement treasury; debt is in lira |
| Cash out from gold | Cash out → From gold | `vault.withdraw(hXAU)`, SEP-6 withdraw-exchange, path payment to anchor |
| Payday | Profile → Simulate payday | `settle_salary` repays USDC debt and re-supplies the rest; `settle_fx` closes the lira debt via the FX desk |

---

## Status and scope

- Runs on **Stellar testnet** against a self-hosted **Blend v2** pool (deployed with blend-utils); HazeCredit remains the fallback. Contracts are not audited and must not be used with real funds.
- Built for the **Rise In × Stellar Pro Hackathon 2026** (Istanbul, September 19–20).
- Regulatory and compliance considerations (card issuing licences, KYC, lending regulation) are explicitly out of scope for this prototype.
- The anchor is a mock (`tr-mock-anchor.fly.dev`). Yield on hUSDY is simulated as price appreciation under accelerated time; gold and stock prices follow a random walk around a configurable base (`XAU_USD`, `NVDA_USD`, `SHEL_USD`, `BMW_USD`). All of this is stated as such in the demo.

---

## Documentation

- [RUNBOOK.md](RUNBOOK.md) — step-by-step testnet setup, demo script and troubleshooting (Turkish)
- [README.tr.md](README.tr.md) — this document in Turkish
- [docs/brand-kit/HAZE-SISTEM.md](docs/brand-kit/HAZE-SISTEM.md) — design system: colour, type, logo and surface rules
