<p align="center">
  <img src="apps/web/public/logo/haze-logo-sepya.svg" alt="HAZE" width="220">
</p>

<h3 align="center">Satmadan harca.</h3>

<p align="center">
  Stellar üzerinde teminatlı harcama. Maaş ve birikim, kullanıcıya özel bir Soroban kasasında USDC, tokenize hazine bonosu ve tokenize altın olarak durur. Her kart harcaması bu teminata karşı açılan bir USDC borcudur. Maaş günü borç kapanır. Varlıklar hiç satılmaz.
</p>

<p align="center">
  <a href="#başlangıç">Başlangıç</a> ·
  <a href="#mimari">Mimari</a> ·
  <a href="#akıllı-sözleşmeler">Akıllı sözleşmeler</a> ·
  <a href="#tasarım-kararları">Tasarım kararları</a> ·
  <a href="#api-referansı">API</a> ·
  <a href="RUNBOOK.md">Runbook</a> ·
  <a href="README.md">English</a>
</p>

<p align="center">
  <b><a href="https://haze.iyi.im/landing">Demo ve video</a></b> ·
  <a href="https://haze.iyi.im">Canlı uygulama (testnet)</a> ·
  <a href="https://haze.iyi.im/media/haze-demo.mp4">Tanıtım videosu — 3 dk</a> ·
  <a href="https://drive.google.com/file/d/1-r00MhogQUEiFXthk6WQOOD-Hobcn0pa/view?usp=sharing">Sunum</a>
</p>

---

## Genel bakış

HAZE, Stellar üzerinde çalışan, kullanıcının varlıklarını kendi kontrolünde tuttuğu bir harcama hesabıdır. Kullanıcı getiri üreten varlıklarını kendine ait bir akıllı sözleşme kasasında (**HazeVault**) tutar ve Visa kartla öder. Satış noktasında varlık satılmaz; her yetkilendirme, kasadaki teminata karşı bir kredi havuzunda küçük bir USDC borç pozisyonu açar. Bir sonraki maaş geldiğinde borç otomatik kapanır, kalan tutar yeniden teminata eklenir.

Sonuç: birikimini yatırımda tutarken ona karşı harcayabilen bir kart. Kullanıcının cüzdanında XLM yok, kurtarma kelimeleri yok, arada borsa yok.

**Kullanıcının gördüğü**

| Ekran | Ne olur |
|---|---|
| **Hesap açma** | Türkçe, İngilizce, Portekizce veya İspanyolca arayüz (otomatik algılanır, profil sayfasından değiştirilir). Passkey ile hesap oluşur. Rezervler sponsorludur, ücretler fee-bump ile ödenir, deterministik bir kasa dağıtılır. Kullanıcı XLM'e hiç dokunmaz. |
| **Kazan** | Gelen maaş (SEP-6 anchor üzerinden) tek passkey onayıyla USDC, tokenize hazine bonosu, altın ve hisseler (NVIDIA, Shell, BMW) arasında dağıtılır. "Borç al" sekmesi bu teminata karşı fiat token (TRY, EUR, GBP, CHF, ARS, BRL) borçlandırır. |
| **Kart** | Temassız ödeme zincir dışında onaylanır: önbellekteki pozisyonlarla milisaniyeler, soğuk okumada yaklaşık bir saniye. Zincirdeki borç birkaç saniye sonra operatör kuyruğundan açılır. |
| **Nakde çevir** | Altta yatan varlık satılmadan, path payment ve anchor çekimi ile banka hesabına yerel para birimiyle çekim yapılır. |
| **Maaş günü** | Maaş kuralı açık borcu kapatır, kalanı yeniden teminata ekler. |

**Varlıklar**

| Sembol | Açıklama | Rol | Teminat faktörü |
|---|---|---|---|
| `USDC` | Circle USDC (testnet ihraççısı) | Borç varlığı, ana teminat | 0,95 |
| `hUSDY` | Tokenize kısa vadeli hazine bonosu | Getiri üreten teminat | 0,90 |
| `hXAU` | Tokenize altın | Değer saklama teminatı | 0,75 |
| `hNVDA` | Tokenize NVIDIA hissesi | Hisse teminatı | 0,65 |
| `hSHEL` | Tokenize Shell hissesi | Hisse teminatı | 0,70 |
| `hBMW` | Tokenize BMW hissesi | Hisse teminatı | 0,70 |
| `hTRY` | Tokenize Türk lirası | Borç alınabilir fiat rezerv, giriş/çıkış bacağı | 0 (borç faktörü 0,85) |
| `hEUR` `hGBP` `hCHF` `hARS` `hBRL` | Tokenize euro, sterlin, frank, Arjantin pesosu, Brezilya reali | Borç alınabilir fiat rezervler | 0 (borç faktörü 0,85) |

