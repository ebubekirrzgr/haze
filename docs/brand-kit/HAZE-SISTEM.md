# HAZE — Marka sistemi (birebir kullanım için)

Bu klasör HAZE tasarımını başka bir projede/sohbette birebir sürdürmek içindir.
Yeni sohbette bu klasörü yükle ve "HAZE sistemiyle devam edelim" de.

## 1. Renkler
| Ad | HEX | Kullanım |
|---|---|---|
| Altın | #C8A24A | Ana marka rengi: logo, vurgu, grafik çizgisi. Küçük metinde ASLA kullanılmaz. |
| Sepya | #3B3226 | Metin, koyu zemin, birincil buton |
| Kum | #EADFC8 | Kartlar, ikincil yüzeyler |
| Fildişi | #FBF8F1 | En açık yüzey |
| Krem | #F6F0E4 | Sayfa zemini |
| Şampanya | #F1E6CF | Vurgulu alanlar |
| Pudra | #EBD9CF | Sıcak vurgu, rozetler |
| Bronz | #8A6D2F | İkonlar, ince detay |
| İkincil metin | #6B5B45 | Açıklama, etiket |
| Zeytin | #5E7F4F | Getiri / kazanç |
| Kiremit | #B5523B | Uyarı / hata |

Kullanım oranı: zeminler %60, sepya %25, altın %10, işlev renkleri %5.
Kontrast: Sepya/Krem 11,1:1 · İkincil/Krem 5,8:1 · Altın/Sepya 5,2:1 · Altın/Krem 2,1:1 (metinde kullanma).

## 2. Tipografi
- **Michroma** — logo, başlık, büyük rakam. Tek ağırlık. 16px altında ve uzun metinde kullanılmaz; başlıklar en fazla 4-5 kelime.
- **Space Grotesk** 300/400/500 — arayüz, gövde, buton, etiket.
- **Cormorant Garamond** 500 (italik dahil) — yalnız pazarlama vurgusu; uygulama arayüzünde yok.
- Ölçek: Display Michroma 40 · Başlık 1 Michroma 28 · Bakiye Michroma 32 · Başlık 2 Space Grotesk 26/500 · Gövde 17/1.55 · Etiket 13/500/+0.16em büyük harf. Uygulama tabanı 17px, web 18px.
- Rakamlar her zaman `font-variant-numeric: tabular-nums`.
- Fontlar `fonts/` içinde (SIL OFL). CSS'te `css/haze.css` bunları bağlar.

## 3. Logo
- Yükselen H: orta çizgi sol alttan çeyrek daireyle yükselip yatay gider, sağ uçta yeniden çeyrek daireyle yukarı çıkar. Sol üst ve sağ alt gövdeler ayrıdır.
- Gövde kalınlığı Michroma'nın "I" harfinden, gövde konumları ve çizgi yüksekliği Michroma "H" harfinden ölçülür (`uretim/gen_r.py` → `measure_H`, `rising_H`).
- Güvenli alan: en az bir "A" yüksekliği. En küçük boy: 110px genişlik (baskıda 28mm); altında yalnız ikon.
- Yapılmaz: çizgiyi kısaltıp uzatmak, eğmek, gölge/gradyan eklemek, harfleri başka fontla değiştirmek.
- Hazır dosyalar: `logo/` (yazı logosu 5 renk + 4 zeminli, ikon 4 renk, monogram 2 renk).
- Açılış animasyonu: çizgi `stroke-dashoffset` ile soldan sağa çizilir (~2,2 sn), sonra gövdeler, en son harfler belirir. Döngü değil, bir kez oynayıp kalır.

## 4. Yüzey dili (cam)
Düz renk arka plan yok. Zemin: `#F3EBDC` (açık) / `#2E271F` (koyu) üzerine altın, pudra, şampanya lekeleri `filter: blur(70px)` + çok hafif gren.

