# HAZE — Satmadan harca

Maaş ve birikim USDC, hUSDY (tokenize hazine bonosu) ve hXAU (tokenize altın) olarak kullanıcıya özel bir
Soroban kasasında (**HazeVault**) teminat olarak durur ve getiri üretir. Kullanıcı Visa kartla harcar; her
harcama teminata karşı Blend'den alınan USDC borcu olarak yazılır. Maaş günü borç otomatik kapanır; teminat
hiç satılmaz. Stellar üzerinde: klasik varlık + SAC modeli sayesinde aynı token hem DEX'te path payment'la
hem akıllı sözleşmede teminat olarak çalışır; kullanıcının cüzdanında XLM yok (sponsorlu rezervler + fee-bump).

Rise In × Stellar Pro Hackathon 2026 (19–20 Eylül, İstanbul). Hukuki uyum kapsam dışı.

```
haze/
├── apps/web          Next.js PWA (HAZE marka kiti): passkey, Kazan, kart, nakde çevir, profil/işveren paneli
├── apps/terminal     demo POS: TL tutar → USD → ASA
├── contracts/        Rust · soroban-sdk 28
│   ├── haze-vault      kullanıcı başına kasa: deposit/withdraw/borrow/repay (sahip), borrow_for_card/refund_for_card/settle_salary (operatör)
│   ├── vault-factory   deterministik vault deploy (salt = sha256(owner))
│   ├── haze-credit     Blend `submit` arayüzünü taklit eden yedek havuz (aynı zamanda test havuzu)
│   └── mock-oracle     Blend PriceFeed uyumlu fiyat kaynağı
├── services/api      Hono: sponsor (izin listesi + fee-bump), kredi motoru, ASA + hold durum makinesi, maaş kuralı, fiyat botu + market maker, indexer, anchor
├── packages/stellar  SEP-1/10/38/6 istemcisi, işlem kurucular, kredi hesabı, Blend/HazeCredit okuma
├── scripts/          anahtarlar, varlık ihracı + SAC, AMM, Haze kontrat dağıtımı, kendi Blend v2 dağıtımı (blend-utils), demo kullanıcı
└── docs/brand-kit    HAZE marka sistemi (tasarım)
```

Kurulum ve demo adımları: **[RUNBOOK.md](RUNBOOK.md)**.

## Hızlı başlangıç (zincirsiz)

```bash
pnpm install
cp services/api/.env.example services/api/.env   # ya da pnpm --filter @haze/scripts keys
CHAIN=fake pnpm dev:api      # :8787
pnpm dev:web                 # :3000
pnpm dev:terminal            # :3001
```

## Testler

```bash
cargo test        # 24 kontrat testi (HazeVault gerçek kontrat yetkisiyle HazeCredit'e karşı)
pnpm test         # kredi hesabı, anchor parçalama, ASA/hold makinesi, sponsor izin listesi, uçtan uca API
pnpm typecheck
```

## Kritik tasarım kararları

- **Operatör yetkisi kapsamlı:** haze-api yalnızca `borrow_for_card` (günlük limit, dondurma, idempotent auth_id), `refund_for_card`, `settle_salary` çağırabilir. Teminat çekme ve serbest borç yalnızca sahibin passkey imzasıyla.
- **Vault = from = spender = to:** Blend `submit` yetkisi kontrat çağrısıyla kendiliğinden sağlanır; havuzun vault'tan token çekişi `authorize_as_current_contract` ile tam tutara yetkilendirilir (testlerde gerçek yetkiyle doğrulanır).
- **Onay off-chain, borç asenkron:** ASA cevabı limit hesabıyla <500 ms; Blend borcu hemen ardından operatör kuyruğundan açılır. Tek risk penceresi bu birkaç saniyedir; UI açık hold varken çekimi kilitler.
- **Tek fiyat servisi:** oracle ve market maker aynı döngüde güncellenir; hUSDY getirisi hızlandırılmış zamanla fiyat artışı olarak modellenir (sahnede söylenir).
- **Yedek plan hazır:** Blend dağıtımı 8. saatte çalışmazsa `VaultFactory.set_pool(HazeCredit)`; vault kodu değişmez.