**Kart borcu işlem para birimindedir.** Türkiye'deki bir POS'ta yapılan harcama, TL tutarı kadar `hTRY` borçlandırır (`vault.borrow_for_card_asset`), USDC değil; dolar teminat yerinde kalır, günlük limit USD cinsinden izlenir. Maaş günü kural motoru önce USDC borcunu kapatır, sonra **HAZE kur masası** her fiat borcu kapatır: hazine fiat token'ı vault'a gönderir, `vault.settle_fx` borcu öder ve karşılığı USDC'yi (SEP-38 kuru + %0,5 spread) teminattan alır. Güven varsayımı: kuru operatör belirler; üretim sürümünde sözleşme içinden oracle okunur.

Fiat token'lar **yalnız borç** rezervidir: teminat sayılmazlar, ama dolar cinsi teminata karşı borç alınabilir (`vault.borrow_asset`) ve aynı cinsten ödenir (`vault.repay_asset`). Dolar teminat, lira borç: lira değer kaybettikçe borcun dolar karşılığı küçülür; kur riski borçluda değil, havuza fiat sağlayanlarda. hTRY anchor'ın SEP-38 USD/TRY kurundan fiyatlanır; diğer fiat fiyatları küçük rastgele yürüyüşlü sabit demo tabanlarıdır.

Varlık kümesi tek yerde tanımlıdır: [`packages/stellar/src/config.ts`](packages/stellar/src/config.ts) içindeki `ASSET_META` (ad, tür, taban fiyat, risk parametreleri, ihraç ve demo miktarları). İhraç, AMM, havuz rezervleri, fiyat botu, market maker ve PWA bu kayıttan türer; yeni bir gerçek dünya varlığı eklemek tek satır artı havuz rezervlerinin yeniden dağıtımıdır.

Başlangıç pazarı Türkiye'dir. Tutarlar TL olarak gösterilir, USDC ile takas edilir.

---

## Mimari

```
                 ┌──────────────────────┐        ┌──────────────────────┐
                 │   apps/web  (PWA)    │        │  apps/terminal (POS) │
                 │passkey · kazan · kart│        │  TL → USD → ASA      │
                 └──────────┬───────────┘        └──────────┬───────────┘
                            │ imzalı işlem / JWT             │ ASA JSON
                            ▼                                ▼
                 ┌──────────────────────────────────────────────────────┐
                 │                 services/api  (Hono)                 │
                 │  sponsor · kredi motoru · kart hold durum makinesi   │
                 │  maaş kuralı · fiyat botu + market maker · indexer   │
                 │  anchor orkestrasyonu · opsiyonel Lithic entegrasyonu│
                 └──────────┬──────────────────────────┬────────────────┘
                            │ operatör imzalı çağrılar  │ fee-bump / sponsorlu
                            ▼                           ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │                        Stellar testnet (Soroban)                        │
   │                                                                         │
   │   VaultFactory ──dağıtır──▶ HazeVault (kullanıcı başına bir tane)       │
   │                                 │ submit(from = spender = to = vault)   │
   │                                 ▼                                       │
   │              Blend v2 havuzu ◀── ya da ──▶ HazeCredit (yedek havuz)     │
   │                                 │                                       │
   │                          MockOracle (Blend PriceFeed arayüzü)           │
   │                                                                         │
   │   Klasik katman: USDC / hUSDY / hXAU / hTRY varlıkları + SAC'ler,       │
   │   AMM likidite havuzları, path payment, SEP-10/38/6 anchor              │
   └─────────────────────────────────────────────────────────────────────────┘
```

### Depo yerleşimi

```
haze/
├── apps/web            Next.js 15 PWA: passkey ile hesap açma, Kazan, Kart, Nakde çevir, Profil / işveren paneli
├── apps/terminal       Bağımlılıksız demo POS: TL tutar → USD → yetkilendirme (ASA)
├── contracts/          Rust · soroban-sdk 28
│   ├── haze-vault        Kullanıcı başına kasa: deposit / withdraw / borrow / repay (sahip);
│   │                     borrow_for_card / refund_for_card / settle_salary (operatör)
│   ├── vault-factory     Deterministik kasa dağıtımı, salt = sha256(owner)
│   ├── haze-credit       Blend'in `submit` arayüzünü uygulayan minimal kredi havuzu (yedek + test havuzu)
│   └── mock-oracle       Blend PriceFeed uyumlu fiyat kaynağı
├── services/api        Hono servisi: sponsor, kredi motoru, kart akışı, maaş kuralı, fiyatlar, indexer, anchor
├── packages/stellar    Ortak istemci: SEP-1/10/38/6, işlem kurucular, kredi hesabı, Blend / HazeCredit okuyucuları
├── scripts/            Anahtarlar, varlık ihracı + SAC, AMM, kontrat + Blend v2 dağıtımı, havuz likiditesi, demo kullanıcı, Lithic kaydı, uçtan uca prova
└── docs/brand-kit      HAZE tasarım sistemi
```