```css
/* açık cam */
background: rgba(251,248,241,0.46);
backdrop-filter: blur(22px) saturate(140%);
border: 1px solid rgba(255,255,255,0.65);
box-shadow: 0 10px 36px rgba(59,50,38,0.08), inset 0 1px 0 rgba(255,255,255,0.7);
/* sıcak cam */ background: rgba(234,223,200,0.55);
/* koyu cam  */ background: rgba(59,50,38,0.86); backdrop-filter: blur(24px) saturate(130%);
```
Kural: cam ve bulanıklık yalnız zeminde ve kartlarda. Buton, rakam ve metin her zaman keskin ve opak.

## 5. Sayfa düzeni (rehber sayfaları)
- Sayfa 1440px geniş, 64/80px iç boşluk, bölümler arası 48px.
- Üst blok: küçük büyük harfli etiket ("HAZE · Marka rehberi · 0X") + Michroma 40px başlık; sağda 16px açıklama; altında 1px ayraç.
- İçerik 12 kolonluk grid, 32px boşluk.

## 6. Arayüz kuralları
- Ana butonlar 64–72px yüksek, başparmak bölgesinde. Çevir = sepya zemin, Harca = altın zemin.
- Kart köşeleri 16–20px, telefon ekranı 390×844.
- Getiri grafiği logodaki çizginin formunu taşır: düz seyir → çeyrek daire → yükseliş.
- Sahte veri kullanılan ekranlarda "DEMO MODU" rozeti (pudra zemin, kiremit yazı).

## 7. HAZE Gold kart
- Ölçü 85,60 × 53,98 mm (ISO/IEC 7810 ID-1), köşe 3,18 mm. Çizimde 428×270px (5px = 1mm), köşe 16px.
- Yüzey: fırçalanmış altın. `linear-gradient(160deg, #F1DDA2, #D8B563 22%, #BF9843 45%, #D6B366 62%, #B48C3A 82%, #9E782C)` + yatay gürültü (feTurbulence 0.002/0.95) + iki çapraz parlama + kenar kararması + iç pah.
- Yazılar gravür: `color: rgba(52,40,22,0.88); text-shadow: 0 1px 0 rgba(255,241,200,0.55), 0 -1px 0 rgba(60,40,10,0.15);`
- Ön yüz: sol üstte logo, sağ üstte "GOLD", çip + temassız simgesi, numara, kart sahibi ve son kullanma. Arka yüz: manyetik şerit, imza alanı, CVV, açıklama, HAZE ikonu.
- Her iki yüzün alt şeridinde **yalnız Stellar işareti** (yazı yok), ortalı, gravür. Vektör yolu `uretim/stellar_mark.json` içinde.
- Kod: `uretim/gen_card.py`.

## 8. Mockup sahneleri
`uretim/gen_mockup.py`: taş yüzeyde telefon + kılıftan çıkan kart, POS'a temassız ödeme, koyu deri zeminde yelpaze. CSS 3B (perspective + rotateX/rotateZ), her nesnenin altında bulanık gölge, kart kenarı `box-shadow: 0 3px 0 #8A6A28`.

## 9. Üretim dosyaları
`uretim/` içindeki betikler tüm sayfaları yeniden üretir. Sıra: `gen_r.py` (logo geometrisi) → `gen_guide.py` (01-05 sayfaları) → `gen_card.py` (06) → `gen_mockup.py` (07).
Gereken paketler: `fonttools`, `brotli`; fontlar için `@fontsource` woff2 dosyaları (bu klasörde `fonts/`).
Not: betikler font yollarını `fonts/node_modules/@fontsource/...` altında arar; yeni ortamda ya aynı yapıyı kur ya da `FS` değişkenini `fonts/` klasörüne çevir.

## 10. Hazır sayfalar
`index.html` (web sitesi), `uygulama.html` (mobil ekranlar), `rehber.html` (logo, renk, tipografi). Hepsi `css/haze.css` ve yerel fontları kullanır; internet olmadan açılır.

## Doldurulacak yer tutucular
[Ad Soyad] · [son 4] · [kart programı ortağı] · [destek hattı] · [İşletme adı] · [ÖRNEK DÖNEM] · [FARK %] · [YIL]
