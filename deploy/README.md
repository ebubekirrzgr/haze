# haze — dev.ivo.tc kurulumu

Canlı: https://haze.iyi.im · Dizin: `/emre/haze` · Kurulum: 2026-09-20

## Mimari

Tek origin. Tarayıcı yalnızca `haze.iyi.im` ile konuşur; `/api` ve `/terminal`
yollarını Next.js rewrite (`apps/web/next.config.ts`) iç ağdaki servislere taşır.

    haze.iyi.im  --cloudflared(haze tunnel)-->  127.0.0.1:3100  =  web (Next.js)
                                                                   |-- /api/*      -> api:8787
                                                                   `-- /terminal/* -> terminal:3001

Host'ta yalnızca **3100** portu tutulur (sadece 127.0.0.1). api ve terminal
konteynerleri dışarıya port açmaz — sunucudaki diğer projelerle çakışma yok.

| Servis   | Konteyner içi | Host           | Not |
|----------|---------------|----------------|-----|
| web      | 3000          | 127.0.0.1:3100 | Next.js 15, `NEXT_PUBLIC_API_URL=/api` |
| api      | 8787          | yok            | Hono, testnet + blend modu, SQLite `haze_data:/data/haze.db` |
| terminal | 3001          | yok            | statik POS; `?key=<API_ADMIN_KEY>` ile açılır |

Yollar: `/` PWA · `/landing` tanıtım sayfası + video · `/terminal` POS · `/api/*` haze-api.

## Medya

`deploy/media/` git'te değildir (video 25 MB); web konteynerine salt okunur bind mount ile
`public/media` olarak bağlanır. İçindekiler:

| Dosya | Kaynak |
|---|---|
| `haze-demo.mp4` | [Drive klasörü](https://drive.google.com/drive/folders/10G0qk8wOrFhubYFVYhYqToQjevrepL56) |
| `haze-demo-poster.jpg` | videonun 6. saniyesinden `ffmpeg` ile üretildi |

Sunucu değişirse ikisini de yeniden indirin; landing sayfası bu iki dosyayı bekler.

## Günlük işler

    cd /emre/haze/deploy
    docker compose ps
    docker compose logs -f api
    docker compose restart api
    docker compose up -d --build        # kod değişince

Tunnel: `systemctl status haze-tunnel` · config `/root/.cloudflared/haze.yml`
(tunnel adı `haze`, id `c3cbff4b-5613-4c40-8bd0-21bbf39a6b16`).

## Depodan farklı olan yerler

Bu kurulum için iki dosya değiştirildi (git'te "modified" görünür):

- `apps/web/next.config.ts` — `/api` ve `/terminal` rewrite kuralları eklendi.
  Hedefler `API_ORIGIN` / `TERMINAL_ORIGIN` env'inden okunur, ama Next bunları
  **build sırasında** `routes-manifest.json` dosyasına gömer; bu yüzden değerler
  `deploy/Dockerfile.web` içinde ENV olarak verilir, compose'da değil.
- `apps/terminal/index.html` — API alanının varsayılanı `/api` yapıldı.

`git pull` çakışırsa bu iki değişikliği yeniden uygulayın.

`deploy/api.env` gizli anahtarları taşır (chmod 600, `.git/info/exclude` içinde).

## Bilinmesi gerekenler

- **Lithic webhook'u eski adrese kayıtlı.** Verilen `.env` dosyasındaki
  PUBLIC_URL bir trycloudflare adresiydi; kalıcı adres artık
  `https://haze.iyi.im/api`. Kart ASA akışının çalışması için Lithic kaydı
  yenilenmeli:

      pnpm --filter @haze/scripts lithic https://haze.iyi.im/api

  (Lithic hesabında ASA webhook'unu ve olay aboneliğini günceller, yeni gizli
  anahtarları `services/api/.env` dosyasına yazar — sonra `deploy/api.env`
  içine taşıyıp api'yi yeniden başlatın.) Alternatif: `LITHIC_API_KEY` boş
  bırakılıp demo doğrudan `/terminal/charge` akışıyla yapılır.
- **Veritabanı sıfırdan başladı.** Demo kullanıcı PWA'daki "Demo hesabını içe
  aktar" ile kaydedildi (vault zincirde zaten vardı). Kartı yok; POS listesinde
  görünmesi için PWA > Kart ekranından kart oluşturun.