---

## Neden Stellar

HAZE, genel EVM tarzı araçlara değil, Stellar'a özgü özelliklere yaslanır.

- **Klasik varlık ve Stellar Asset Contract aynı token'dır.** DEX'te path payment ile işlem gören hUSDY, sarmalama adımı olmadan bir Soroban sözleşmesine teminat olarak yatırılır.
- **Sponsorlu rezervler ve fee-bump işlemleri** XLM'i kullanıcı deneyiminden tamamen çıkarır. Kullanıcının hesabında sıfır XLM vardır; rezerv ve ücretleri HAZE bir izin listesi arkasından öder.
- **Path payment** maaşı ve nakit çekimini tek işlemde, atomik olarak varlıklar arasında dönüştürür; son bacak anchor'dur.
- **Stellar Ecosystem Proposal'lar** standart giriş/çıkış rampası sağlar: SEP-1 keşif, SEP-10 kimlik doğrulama, SEP-38 teklif, SEP-6 deposit-exchange ve withdraw-exchange.
- **Blend v2**, bir sözleşmenin kendi adına çağırabildiği küçük ve kararlı bir `submit` arayüzüne sahip izole kredi havuzları sunar.
- **WebAuthn PRF uzantılı passkey'ler** hesap anahtarını yerelde şifreler; kurtarma kelimeleri olmadan kontrol kullanıcıda kalır.

---

## Akıllı sözleşmeler

Tüm sözleşmeler Rust ile `soroban-sdk` 28 kullanılarak yazılmıştır ve [`contracts/`](contracts/) altındadır.

### HazeVault

Kullanıcı başına bir kasa. **Sahip**, kullanıcının Stellar hesabıdır. **Operatör**, HAZE API'sidir. Kasa, kullanıcının kredi havuzu pozisyonlarını tutar ve havuzu her zaman `from = spender = to = vault` ile çağırır; böylece havuz yetkisi sözleşme çağrısının kendisiyle sağlanır.

| Fonksiyon | Çağıran | Amaç |
|---|---|---|
| `deposit(asset, amount)` | Sahip | Varlığı sahipten alır ve teminat olarak yatırır |
| `withdraw(asset, amount)` | Sahip | Teminatı sahibe çeker; pozisyon sağlıksız kalırsa geri alınır |
| `borrow(amount)` | Sahip | Teminata karşı USDC borç alır ve sahibe gönderir |
| `borrow_asset(asset, amount)` / `repay_asset(asset, amount)` | Sahip | Herhangi bir havuz rezervini (fiat token) borç alır ya da öder; fazla ödeme geri döner |
| `repay(amount)` | Sahip | Sahibin USDC'siyle borç öder; fazlası yeniden teminata eklenir |
| `set_daily_limit(limit)` / `set_frozen(bool)` | Sahip | Zincirde uygulanan kart kontrolleri |
| `borrow_for_card(amount, auth_id)` | Operatör | Kart yetkilendirmesi için USDC borç açar ve takas hazinesine aktarır. `auth_id` (ihraççı yetkilendirme token'ının SHA-256'sı) üzerinde idempotenttir. Günlük limit ve dondurmayı uygular. |
| `borrow_for_card_asset(asset, amount, usd_amount, auth_id)` / `refund_for_card_asset(amount, auth_id)` | Operatör | Aynısı, işlem para biriminde (TL harcama → hTRY); `usd_amount` günlük limiti besler |
| `settle_fx(asset, fiat_amount, usdc_amount)` | Operatör | Maaş günü kur masası: hazinenin vault'a gönderdiği tokenla fiat borcu kapatır, USDC karşılığını teminattan takas hazinesine aktarır |
| `refund_for_card(amount, auth_id)` | Operatör | İptal / iade: hazinenin geri gönderdiği USDC ile borç öder, günlük sayacı düşürür |
| `settle_salary(amount, repay_amount)` | Operatör | Sahibin allowance'ı ile maaşı çeker, `repay_amount` kadar borç kapatır, kalanı teminata ekler |
| `positions()` / `card_state()` / `auth_amount(auth_id)` | Herkes | Okuma görünümleri |

