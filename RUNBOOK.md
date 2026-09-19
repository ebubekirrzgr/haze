# HAZE v2 — RUNBOOK (testnet kurulumu ve demo)

Bu belge, kodu yazan ikimiz içindir: makinede neyi hangi sırayla koşturacağız, hangi adımda ne kontrol edeceğiz.
Mimari belge: `Haze v2: Teminatlı Harcama` (ekip). Marka: `docs/brand-kit/HAZE-SISTEM.md`.

## 0. Gereksinimler (bir kez)

```bash
# Rust + wasm hedefi + stellar-cli
rustup target add wasm32v1-none
cargo install --locked stellar-cli          # ya da: brew install stellar-cli
stellar network add testnet --rpc-url https://soroban-testnet.stellar.org --network-passphrase "Test SDF Network ; September 2015"

# Node 22+ ve pnpm
corepack enable && pnpm install
```

Kontrol: `cargo test` (24 test) · `pnpm test` (24 test) · `pnpm typecheck`.

## 1. Testnet'e dokunmadan çalıştırma (UI geliştirme)

```bash
cp services/api/.env.example services/api/.env      # rastgele S... anahtarlar yaz ya da `keys` koş
CHAIN=fake pnpm dev:api                              # sahte zincir: 1000 USDC + 500 hUSDY teminatlı demo kullanıcı
pnpm dev:web                                         # http://localhost:3000 → "Demo hesabını içe aktar" → DEMO_USER_SECRET
pnpm dev:terminal                                    # http://localhost:3001 → kart seç → Temassız öde
```

## 2. Testnet kurulumu (sıra önemli)

| # | Komut | Ne yapar | Kontrol |
|---|---|---|---|
| 1 | `pnpm --filter @haze/scripts keys` | 8 anahtar üretir, friendbot'la fonlar, `.env` + `testnet.contracts.json` yazar | `.env` içinde `*_SECRET` dolu |
| 2 | Treasury'ye USDC: `pnpm --filter @haze/scripts fund-usdc TREASURY_SECRET 8` (≈ 8×60 USDC; pnpm 10'da `--` kullanma, script'e argüman olarak geçer; paralel 3 oturum ≈ 1.500 USDC) ya da faucet.circle.com | Blend likiditesi + AMM + demo kullanıcı için USDC | Horizon'da treasury USDC bakiyesi |
| 3 | `pnpm --filter @haze/scripts assets` | hUSDY/hXAU/hTRY ihracı → treasury, 4 SAC deploy | `testnet.contracts.json` → `assets.*.sac` dolu |
| 4 | `pnpm --filter @haze/scripts haze:deploy` | `stellar contract build` (soroban-sdk 28 `cargo build`'i reddeder) → haze_vault upload, MockOracle, HazeCredit (rezervler + fiyat), VaultFactory | `haze.vaultFactory` dolu; `blend.mode = hazecredit` |
| 5 | `pnpm --filter @haze/scripts amm` | USDC/hUSDY, USDC/hXAU, USDC/hTRY klasik AMM havuzları | `stellar.expert`'te liquidity pool |
| 5b | `pnpm --filter @haze/scripts pool:supply 200` | Hazineden HazeCredit'e USDC likiditesi (kart borçları havuz bakiyesinden aktarılır; kullanıcı teminatı da havuzdadır) | `GET /credit/<G>` sonrası borç işlemleri geçiyor |
| 6 | `pnpm dev:api` (ayrı terminal) | haze-api: fiyat botu oracle'ı + teklif defterini günceller | `GET /health`, `GET /prices` USDTRY dolu |
| 7 | `pnpm --filter @haze/scripts demo-user` | Demo kullanıcı: sponsorlu hesap, vault, 500 USDC + 300 hUSDY + 0,1 hXAU teminat, allowance, kart, anchor JWT | `GET /credit/<G>` limit gösteriyor |
| 8 | `pnpm dev:web`, `pnpm dev:terminal` | PWA + POS | terminal → ONAYLANDI, explorer'da `borrow_for_card` |

**Bu noktada demo HazeCredit (yedek havuz) ile uçtan uca çalışıyor olmalı.** 8. saat kontrol noktası buradan sonrası:

| 9 | `pnpm --filter @haze/scripts blend:deploy` | Kendi Blend v2 dağıtımımız (blend-utils klonlanır, `haze-mock.ts` koşar, ~10 dk): BLND, comet, oracle, factory/backstop/emitter, "Haze" havuzu (USDC/hUSDY/hXAU), backstop depozitosu, Active, treasury USDC supply. Sonra `apply.ts` → `blend.mode = blend`, `VaultFactory.set_pool` | `stellar contract invoke --id <pool> -- get_reserve_list` üç SAC |
| 10 | haze-api'yi yeniden başlat | Blend modunda: pozisyonlar blend-sdk ile, fiyat botu `set_price_stable` (BLEND_ADMIN) | `GET /credit/<G>` `poolMode: blend` |

Notlar
- Blend'de rezerv ekleme yalnızca havuz `Setup` (6) durumundayken gecikmesizdir; `haze-mock.ts` rezervleri backstop/Active'den önce ekler. Sonradan rezerv eklemek 7 gün bekler.
- `set_status(0)` için backstop eşiği gerekir; BLND ve comet USDC'sini biz bastığımız için eşik sorun değil (whale = treasury).
- Var olan vault'lar `pool` adresini kuruluşta alır. Blend'e geçtikten sonra demo kullanıcıyı **yeniden** kurmak gerekir (vault deterministik; yeni vault için yeni demo anahtarı: `.env`'den `DEMO_USER_SECRET`'ı sil ve `keys` + `demo-user`).
- Yedeğe dönüş: `testnet.contracts.json` → `blend.mode: "hazecredit"` + `stellar contract invoke --id <factory> -- set_pool --pool <hazeCredit>`.

## 3. Lithic (opsiyonel)

1. Sandbox API key → `.env` `LITHIC_API_KEY`. `PUBLIC_URL` tünel adresi (cloudflared).
2. ASA kaydı: `curl -X POST $LITHIC_BASE_URL/auth_stream -H "Authorization: $KEY" -d '{"webhook_url":"$PUBLIC_URL/card/asa"}'`; `GET /auth_stream/secret` → `LITHIC_WEBHOOK_SECRET`, `VERIFY_ASA_HMAC=true`.
3. Transaction webhook'u `$PUBLIC_URL/card/webhook`.
4. `POST /card/create` artık gerçek sanal Visa döner; terminal `simulate/authorize` çağırır, ASA bize gelir.
Lithic yoksa terminal aynı ASA JSON'unu doğrudan `/card/asa`'ya yollar (varsayılan) — demo için yeterli.

## 4. Demo senaryosu (3 dk) — komut karşılıkları

| Sahne | Nerede | Zincir |
|---|---|---|
| Passkey ile hesap | PWA → "Passkey ile hesap oluştur" | createAccount (sponsorlu, 0 XLM), VaultFactory.create_vault, SEP-10 |
| 2.500 TL maaş | Profil → İşveren paneli → Maaş yatır | SEP-38 quote, SEP-6 deposit-exchange, simulate-bank-transfer, settle_salary |
| Kazan dağılımı | Kazan → Dağılım → %50/30/20 | 2× PathPaymentStrictReceive + 3× vault.deposit |
| Kafe, Bursa, 450 TL | terminal → Temassız öde | ASA (<500 ms), borrow_for_card → USDC takas hazinesine |
| Altından 500 TL | Nakde çevir → Altından | vault.withdraw(hXAU), SEP-6 withdraw-exchange, PathPaymentStrictReceive → anchor (memo) |
| Ay sonu | Profil → Maaş günü simülasyonu | settle_salary: Repay + kalan SupplyCollateral |

Prova için `DB_PATH` silinip `demo-user` yeniden koşulabilir (vault kalıcıdır; teminat ekleme idempotent değildir, miktar artar).

## 5. Sorun giderme

- `simulation failed ... Auth, InvalidAction`: vault'un pool'a verdiği transfer yetkisi tutar/adresle eşleşmiyor → havuz adresi `get_config` ile aynı mı?
- `daily limit exceeded`: kart günlük limiti (varsayılan 500 USDC) → Kart → Ayarla.
- `position unhealthy`: teminat yetersiz; `GET /credit/<G>` limit 0 mı?
- Hold `FAILED`: `GET /admin/holds`, `POST /admin/holds/<authId>/retry`.
- Anchor `pending_trust`: USDC trustline yok — onboarding trustline'ları sponsorlu açar; demo-user için `ensureTrustline`.
- RPC "needs state restore": kontrat TTL'i dolmuş → `stellar contract restore --id …` (haze-api her çağrıda instance TTL uzatır).