Operatör yüzeyi bilinçli olarak dardır. Teminatı rastgele bir adrese taşıyamaz, bir kart yetkilendirmesinin ötesinde borç açamaz.

### VaultFactory

Kasaları `salt = sha256(owner)` ile deterministik dağıtır; API bir kullanıcının kasa adresini zincire sormadan hesaplayabilir. Factory ortak yapılandırmayı tutar (operatör, havuz, USDC, takas hazinesi). Admin havuz adresini değiştirebilir; Blend'den HazeCredit'e yedek geçiş, kasa koduna dokunmadan bu şekilde çalışır.

### HazeCredit

Blend'in `submit(from, spender, to, requests)` imzasını ve istek tiplerini (`Supply`, `Withdraw`, `SupplyCollateral`, `WithdrawCollateral`, `Borrow`, `Repay`) birebir taklit eden minimal kredi havuzu. İki amacı vardır: kendi Blend dağıtımımız hazır olmazsa yedek havuz, ve HazeVault'un native testlerinin gerçek sözleşme yetkisiyle karşısında koştuğu havuz.

### MockOracle

Blend'in `PriceFeed` arayüzünü (`lastprice`, `decimals`) uygular. Hem Blend hem HazeCredit buradan okur; fiyat botu tek sözleşmeye yazar.

---

## Tasarım kararları

**Yetki devredilmez, kapsamlanır.** Operatör anahtarı yalnızca `borrow_for_card`, `refund_for_card` ve `settle_salary` çağırabilir. Teminat çekimi ve serbest borç sahibin passkey imzasını gerektirir. Ele geçirilmiş bir API kasayı boşaltamaz.

**Kasa kendi karşı tarafıdır.** Blend'in `submit` fonksiyonu her zaman `from = spender = to = vault` ile çağrılır. Havuzun kasadan token çekişleri `authorize_as_current_contract` ile tam tutara önceden yetkilendirilir; sözleşme testleri bunu mock değil gerçek yetkiyle doğrular.

**Onay zincir dışı, borç asenkron.** Kart ihraççısının yetkilendirme akışı (ASA), önbellekteki pozisyonlar üzerinden yapılan kredi hesabıyla yanıtlanır: sıcakken milisaniyeler, soğuk okumada yaklaşık bir saniye; Lithic'in 6 saniyelik penceresinin çok içinde. Zincirdeki borç hemen ardından yeniden denemeli operatör kuyruğundan açılır. Sistemdeki tek risk penceresi budur; açık hold varken arayüz çekimleri kilitler.

**Tek fiyat döngüsü.** Oracle, market maker'ın teklif defteri ve SEP-38 kur önbelleği aynı tikte güncellenir; havuz ile DEX hiçbir zaman farklı fiyat görmez. Demo modunda hUSDY getirisi hızlandırılmış zamanla fiyat artışı olarak modellenir.

**Yedek plan tasarımın parçasıdır.** Kendi Blend v2 dağıtımı hazır değilse `VaultFactory.set_pool(HazeCredit)` yeni kasaları yedek havuza yönlendirir. Kasa bytecode'u iki modda da aynıdır.

**Sponsorluk musluk değil, izin listesidir.** Sponsor yalnızca sabit bir işlem kümesini fee-bump eder: kullanıcının kendi kasasına çağrılar, `VaultFactory.create_vault`, spender'ı kullanıcının kendi kasası olan USDC approve, izinli çiftler arasında path payment, anchor hazinesine memo'lu ödeme ve izinli varlıklar için trustline. Hesap başına hız sınırı vardır.

### Kredi motoru

Yetkilendirme kararı [`packages/stellar/src/credit.ts`](packages/stellar/src/credit.ts) içinde saf bir fonksiyondur. Tüm tutarlar 7 ondalıklı tam sayıdır.

```
Etkin teminat     EC = Σ miktar × fiyat × c_factor
Etkin borç        EL = Σ borç × fiyat / l_factor  +  açık hold'lar / l_factor(USDC)
Onay koşulu       EC / (EL + tutar / l_factor(USDC)) ≥ 1,25
Gösterilen limit  (EC / 1,25 − EL) × l_factor(USDC)
```

### Kart hold durum makinesi

```
PENDING  ──borç işlemi onaylandı / card_borrow olayı──▶  BORROWED
PENDING  ──3 başarısız deneme─────────────────────────▶  FAILED     (yönetim panelinde görünür)
BORROWED ──clearing webhook───────────────────────────▶  CLEARED
BORROWED ──void webhook───────────────────────────────▶  REFUNDED   (hazine USDC'yi iade eder, operatör refund_for_card çağırır)
```

---

## Teknik belge haritası

Tam teknik yazı (mimari, bileşenler, Stellar entegrasyonları, tasarım kararları ve ödünleşimler, teknik zorluklar) İngilizce olarak [docs/TECHNICAL.md](docs/TECHNICAL.md) dosyasındadır. Aynı içerik bu README'de şu bölümlere dağılmıştır:

| Gereksinim | Bölüm |
|---|---|
| Genel mimari | [Mimari](#mimari) |
| Ana bileşenler ve sorumlulukları | [Depo yerleşimi](#depo-yerleşimi), [Akıllı sözleşmeler](#akıllı-sözleşmeler), [API referansı](#api-referansı) |
| Stellar entegrasyonları ve protokoller | [Neden Stellar](#neden-stellar) |
| Tasarım kararları ve ödünleşimler | [Tasarım kararları](#tasarım-kararları), [Ödünleşimler](#ödünleşimler) |
| Teknik zorluklar ve çözümler | [Teknik zorluklar](#teknik-zorluklar) |

## Ödünleşimler

- **Onay zincir dışı, borç zincirde.** İhraççı altı saniyede cevap ister, Soroban kesinliği beş saniye. HAZE önbellekteki pozisyonlardan cevap verir, borcu birkaç saniye sonra açar. Bedeli: onaylanan tutarın zincirde henüz rezerve edilmediği kısa bir pencere. Üretimde önce zincirde rezervasyon ya da ihraççı penceresinde senkron borç gerekir.
- **Operatörün belirlediği kur.** `settle_fx` ve `borrow_for_card_asset` USD karşılığını anchor'ın SEP-38 kurunu okuyan operatörden alır. Demo için sözleşme oracle mantığından arınmış kalır; üretimde iki değer de zincir içi oracle ile sınırlanmalıdır.
- **İki havuz, tek arayüz.** Hedef Blend v2, yedek aynı `submit` arayüzüne sahip minimal HazeCredit. Kasa hiç değişmez, factory yalnızca havuz adresini değiştirir. Bedeli: bakımı yapılacak ikinci bir sözleşme.
- **İzin listeli sponsorluk.** Kullanıcıda XLM yok; rezerv ve ücretleri HAZE öder. İzin listesi sponsoru musluğa dönüşmekten korur, karşılığında sabit bir işlem kümesi.
- **Düz depolama yedekli passkey.** WebAuthn PRF anahtarı yerelde şifreler; PRF olmayan tarayıcı görünür demo uyarısıyla düz depolamaya düşer.
- **Mock varlıklar ve anchor.** hUSDY, hXAU, hisseler ve fiat token'lar hazine tarafından basılır, fiyatlar bottan gelir. Tüm akış bugün testnet'te çalışır; her mock'un adı konmuş bir mainnet karşılığı vardır.

## Teknik zorluklar

| Zorluk | Ne oldu | Çözüm |
|---|---|---|
| Simülasyon kaynakları ile yürütme farkı | İşlemler simülasyondan geçip zincirde `resource_limit_exceeded` ile düştü (1332 bayt yazıldı, 1304 bildirildi); simülasyon ile dahil edilme arasında durum değişiyordu. Surge fiyatlamasında 0,001 XLM dahil etme ücreti de reddedildi. | Ortak Soroban istemcisi talimat ve baytları %30, kaynak ücretini 2× şişirir (iade edilebilir kısım döner), 0,01 XLM dahil etme ücreti kullanır, fee-bump'ı iç ücretten hesaplar. |
| Toplu oracle yazımı | `set_prices` aynı çerçevede varlık başına `require_auth` çağırıyordu; Soroban ikinciyi `Auth, ExistingValue` ile reddetti. | Yetki bir kez, döngüde yalnızca yazım. |
| Operatör kuyruğu kilidi | Boş bir tur senkron bitip `finally`nin temizlediği bekçiyi çözülmüş bir promise ile eziyordu; sonraki tüm kart borçları `PENDING` kalıyordu. | Gövde bir sonraki microtask'ta başlar, bekçi `finally`de temizlenir; regresyon testi eklendi. |
| Lithic Auth Stream Access | Kart token'ı iç içe (`card.token`), cevap şeması yalnız sabit `result` kodlarını kabul ediyor, sandbox işlem para birimini bozuyor (TRY → GBP) ve Standard Webhooks ile imzalıyor. | Yük normalizasyonu, sonuç kodu eşlemesi, terminalin simülasyondan önce bıraktığı kart başına para birimi ipucu, iki webhook için `webhook-id`/`webhook-timestamp`/`webhook-signature` doğrulaması. |
| Testnet'te kendi Blend v2 havuzu | Dağıtım üç şekilde takıldı: fiyat botu aynı admin anahtarıyla imzalayıp sıra numaralarında yarıştı; surge altında düşük ücret; var olan BLND/USDC mock'ları yerel sırayı artırdı. Rezerv yalnızca havuz `Setup` durumundayken eklenebiliyor. | Dağıtım sırasında API kapalı, token adımından sonra hesap sıraları yeniden yüklenir, işlem başına 0,2 XLM, rezerv listesi varlık kaydından üretilir. |
| İşlem para biriminde borç | TL harcaması lira borcu yaratmalı, ama maaş USDC gelir ve kasa takas yapamaz. | `borrow_for_card_asset` fiat token'ı takas hesabına borçlar; maaş günü hazine fiat'ı kasaya gönderir, `settle_fx` borcu kapatıp SEP-38 kuru + spread kadar USDC teminatı alır. |
| Nakde çevirme boyutlandırması | Teminatı oracle fiyatıyla çekmek, AMM fiyatı kayınca path payment'ı fonsuz bırakıyordu. | Çekim miktarı DEX yol tahmini + %2. |
| Cüzdanda XLM yok | Her kullanıcı işlemi ücret ve rezerv ister. | Sponsorlu hesap ve trustline açılışı, her kullanıcı işlemine fee-bump, hesap başına hız limitli sıkı izin listesi. |

---

## Başlangıç

### Canlı demo

Testnet kurulumu **[haze.iyi.im](https://haze.iyi.im)** adresinde çalışıyor — PWA, API ve POS terminali tek alan adı altında.

| | |
|---|---|
| Tanıtım sayfası ve video | <https://haze.iyi.im/landing> |
| PWA (testnet, Blend v2 havuzu) | <https://haze.iyi.im> |
| Demo videosu, 3 dk | <https://haze.iyi.im/media/haze-demo.mp4> |
| Sunum | [Google Drive](https://drive.google.com/file/d/1-r00MhogQUEiFXthk6WQOOD-Hobcn0pa/view?usp=sharing) |

PWA'yı açıp **Demo hesabını içe aktar** deyin — anahtar alanı aşağıdaki demo hesabıyla hazır gelir, doğrudan teminatı dolu bir kasaya düşersiniz. `/terminal` adresindeki POS, paylaşımlı yönetim anahtarını `?key=…` ile ister.

```
DEMO_USER_SECRET = SC6DTHLG4VOCZMVFJWASHXL7X7RJYZCBP53MW7WPJNH3G5RIMG6EHFNW
```

Bu bir **Stellar testnet** anahtarıdır ve ortak demo hesabına aittir: gerçek değer taşımaz, teminatını herkes harcayabilir, demo yeniden kurulduğunda sıfırlanır. Başka hiçbir yerde kullanmayın.

Kurulumun kendisi — Docker Compose, tek açık port, Cloudflare tüneli — [`deploy/`](deploy/README.md) altında.

### Gereksinimler

| Araç | Sürüm | Not |
|---|---|---|
| Node.js | 22.x | API, TypeScript'i `--experimental-transform-types` ile doğrudan çalıştırır. Node 26 bu bayrağı kaldırdı; Node 22 kullanın. |
| pnpm | 10.x | `npm install -g pnpm@10` ya da Corepack |
| Rust | stable | `wasm32v1-none` hedefiyle |
| stellar-cli | güncel | Yalnızca testnet dağıtımı için |
| cloudflared | güncel | İsteğe bağlı: Lithic webhook'ları ve telefon demosu için API'yi dışarı açar |

```bash
rustup target add wasm32v1-none
cargo install --locked stellar-cli        # ya da: brew install stellar-cli
stellar network add testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
```

### Zincirsiz hızlı başlangıç

API, teminatlı bir demo kullanıcı hazırlayan sahte bir zincirle (`CHAIN=fake`) gelir; tüm arayüz ve kart akışı testnet olmadan denenebilir.

```bash
pnpm install
cp services/api/.env.example services/api/.env       # *_SECRET alanlarına geçerli S... anahtarlar yazın ya da keys script'ini koşun
cp apps/web/.env.local.example apps/web/.env.local

CHAIN=fake pnpm dev:api        # http://localhost:8787
pnpm dev:web                   # http://localhost:3000
pnpm dev:terminal              # http://localhost:3001
```

PWA'yı açın, **Demo hesabını içe aktar** seçeneğini seçin ve `.env` içindeki `DEMO_USER_SECRET` değerini yapıştırın. Ardından terminali açın, kartı seçin ve **Temassız öde** düğmesine basın.

### Testnet dağıtımı

Her adımda kontrol noktası içeren tam sıra [RUNBOOK.md](RUNBOOK.md) dosyasındadır. Özetle:

```bash
pnpm --filter @haze/scripts keys          # 8 anahtar üretir ve fonlar, .env ile testnet.contracts.json yazar
pnpm --filter @haze/scripts fund-usdc TREASURY_SECRET 8   # mock anchor'dan tur başına ~60 USDC; daha fazlası için paralel koşun
pnpm --filter @haze/scripts assets        # hUSDY / hXAU / hTRY ihracı, 4 SAC dağıtımı
pnpm --filter @haze/scripts haze:deploy   # wasm build, MockOracle, HazeCredit, VaultFactory dağıtımı
pnpm --filter @haze/scripts amm           # USDC/hUSDY, USDC/hXAU, USDC/hTRY likidite havuzları
pnpm --filter @haze/scripts pool:supply all   # hazineden aktif havuza USDC + tüm fiat rezervler (borçlar havuz bakiyesinden ödenir)
pnpm dev:api                              # fiyat botu oracle'ı ve teklif defterini güncellemeye başlar
pnpm --filter @haze/scripts demo-user     # sponsorlu hesap, kasa, teminat, allowance, kart, anchor JWT
pnpm --filter @haze/scripts rehearse      # tüm istemci akışlarının atılabilir bir anahtarla uçtan uca provası (aşağıda)
pnpm dev:web && pnpm dev:terminal
```

`rehearse` script'i PWA'nın yaptığı her şeyi passkey yerine rastgele bir anahtarla tekrarlar: sponsorlu hesap, kasa, SEP-10, kart, maaş (SEP-38 + SEP-6 + `settle_salary`), çekim, iki path payment, üç yatırma, bir kart yetkilendirmesi ve zincirdeki borcu. Demo öncesi taze bir dağıtımı doğrulamanın en hızlı yolu budur.

Bu noktada demo, HazeCredit havuzuyla uçtan uca çalışır. Kendi Blend v2 dağıtımına geçiş tek adımdır:

```bash
pnpm --filter @haze/scripts blend:deploy  # blend-utils'i klonlar, BLND / backstop / havuz dağıtır, aktive eder, blend.mode = blend yazar
# API'yi yeniden başlatın; GET /credit/<G> artık poolMode: blend döner
```

### Kart ihraççısı (opsiyonel)

HAZE, gerçek sanal Visa kartlar için Lithic sandbox ile entegre çalışır. API'yi internete açın (örneğin `cloudflared tunnel --url http://localhost:8787`), `LITHIC_API_KEY` değerini girin ve şunu koşun:

```bash
pnpm --filter @haze/scripts lithic https://<tünel-adresiniz>.trycloudflare.com
```

Script, Auth Stream Access webhook'unu kaydeder, `card_transaction.updated` olaylarına abone olur, iki webhook gizli anahtarını saklar ve Standard Webhooks imza doğrulamasını açar. Kart yetkilendirmeleri Lithic'in 6 saniyelik penceresinde HAZE tarafından cevaplanır; clearing ve void olayları imzalı webhook olarak gelir. Lithic yoksa demo terminali aynı yetkilendirme akışını doğrudan yürütür; tam bir demo için bu yeterlidir.

---

## Testler

```bash
cargo test          # sözleşme testleri: HazeVault, gerçek sözleşme yetkisiyle HazeCredit'e karşı
pnpm test           # kredi hesabı, anchor parçalama, ASA / hold durum makinesi, sponsor izin listesi, uçtan uca API
pnpm typecheck
```

Sözleşme testleri yatırma, çekme, borç, geri ödeme, idempotent ve günlük limitli kart borcu, iade, maaş kapatma, dondurma, sağlık kontrolleri ve factory dağıtımını kapsar. TypeScript paketleri ek çerçeve olmadan Node'un yerleşik test koşucusuyla çalışır.

---

## API referansı

API, `8787` portunda çalışan bir Hono servisidir. İstek ve yanıt gövdelerindeki tüm tutarlar, `Float` son eki taşımadıkça 7 ondalıklı string'dir.

| Yöntem | Yol | Amaç |
|---|---|---|
| `GET` | `/health` | Canlılık, havuz modu, ihraççı durumu |
| `GET` | `/config` | İstemciler için açık ağ ve sözleşme yapılandırması |
| `POST` | `/onboard` · `/onboard/submit` | Sponsorlu hesap oluşturma ve kasa dağıtımı |
| `POST` | `/tx/sponsor` | İzin listesindeki bir kullanıcı işlemini fee-bump eder |
| `GET` | `/users/:id` · `/users/:id/holds` · `/users/:id/notifications` · `/users/:id/anchor-txs` | Kullanıcı durumu |
| `GET` | `/credit/:id` | Pozisyonlar, rezervler, fiyatlar, kart durumu ve kullanılabilir limit |
| `POST` | `/rules` · `/allowance` | Maaş kuralı ve USDC allowance kaydı |
| `POST` | `/anchor/token` | Kullanıcının SEP-10 JWT'sini saklar (passkey ile açılan anahtar istemcide imzalar) |
| `POST` | `/salary/start` · `/salary/settle` | SEP-38 + SEP-6 ile maaş girişi, ardından `settle_salary` |
| `POST` | `/cashout/start` · `GET /cashout/:userId/:id` | SEP-6 withdraw-exchange ile bankaya çekim |
| `POST` | `/card/create` · `/card/asa` · `/card/webhook` | Kart ihracı, yetkilendirme akışı, clearing / void |
| `POST` | `/terminal/charge` · `/terminal/clear` · `/terminal/void` | Demo POS giriş noktaları |
| `GET` | `/prices` · `POST /prices/tick` | Fiyat servisi durumu ve elle tik |
| `GET` | `/admin/users` · `/admin/holds` · `POST /admin/holds/:authId/retry` | Operasyon paneli |

---

## Demo senaryosu

| Sahne | Nerede | Zincirde |
|---|---|---|
| Passkey ile hesap oluştur | PWA | Sponsorlu hesap (0 XLM), `VaultFactory.create_vault`, SEP-10 |
| Maaş al | Profil → İşveren paneli | SEP-38 teklif, SEP-6 deposit-exchange, `settle_salary` |
| Birikimi dağıt | Kazan → Dağılım | Seçilen her varlık için bir `PathPaymentStrictReceive` + her biri için `vault.deposit` |
| Kafede öde (450 TL) | Terminal → Temassız öde | Zincir dışı ASA onayı, ardından `borrow_for_card_asset(hTRY, 450)` → takas hazinesi; borç lira cinsinden |
| Altından nakde çevir | Nakde çevir → Altından | `vault.withdraw(hXAU)`, SEP-6 withdraw-exchange, anchor'a path payment |
| Maaş günü | Profil → Maaş günü simülasyonu | `settle_salary` USDC borcunu kapatır, kalanı teminata; `settle_fx` lira borcunu kur masasıyla kapatır |

---

## Durum ve kapsam

- **Stellar testnet** üzerinde, kendi dağıttığımız **Blend v2** havuzuyla (blend-utils) çalışır; HazeCredit yedek olarak durur. Sözleşmeler denetlenmemiştir; gerçek fonlarla kullanılmamalıdır.
- **Rise In × Stellar Pro Hackathon 2026** (İstanbul, 19–20 Eylül) için geliştirilmiştir.
- Düzenleyici ve uyum konuları (kart ihraç lisansı, KYC, kredi mevzuatı) bu prototipte açıkça kapsam dışıdır.
- Anchor bir mock'tur (`tr-mock-anchor.fly.dev`). hUSDY getirisi hızlandırılmış zamanla fiyat artışı olarak simüle edilir; altın ve hisse fiyatları ayarlanabilir bir tabanın (`XAU_USD`, `NVDA_USD`, `SHEL_USD`, `BMW_USD`) etrafında rastgele yürür. Demoda bunlar böyle ifade edilir.

---

## Belgeler

- [docs/TECHNICAL.md](docs/TECHNICAL.md) — teknik belge (İngilizce): mimari, bileşenler, Stellar entegrasyonları, ödünleşimler, zorluklar
- [RUNBOOK.md](RUNBOOK.md) — adım adım testnet kurulumu, demo akışı ve sorun giderme
- [README.md](README.md) — bu belgenin İngilizcesi
- [docs/brand-kit/HAZE-SISTEM.md](docs/brand-kit/HAZE-SISTEM.md) — tasarım sistemi: renk, tipografi, logo ve yüzey kuralları
