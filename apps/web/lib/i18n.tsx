"use client";
/**
 * Dil desteği: TR, EN, PT (pt-BR), ES. Tarayıcı dilinden algılanır (bilinmeyen dil → EN); seçim localStorage'da (haze.lang) kalır.
 * Kullanım: const { t, lang } = useLang(); t("kart.baslik") · t("x.y", { n: 3 }) → "{n}" yerine 3.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ASSET_META, type AssetCode } from "@haze/stellar/browser";
import { setFormatLocale } from "./format.ts";

export type Lang = "tr" | "en" | "pt" | "es";
export const LANGS: Lang[] = ["tr", "en", "pt", "es"];
type Entry = Record<Lang, string>;

const STR = {
  // genel
  "nav.ana": { tr: "Ana sayfa", en: "Home", pt: "Início", es: "Inicio" },
  "nav.kazan": { tr: "Kazan", en: "Earn", pt: "Rendimento", es: "Rendimiento" },
  "nav.kart": { tr: "Kart", en: "Card", pt: "Cartão", es: "Tarjeta" },
  "nav.profil": { tr: "Profil", en: "Profile", pt: "Perfil", es: "Perfil" },
  "genel.geri": { tr: "← Geri", en: "← Back", pt: "← Voltar", es: "← Atrás" },
  "genel.demo": { tr: "DEMO MODU", en: "DEMO MODE", pt: "MODO DEMO", es: "MODO DEMO" },
  "genel.tamamlandi": { tr: "Tamamlandı", en: "Done", pt: "Concluído", es: "Listo" },
  "genel.islemBasarisiz": { tr: "İşlem başarısız", en: "Transaction failed", pt: "A transação falhou", es: "La transacción falló" },
  "genel.passkeyImzala": { tr: "Passkey ile imzala", en: "Sign with passkey", pt: "Assinar com passkey", es: "Firmar con passkey" },
  "genel.onceHesap": { tr: "Önce hesap oluştur.", en: "Create an account first.", pt: "Crie uma conta primeiro.", es: "Crea una cuenta primero." },
  "genel.dil": { tr: "Dil", en: "Language", pt: "Idioma", es: "Idioma" },
  "genel.degerKoruma": { tr: "değer koruma", en: "store of value", pt: "reserva de valor", es: "reserva de valor" },
  "genel.yillik": { tr: "yıllık", en: "APY", pt: "ao ano", es: "anual" },
  "genel.ay": { tr: "ay", en: "mo", pt: "mês", es: "mes" },
  // onboarding
  "on.slogan": { tr: "Arkada akış, önde sakinlik.", en: "Flow behind, calm in front.", pt: "Fluxo por trás, calma na frente.", es: "Flujo detrás, calma delante." },
  "on.baslik1": { tr: "Birikimin satılmaz,", en: "Your savings stay invested,", pt: "Sua poupança continua investida,", es: "Tus ahorros siguen invertidos," },
  "on.baslik2": { tr: "kartın harcar.", en: "your card spends.", pt: "seu cartão gasta.", es: "tu tarjeta gasta." },
  "on.aciklama": { tr: "Maaşın USDC, tokenize bono, altın ve hisse olarak getiri üretir; kartla harcadığında teminatına karşı borç açılır, maaş günü kendiliğinden kapanır.", en: "Your salary earns as USDC, tokenized treasuries, gold and stocks; card purchases borrow against that collateral and are repaid automatically on payday.", pt: "Seu salário rende como USDC, títulos do tesouro, ouro e ações tokenizados; as compras no cartão tomam emprestado contra essa garantia e são quitadas automaticamente no dia do pagamento.", es: "Tu salario rinde como USDC, bonos del tesoro, oro y acciones tokenizados; las compras con tarjeta se prestan contra esa garantía y se liquidan automáticamente el día de pago." },
  "on.m1": { tr: "Satmadan harca: teminat yerinde kalır", en: "Spend without selling: collateral stays put", pt: "Gaste sem vender: a garantia fica onde está", es: "Gasta sin vender: la garantía se queda donde está" },
  "on.m2": { tr: "Getiri harcarken de işler", en: "Yield keeps accruing while you spend", pt: "O rendimento continua enquanto você gasta", es: "El rendimiento sigue mientras gastas" },
  "on.m3": { tr: "Cüzdanında XLM tutman gerekmez", en: "No XLM needed in your wallet", pt: "Não precisa de XLM na carteira", es: "No necesitas XLM en tu billetera" },
  "on.apiYok": { tr: "haze-api'ye ulaşılamıyor. `pnpm dev:api` çalışıyor mu?", en: "Cannot reach haze-api. Is `pnpm dev:api` running?", pt: "Não foi possível acessar o haze-api. O `pnpm dev:api` está rodando?", es: "No se puede acceder a haze-api. ¿Está corriendo `pnpm dev:api`?" },
  "on.gizliAnahtar": { tr: "Demo hesabı gizli anahtarı (S…)", en: "Demo account secret key (S…)", pt: "Chave secreta da conta demo (S…)", es: "Clave secreta de la cuenta demo (S…)" },
  "on.iceAktar": { tr: "İçe aktar", en: "Import", pt: "Importar", es: "Importar" },
  "on.vazgec": { tr: "Vazgeç", en: "Cancel", pt: "Cancelar", es: "Cancelar" },
  "on.passkeyOlustur": { tr: "Passkey ile hesap oluştur", en: "Create account with passkey", pt: "Criar conta com passkey", es: "Crear cuenta con passkey" },
  "on.demoIceAktar": { tr: "Demo hesabını içe aktar", en: "Import demo account", pt: "Importar conta demo", es: "Importar cuenta demo" },
  "on.stellar": { tr: "Stellar üzerinde çalışır", en: "Runs on Stellar", pt: "Roda na Stellar", es: "Funciona en Stellar" },
  "adim.sponsorlu": { tr: "Sponsorlu hesap açılıyor", en: "Opening sponsored account", pt: "Abrindo conta patrocinada", es: "Abriendo cuenta patrocinada" },
  "adim.vault": { tr: "Kasa (vault) kuruluyor", en: "Deploying vault", pt: "Implantando o cofre", es: "Desplegando la bóveda" },
  "adim.sep10": { tr: "Anchor kimliği (SEP-10)", en: "Anchor login (SEP-10)", pt: "Login no anchor (SEP-10)", es: "Inicio de sesión en el anchor (SEP-10)" },
  "adim.kart": { tr: "Kart oluşturuluyor", en: "Issuing card", pt: "Emitindo cartão", es: "Emitiendo tarjeta" },
  "adim.passkey": { tr: "Passkey kaydı", en: "Registering passkey", pt: "Registrando passkey", es: "Registrando passkey" },
  "adim.hesapKontrol": { tr: "Hesap kontrol ediliyor", en: "Checking account", pt: "Verificando conta", es: "Comprobando cuenta" },
  // ana sayfa
  "ana.toplam": { tr: "Kazan · toplam değer", en: "Earn · total value", pt: "Rendimento · valor total", es: "Rendimiento · valor total" },
  "ana.buOturum": { tr: "bu oturumda", en: "this session", pt: "nesta sessão", es: "en esta sesión" },
  "ana.limit": { tr: "Harcama limiti", en: "Spending limit", pt: "Limite de gastos", es: "Límite de gasto" },
  "ana.acikBorc": { tr: "Açık borç", en: "Open debt", pt: "Dívida em aberto", es: "Deuda abierta" },
  "ana.saglik": { tr: "Sağlık faktörü {hf} · hedef {hedef}", en: "Health factor {hf} · target {hedef}", pt: "Fator de saúde {hf} · meta {hedef}", es: "Factor de salud {hf} · objetivo {hedef}" },
  "ana.satilmadi": { tr: "Teminat satılmadı", en: "Nothing sold", pt: "Nada foi vendido", es: "Nada vendido" },
  "ana.kazanaEkle": { tr: "Kazan'a ekle", en: "Add to Earn", pt: "Adicionar", es: "Añadir" },
  "ana.nakdeCevir": { tr: "Nakde çevir", en: "Cash out", pt: "Sacar", es: "Retirar" },
  "ana.getiri": { tr: "Getiri", en: "Yield", pt: "Rendimento", es: "Rendimiento" },
  "ana.sonIslemler": { tr: "Son işlemler", en: "Recent activity", pt: "Atividade recente", es: "Actividad reciente" },
  "ana.tumu": { tr: "Tümü", en: "All", pt: "Tudo", es: "Todo" },
  "ana.islemYok": { tr: "Henüz işlem yok.", en: "No activity yet.", pt: "Nenhuma atividade ainda.", es: "Aún no hay actividad." },
  "ana.maas": { tr: "Maaş", en: "Salary", pt: "Salário", es: "Salario" },
  "ana.kartSatir": { tr: "Kart", en: "Card", pt: "Cartão", es: "Tarjeta" },
  // kazan
  "kazan.baslik": { tr: "Kazan", en: "Earn", pt: "Rendimento", es: "Rendimiento" },
  "kazan.teminat": { tr: "Teminat · getiri üretiyor", en: "Collateral · earning", pt: "Garantia · rendendo", es: "Garantía · rindiendo" },
  "kazan.demoZaman": { tr: "demo: 1 dk = {n} gün", en: "demo: 1 min = {n} days", pt: "demo: 1 min = {n} dias", es: "demo: 1 min = {n} días" },
  "kazan.tabEkle": { tr: "Kazan'a ekle", en: "Add", pt: "Adicionar", es: "Añadir" },
  "kazan.tabDagit": { tr: "Dağılım", en: "Allocate", pt: "Alocar", es: "Asignar" },
  "kazan.tabCek": { tr: "Çek", en: "Withdraw", pt: "Sacar", es: "Retirar" },
  "kazan.cuzdanUsdc": { tr: "Cüzdan USDC", en: "Wallet USDC", pt: "USDC na carteira", es: "USDC en la billetera" },
  "kazan.ekleNot": { tr: "1 Soroban işlemi: USDC vault'a geçer ve SupplyCollateral ile teminat olur. Ağ ücretini HAZE karşılar.", en: "One Soroban transaction: USDC moves to your vault and becomes collateral via SupplyCollateral. HAZE pays the network fee.", pt: "Uma transação Soroban: o USDC vai para o seu cofre e vira garantia via SupplyCollateral. A HAZE paga a taxa de rede.", es: "Una transacción Soroban: el USDC pasa a tu bóveda y se convierte en garantía vía SupplyCollateral. HAZE paga la comisión de red." },
  "kazan.ekleBtn": { tr: "Kazan'a ekle", en: "Add to Earn", pt: "Adicionar ao Rendimento", es: "Añadir a Rendimiento" },
  "kazan.dagitBaslik": { tr: "Cüzdandaki USDC'yi dağıt", en: "Allocate wallet USDC", pt: "Alocar o USDC da carteira", es: "Asignar el USDC de la billetera" },
  "kazan.dagitNot": { tr: "Tek passkey onayı: payı olan her RWA için bir PathPaymentStrictReceive (DEX/AMM) + deposit; sponsor hepsine fee-bump uygular.", en: "One passkey approval: a PathPaymentStrictReceive (DEX/AMM) plus a deposit for every asset with a share; the sponsor fee-bumps them all.", pt: "Uma aprovação com passkey: um PathPaymentStrictReceive (DEX/AMM) mais um depósito para cada ativo com participação; o patrocinador paga as taxas de todos.", es: "Una aprobación con passkey: un PathPaymentStrictReceive (DEX/AMM) más un depósito por cada activo con participación; el patrocinador cubre las comisiones de todos." },
  "kazan.dagitBtn": { tr: "Dağılımı uygula", en: "Apply allocation", pt: "Aplicar alocação", es: "Aplicar asignación" },
  "kazan.cekNot": { tr: "WithdrawCollateral → cüzdanına gelir. Havuz, sağlık faktörü bozulursa işlemi reddeder.", en: "WithdrawCollateral → sent to your wallet. The pool rejects it if the health factor would break.", pt: "WithdrawCollateral → vai para a sua carteira. O pool recusa se o fator de saúde ficar comprometido.", es: "WithdrawCollateral → llega a tu billetera. El pool lo rechaza si el factor de salud se rompe." },
  "kazan.cekBtn": { tr: "Kazan'dan çek", en: "Withdraw from Earn", pt: "Sacar do Rendimento", es: "Retirar de Rendimiento" },
  "kazan.adimDeposit": { tr: "vault.deposit (USDC → teminat)", en: "vault.deposit (USDC → collateral)", pt: "vault.deposit (USDC → garantia)", es: "vault.deposit (USDC → garantía)" },
  "kazan.adimWithdraw": { tr: "vault.withdraw ({code} → cüzdan)", en: "vault.withdraw ({code} → wallet)", pt: "vault.withdraw ({code} → carteira)", es: "vault.withdraw ({code} → billetera)" },
  // kart
  "kart.baslik": { tr: "Kart", en: "Card", pt: "Cartão", es: "Tarjeta" },
  "kart.hazir": { tr: "Kart hazır", en: "Card ready", pt: "Cartão pronto", es: "Tarjeta lista" },
  "kart.demoKart": { tr: "Demo kart (Lithic sandbox bağlı değil)", en: "Demo card (Lithic sandbox not connected)", pt: "Cartão demo (sandbox Lithic não conectado)", es: "Tarjeta demo (sandbox de Lithic no conectado)" },
  "kart.lithicKart": { tr: "Lithic sandbox sanal Visa", en: "Lithic sandbox virtual Visa", pt: "Visa virtual do sandbox Lithic", es: "Visa virtual del sandbox de Lithic" },
  "kart.olusturulamadi": { tr: "Kart oluşturulamadı", en: "Could not issue card", pt: "Não foi possível emitir o cartão", es: "No se pudo emitir la tarjeta" },
  "kart.acildi": { tr: "Kart açıldı", en: "Card unfrozen", pt: "Cartão desbloqueado", es: "Tarjeta desbloqueada" },
  "kart.donduruldu": { tr: "Kart donduruldu", en: "Card frozen", pt: "Cartão congelado", es: "Tarjeta congelada" },
  "kart.limitGuncel": { tr: "Günlük limit güncellendi", en: "Daily limit updated", pt: "Limite diário atualizado", es: "Límite diario actualizado" },
  "kart.adSoyad": { tr: "[AD SOYAD]", en: "[CARDHOLDER]", pt: "[TITULAR]", es: "[TITULAR]" },
  "kart.olustur": { tr: "Kart oluştur", en: "Issue card", pt: "Emitir cartão", es: "Emitir tarjeta" },
  "kart.numaraGizle": { tr: "Numarayı gizle", en: "Hide number", pt: "Ocultar número", es: "Ocultar número" },
  "kart.numaraGoster": { tr: "Numarayı göster", en: "Show number", pt: "Mostrar número", es: "Mostrar número" },
  "kart.kullanilabilir": { tr: "Kullanılabilir limit", en: "Available limit", pt: "Limite disponível", es: "Límite disponible" },
  "kart.bugun": { tr: "Bugün", en: "Today", pt: "Hoje", es: "Hoy" },
  "kart.not": { tr: "Onay off-chain limit hesabıyla saniyenin altında verilir; Blend borcu hemen ardından açılır. Türkiye'deki POS'ta TL çekilir, USD borçlanılır.", en: "Authorization is decided off-chain in under a second from the credit limit; the Blend borrow follows right after. A POS in Türkiye charges TRY, the debt is in USD.", pt: "A autorização é decidida off-chain em menos de um segundo a partir do limite de crédito; o empréstimo no Blend vem logo depois. Um POS na Turquia cobra em TRY, a dívida fica em USD.", es: "La autorización se decide off-chain en menos de un segundo a partir del límite de crédito; el préstamo en Blend viene justo después. Un POS en Turquía cobra en TRY, la deuda queda en USD." },
  "kart.ac": { tr: "Kartı aç (set_frozen false)", en: "Unfreeze card (set_frozen false)", pt: "Desbloquear cartão (set_frozen false)", es: "Desbloquear tarjeta (set_frozen false)" },
  "kart.dondur": { tr: "Kartı dondur (set_frozen)", en: "Freeze card (set_frozen)", pt: "Congelar cartão (set_frozen)", es: "Congelar tarjeta (set_frozen)" },
  "kart.gunlukLimit": { tr: "Günlük limit · {n} USDC", en: "Daily limit · {n} USDC", pt: "Limite diário · {n} USDC", es: "Límite diario · {n} USDC" },
  "kart.ayarla": { tr: "Ayarla", en: "Set", pt: "Definir", es: "Fijar" },
  "kart.sonHarcamalar": { tr: "Son harcamalar", en: "Recent purchases", pt: "Compras recentes", es: "Compras recientes" },
  "kart.harcamaYok": { tr: "Henüz kart harcaması yok. haze-terminal'den bir ödeme dene.", en: "No card purchases yet. Try a payment from haze-terminal.", pt: "Nenhuma compra no cartão ainda. Tente um pagamento no haze-terminal.", es: "Aún no hay compras con tarjeta. Prueba un pago desde haze-terminal." },
  "kart.borcIslemi": { tr: "borç işlemi ↗", en: "borrow tx ↗", pt: "tx de empréstimo ↗", es: "tx de préstamo ↗" },
  // nakit
  "nakit.baslik": { tr: "Nakde çevir", en: "Cash out", pt: "Sacar", es: "Retirar" },
  "nakit.slogan": { tr: "TL'ye, satmadan ya da satarak.", en: "To TRY, with or without selling.", pt: "Para TRY, vendendo ou não.", es: "A TRY, vendiendo o sin vender." },
  "nakit.aciklama": { tr: "Tek ekran: tutar, kaynak, kayıtlı IBAN. Anchor işlem limiti aşılırsa tutar parçalanır.", en: "One screen: amount, source, saved IBAN. Amounts above the anchor limit are split.", pt: "Uma tela: valor, origem, IBAN salvo. Valores acima do limite do anchor são divididos.", es: "Una pantalla: importe, origen, IBAN guardado. Los importes por encima del límite del anchor se dividen." },
  "nakit.tutar": { tr: "Tutar", en: "Amount", pt: "Valor", es: "Importe" },
  "nakit.kur": { tr: "Kur (SEP-38)", en: "Rate (SEP-38)", pt: "Câmbio (SEP-38)", es: "Tipo de cambio (SEP-38)" },
  "nakit.gerekliUsdc": { tr: "Gerekli USDC", en: "USDC needed", pt: "USDC necessário", es: "USDC necesario" },
  "nakit.kaynak": { tr: "Kaynak", en: "Source", pt: "Origem", es: "Origen" },
  "nakit.borcla": { tr: "Satmadan · borçla", en: "Without selling · borrow", pt: "Sem vender · emprestar", es: "Sin vender · pedir prestado" },
  "nakit.kaynakEtiket": { tr: "{ad}'dan ({code})", en: "From {ad} ({code})", pt: "De {ad} ({code})", es: "Desde {ad} ({code})" },
  "nakit.borcNot": { tr: "Teminata dokunulmaz; vault USDC borç açar ve hesabına gönderir. Kullanılabilir limit", en: "Collateral is untouched; the vault borrows USDC and sends it to your account. Available limit", pt: "A garantia não é tocada; o cofre toma USDC emprestado e envia para a sua conta. Limite disponível", es: "La garantía no se toca; la bóveda toma USDC prestado y lo envía a tu cuenta. Límite disponible" },
  "nakit.teminatta": { tr: "Teminatta", en: "In collateral", pt: "Em garantia", es: "En garantía" },
  "nakit.gerekli": { tr: "Gerekli", en: "Needed", pt: "Necessário", es: "Necesario" },
  "nakit.dexNot": { tr: "Aynı {code} tokenı DEX'te tek atomik işlemle tam USDC'ye dönüşür; anchor TL gönderir.", en: "The same {code} token converts to exact USDC in one atomic DEX transaction; the anchor sends TRY.", pt: "O mesmo token {code} é convertido em USDC exato numa única transação atômica na DEX; o anchor envia TRY.", es: "El mismo token {code} se convierte en USDC exacto en una sola transacción atómica en la DEX; el anchor envía TRY." },
  "nakit.hedef": { tr: "Hedef", en: "Destination", pt: "Destino", es: "Destino" },
  "nakit.iban": { tr: "Kayıtlı IBAN · TR•• •••• 4821 (simüle)", en: "Saved IBAN · TR•• •••• 4821 (simulated)", pt: "IBAN salvo · TR•• •••• 4821 (simulado)", es: "IBAN guardado · TR•• •••• 4821 (simulado)" },
  "nakit.cekBtn": { tr: "{tutar} çek", en: "Cash out {tutar}", pt: "Sacar {tutar}", es: "Retirar {tutar}" },
  "nakit.cevrildi": { tr: "Nakde çevrildi", en: "Cashed out", pt: "Saque concluído", es: "Retiro realizado" },
  "nakit.ibanSimule": { tr: "{tutar} → kayıtlı IBAN (simüle)", en: "{tutar} → saved IBAN (simulated)", pt: "{tutar} → IBAN salvo (simulado)", es: "{tutar} → IBAN guardado (simulado)" },
  "nakit.adimTeklif": { tr: "SEP-38 teklif + SEP-6 withdraw", en: "SEP-38 quote + SEP-6 withdraw", pt: "Cotação SEP-38 + saque SEP-6", es: "Cotización SEP-38 + retiro SEP-6" },
  "nakit.adimOdeme": { tr: "USDC ödemesi", en: "USDC payment", pt: "Pagamento em USDC", es: "Pago en USDC" },
  "nakit.adimAnchor": { tr: "Anchor TL gönderdi", en: "Anchor sent TRY", pt: "O anchor enviou TRY", es: "El anchor envió TRY" },
  // profil
  "profil.baslik": { tr: "Profil", en: "Profile", pt: "Perfil", es: "Perfil" },
  "profil.hesap": { tr: "Hesap", en: "Account", pt: "Conta", es: "Cuenta" },
  "profil.gHesabi": { tr: "G-hesabı", en: "G-account", pt: "Conta G", es: "Cuenta G" },
  "profil.kilit": { tr: "Kilit", en: "Key storage", pt: "Guarda da chave", es: "Custodia de la clave" },
  "profil.passkeyPrf": { tr: "Passkey (PRF) ile şifreli", en: "Encrypted with passkey (PRF)", pt: "Criptografada com passkey (PRF)", es: "Cifrada con passkey (PRF)" },
  "profil.duz": { tr: "Düz saklama · demo", en: "Plain storage · demo", pt: "Armazenamento simples · demo", es: "Almacenamiento simple · demo" },
  "profil.havuz": { tr: "Havuz", en: "Pool", pt: "Pool", es: "Pool" },
  "profil.blend": { tr: "Blend v2 (kendi dağıtımımız)", en: "Blend v2 (self-hosted)", pt: "Blend v2 (implantação própria)", es: "Blend v2 (despliegue propio)" },
  "profil.hazecredit": { tr: "HazeCredit (yedek)", en: "HazeCredit (fallback)", pt: "HazeCredit (reserva)", es: "HazeCredit (respaldo)" },
  "profil.xlm": { tr: "XLM bakiyesi", en: "XLM balance", pt: "Saldo em XLM", es: "Saldo en XLM" },
  "profil.sponsorlu": { tr: "0 · sponsorlu", en: "0 · sponsored", pt: "0 · patrocinado", es: "0 · patrocinado" },
  "profil.maasKurali": { tr: "Maaş kuralı", en: "Salary rule", pt: "Regra do salário", es: "Regla del salario" },
  "profil.maasNot": { tr: "Maaş USDC olarak gelince borç kapanır, kalan Kazan'a eklenir; RWA dağılımını (bono, altın, hisse) tek passkey onayıyla uygularsın.", en: "When salary arrives as USDC the debt is repaid and the rest goes to Earn; you apply the RWA allocation (treasuries, gold, stocks) with one passkey approval.", pt: "Quando o salário chega em USDC, a dívida é quitada e o restante vai para Rendimento; você aplica a alocação em RWA (títulos, ouro, ações) com uma aprovação de passkey.", es: "Cuando el salario llega en USDC, se liquida la deuda y el resto va a Rendimiento; aplicas la asignación en RWA (bonos, oro, acciones) con una aprobación de passkey." },
  "profil.izin": { tr: "Vault USDC izni", en: "Vault USDC allowance", pt: "Permissão de USDC do cofre", es: "Permiso de USDC de la bóveda" },
  "profil.dagilim": { tr: "Dağılım", en: "Allocation", pt: "Alocação", es: "Asignación" },
  "profil.izniYenile": { tr: "İzni yenile", en: "Renew allowance", pt: "Renovar permissão", es: "Renovar permiso" },
  "profil.anchorBagli": { tr: "Anchor: bağlı", en: "Anchor: connected", pt: "Anchor: conectado", es: "Anchor: conectado" },
  "profil.anchorBaglan": { tr: "Anchor'a bağlan", en: "Connect anchor", pt: "Conectar ao anchor", es: "Conectar al anchor" },
  "profil.isveren": { tr: "İşveren paneli · demo", en: "Employer panel · demo", pt: "Painel do empregador · demo", es: "Panel del empleador · demo" },
  "profil.isverenNot": { tr: "SEP-38 teklif → SEP-6 deposit-exchange → simulate-bank-transfer → testnet USDC → settle_salary.", en: "SEP-38 quote → SEP-6 deposit-exchange → simulate-bank-transfer → testnet USDC → settle_salary.", pt: "Cotação SEP-38 → SEP-6 deposit-exchange → simulate-bank-transfer → USDC testnet → settle_salary.", es: "Cotización SEP-38 → SEP-6 deposit-exchange → simulate-bank-transfer → USDC testnet → settle_salary." },
  "profil.maasYatir": { tr: "₺ Maaş yatır", en: "₺ Pay salary", pt: "₺ Pagar salário", es: "₺ Pagar salario" },
  "profil.maasGunu": { tr: "Maaş günü simülasyonu (settle_salary)", en: "Simulate payday (settle_salary)", pt: "Simular dia do pagamento (settle_salary)", es: "Simular día de pago (settle_salary)" },
  "profil.seffaflik": { tr: "Şeffaflık", en: "Transparency", pt: "Transparência", es: "Transparencia" },
  "profil.seffaflikNot": { tr: "Mock olanlar: TR Mock Anchor (testnet USDC gerçek), hUSDY/hXAU/hNVDA/hSHEL/hBMW/hTRY (biz bastık; mainnet karşılıkları Ondo USDY, Matrixdock XAUm, tokenize hisseler), Lithic sandbox kart, hızlandırılmış getiri ({n} gün/dk). Hukuki uyum kapsam dışı.", en: "What is mocked: TR Mock Anchor (testnet USDC is real), hUSDY/hXAU/hNVDA/hSHEL/hBMW/hTRY (issued by us; mainnet counterparts Ondo USDY, Matrixdock XAUm, tokenized stocks), Lithic sandbox card, accelerated yield ({n} days/min). Regulatory compliance is out of scope.", pt: "O que é simulado: TR Mock Anchor (o USDC testnet é real), hUSDY/hXAU/hNVDA/hSHEL/hBMW/hTRY (emitidos por nós; equivalentes em mainnet Ondo USDY, Matrixdock XAUm, ações tokenizadas), cartão sandbox Lithic, rendimento acelerado ({n} dias/min). Conformidade regulatória fora do escopo.", es: "Lo simulado: TR Mock Anchor (el USDC testnet es real), hUSDY/hXAU/hNVDA/hSHEL/hBMW/hTRY (emitidos por nosotros; equivalentes en mainnet Ondo USDY, Matrixdock XAUm, acciones tokenizadas), tarjeta sandbox Lithic, rendimiento acelerado ({n} días/min). El cumplimiento regulatorio queda fuera del alcance." },
  "profil.cikis": { tr: "Çıkış yap (cüzdanı bu cihazdan sil)", en: "Sign out (remove wallet from this device)", pt: "Sair (remover a carteira deste dispositivo)", es: "Cerrar sesión (eliminar la billetera de este dispositivo)" },
  "profil.kuralYetki": { tr: "Maaş kuralı yetkilendirildi", en: "Salary rule authorized", pt: "Regra do salário autorizada", es: "Regla del salario autorizada" },
  "profil.yetkiYok": { tr: "Yetki verilemedi", en: "Authorization failed", pt: "Falha na autorização", es: "Autorización fallida" },
  "profil.sep10Yenilendi": { tr: "Anchor kimliği yenilendi (SEP-10)", en: "Anchor login renewed (SEP-10)", pt: "Login no anchor renovado (SEP-10)", es: "Inicio de sesión en el anchor renovado (SEP-10)" },
  "profil.sep10Basarisiz": { tr: "SEP-10 başarısız", en: "SEP-10 failed", pt: "SEP-10 falhou", es: "SEP-10 falló" },
  "profil.logGonder": { tr: "İşveren paneli: TRY maaş gönderiliyor…", en: "Employer panel: sending TRY salary…", pt: "Painel do empregador: enviando salário em TRY…", es: "Panel del empleador: enviando salario en TRY…" },
  "profil.logAnchor": { tr: "Anchor: {n} parça tamamlandı", en: "Anchor: {n} part(s) completed", pt: "Anchor: {n} parte(s) concluída(s)", es: "Anchor: {n} parte(s) completada(s)" },
  "profil.logKural": { tr: "Kural motoru", en: "Rule engine", pt: "Motor de regras", es: "Motor de reglas" },
  "profil.logHata": { tr: "Hata", en: "Error", pt: "Erro", es: "Error" },
  "profil.borcKapandi": { tr: "Maaş günü: borç kapatıldı", en: "Payday: debt repaid", pt: "Dia do pagamento: dívida quitada", es: "Día de pago: deuda liquidada" },
  "profil.kapatilamadi": { tr: "Kapatılamadı", en: "Could not settle", pt: "Não foi possível liquidar", es: "No se pudo liquidar" },
  // hold durumları
  "hold.PENDING": { tr: "onaylandı", en: "approved", pt: "aprovado", es: "aprobado" },
  "hold.BORROWED": { tr: "borç açıldı", en: "borrowed", pt: "emprestado", es: "prestado" },
  "hold.CLEARED": { tr: "kapandı", en: "cleared", pt: "liquidado", es: "liquidado" },
  "hold.REFUNDED": { tr: "iade", en: "refunded", pt: "estornado", es: "reembolsado" },
  "hold.FAILED": { tr: "hata", en: "failed", pt: "falhou", es: "fallido" },
  "hold.DECLINED": { tr: "reddedildi", en: "declined", pt: "recusado", es: "rechazado" },
  // zaman
  "zaman.azOnce": { tr: "az önce", en: "just now", pt: "agora mesmo", es: "justo ahora" },
  "zaman.dk": { tr: "{n} dk önce", en: "{n} min ago", pt: "há {n} min", es: "hace {n} min" },
  "zaman.sa": { tr: "{n} sa önce", en: "{n} h ago", pt: "há {n} h", es: "hace {n} h" },
  // varlık açıklamaları
  "varlik.stable": { tr: "Blend supply faizi", en: "Blend supply interest", pt: "Juros de supply no Blend", es: "Interés de supply en Blend" },
  "varlik.treasury": { tr: "Tokenize hazine bonosu · fiyat artar", en: "Tokenized treasuries · price accrues", pt: "Títulos do tesouro tokenizados · o preço acumula", es: "Bonos del tesoro tokenizados · el precio acumula" },
  "varlik.gold": { tr: "Tokenize altın · değer koruma", en: "Tokenized gold · store of value", pt: "Ouro tokenizado · reserva de valor", es: "Oro tokenizado · reserva de valor" },
  "varlik.stock": { tr: "Tokenize hisse · {ad}", en: "Tokenized stock · {ad}", pt: "Ação tokenizada · {ad}", es: "Acción tokenizada · {ad}" },
  "varlik.fiat": { tr: "Fiat token · yalnız borç", en: "Fiat token · borrow only", pt: "Token fiat · somente empréstimo", es: "Token fiat · solo préstamo" },
  "kazan.tabBorc": { tr: "Borç al", en: "Borrow", pt: "Emprestar", es: "Pedir prestado" },
  "kazan.borcBaslik": { tr: "Teminata karşı borç al", en: "Borrow against collateral", pt: "Tomar emprestado contra a garantia", es: "Pedir prestado contra la garantía" },
  "kazan.borcNot": { tr: "Teminatın yerinde kalır; seçtiğin para biriminde borç cüzdanına gelir. Kullanılabilir limit {limit} (USD). Kur riski borçludan havuza geçer: lira değer kaybederse borcun dolar karşılığı küçülür.", en: "Your collateral stays put; the loan arrives in your wallet in the currency you choose. Available limit {limit} (USD). FX risk shifts from you to the pool: if the lira weakens, your debt shrinks in dollar terms.", pt: "Sua garantia fica onde está; o empréstimo chega na sua carteira na moeda escolhida. Limite disponível {limit} (USD). O risco cambial passa de você para o pool: se a lira cair, sua dívida diminui em dólares.", es: "Tu garantía se queda donde está; el préstamo llega a tu billetera en la moneda que elijas. Límite disponible {limit} (USD). El riesgo cambiario pasa de ti al pool: si la lira cae, tu deuda se reduce en dólares." },
  "kazan.borcBtn": { tr: "{code} borç al", en: "Borrow {code}", pt: "Emprestar {code}", es: "Pedir {code} prestado" },
  "kazan.odeBtn": { tr: "{code} borcunu öde", en: "Repay {code}", pt: "Quitar {code}", es: "Pagar {code}" },
  "kazan.borclar": { tr: "Açık borçlar", en: "Open debts", pt: "Dívidas em aberto", es: "Deudas abiertas" },
  "kazan.borcYok": { tr: "Açık borç yok.", en: "No open debt.", pt: "Nenhuma dívida em aberto.", es: "Sin deudas abiertas." },
  "kazan.cuzdan": { tr: "Cüzdan", en: "Wallet", pt: "Carteira", es: "Billetera" },
  "kazan.adimBorrow": { tr: "vault.borrow_asset ({code} → cüzdan)", en: "vault.borrow_asset ({code} → wallet)", pt: "vault.borrow_asset ({code} → carteira)", es: "vault.borrow_asset ({code} → billetera)" },
  "kazan.adimRepay": { tr: "vault.repay_asset ({code})", en: "vault.repay_asset ({code})", pt: "vault.repay_asset ({code})", es: "vault.repay_asset ({code})" },
  // sunucu bildirimleri (kind → başlık; gövde data'dan)
  "bildirim.salary_received": { tr: "Maaş hesabına geçti", en: "Salary received", pt: "Salário recebido", es: "Salario recibido" },
  "bildirim.salary_settled": { tr: "Maaş geldi", en: "Salary settled", pt: "Salário liquidado", es: "Salario liquidado" },
  "bildirim.salary_settled.body": { tr: "{repaid} USDC borç kapandı, {added} USDC Kazan'a eklendi. RWA dağılımını onayla.", en: "{repaid} USDC debt repaid, {added} USDC added to Earn. Approve your RWA allocation.", pt: "{repaid} USDC de dívida quitados, {added} USDC adicionados ao Rendimento. Aprove sua alocação em RWA.", es: "{repaid} USDC de deuda liquidados, {added} USDC añadidos a Rendimiento. Aprueba tu asignación en RWA." },
  "bildirim.salary_settled.bodyNoDebt": { tr: "{added} USDC Kazan'a eklendi. RWA dağılımını onayla.", en: "{added} USDC added to Earn. Approve your RWA allocation.", pt: "{added} USDC adicionados ao Rendimento. Aprove sua alocação em RWA.", es: "{added} USDC añadidos a Rendimiento. Aprueba tu asignación en RWA." },
  "bildirim.card_approved": { tr: "Kart onaylandı", en: "Card approved", pt: "Cartão aprovado", es: "Tarjeta aprobada" },
  "bildirim.card_approved.body": { tr: "{usdc} USDC borç · kalan limit {limit} USDC", en: "{usdc} USDC borrowed · {limit} USDC limit left", pt: "{usdc} USDC emprestados · {limit} USDC de limite restante", es: "{usdc} USDC prestados · {limit} USDC de límite restante" },
  "bildirim.card_declined": { tr: "Kart reddedildi", en: "Card declined", pt: "Cartão recusado", es: "Tarjeta rechazada" },
  "bildirim.card_refunded": { tr: "İade", en: "Refund", pt: "Estorno", es: "Reembolso" },
  "bildirim.hold_failed": { tr: "Borç işlemi başarısız", en: "Borrow transaction failed", pt: "A transação de empréstimo falhou", es: "La transacción de préstamo falló" },
  "bildirim.allowance_renew": { tr: "Maaş izni yenilenmeli", en: "Salary allowance needs renewal", pt: "A permissão do salário precisa ser renovada", es: "El permiso del salario debe renovarse" },
} satisfies Record<string, Entry>;

export type Key = keyof typeof STR;
const NAMES: Record<Exclude<Lang, "tr">, Record<AssetCode, string>> = {
  en: { USDC: "USD Coin", hUSDY: "Treasuries", hXAU: "Gold", hNVDA: "NVIDIA", hSHEL: "Shell", hBMW: "BMW", hTRY: "Turkish lira", hEUR: "Euro", hGBP: "British pound", hCHF: "Swiss franc", hARS: "Argentine peso", hBRL: "Brazilian real" },
  pt: { USDC: "USD Coin", hUSDY: "Títulos do tesouro", hXAU: "Ouro", hNVDA: "NVIDIA", hSHEL: "Shell", hBMW: "BMW", hTRY: "Lira turca", hEUR: "Euro", hGBP: "Libra esterlina", hCHF: "Franco suíço", hARS: "Peso argentino", hBRL: "Real brasileiro" },
  es: { USDC: "USD Coin", hUSDY: "Bonos del tesoro", hXAU: "Oro", hNVDA: "NVIDIA", hSHEL: "Shell", hBMW: "BMW", hTRY: "Lira turca", hEUR: "Euro", hGBP: "Libra esterlina", hCHF: "Franco suizo", hARS: "Peso argentino", hBRL: "Real brasileño" },
};
const LOCALE: Record<Lang, string> = { tr: "tr-TR", en: "en-US", pt: "pt-BR", es: "es-ES" };

function fill(s: string, vars?: Record<string, string | number>) {
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? "" : String(vars[k]))) : s;
}

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: Key, vars?: Record<string, string | number>) => string;
  locale: string;
  assetName: (code: string) => string;
  assetBlurb: (code: string) => string;
  labelHold: (s: string) => string;
  ago: (ts: number) => string;
  /** sunucu bildirimini dile göre başlık/gövdeye çevirir */
  notif: (n: { kind: string; title: string; body: string; data: string | null }) => { title: string; body: string };
}
const Ctx = createContext<LangCtx | null>(null);
const KEY = "haze.lang";

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("tr");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY) as Lang | null;
      if (saved && LANGS.includes(saved)) setLangState(saved);
      else if (typeof navigator !== "undefined") {
        const nav = navigator.language.toLowerCase().slice(0, 2);
        setLangState((LANGS as string[]).includes(nav) ? (nav as Lang) : "en");
      }
    } catch {
      /* */
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    setFormatLocale(LOCALE[lang]);
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* */
    }
  }, []);
  const value = useMemo<LangCtx>(() => {
    const t = (key: Key, vars?: Record<string, string | number>) => fill(STR[key][lang], vars);
    const locale = LOCALE[lang];
    setFormatLocale(locale);
    const num = (v: number, d = 2) => v.toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
    const assetName = (code: string) => (lang === "tr" ? ASSET_META[code as AssetCode]?.name : NAMES[lang][code as AssetCode]) ?? code;
    const assetBlurb = (code: string) => {
      const m = ASSET_META[code as AssetCode];
      if (!m) return "";
      if (m.kind === "stock") return t("varlik.stock", { ad: assetName(code) });
      if (m.kind === "fiat") return t("varlik.fiat");
      if (m.kind === "stable" || m.kind === "treasury" || m.kind === "gold") return t(`varlik.${m.kind}` as Key);
      return assetName(code);
    };
    const labelHold = (s: string) => (`hold.${s}` in STR ? t(`hold.${s}` as Key) : s);
    const ago = (ts: number) => {
      const d = (Date.now() - ts) / 1000;
      if (d < 60) return t("zaman.azOnce");
      if (d < 3600) return t("zaman.dk", { n: Math.floor(d / 60) });
      if (d < 86400) return t("zaman.sa", { n: Math.floor(d / 3600) });
      return new Date(ts).toLocaleDateString(locale);
    };
    const notif = (n: { kind: string; title: string; body: string; data: string | null }) => {
      if (lang === "tr") return { title: n.title, body: n.body };
      let data: Record<string, unknown> = {};
      try {
        data = n.data ? (JSON.parse(n.data) as Record<string, unknown>) : {};
      } catch {
        /* */
      }
      const f7 = (v: unknown) => (v == null ? undefined : num(Number(v) / 1e7));
      const titleKey = `bildirim.${n.kind}` as Key;
      const title = STR[titleKey] ? t(titleKey) : n.title;
      if (n.kind === "salary_settled" && data.added != null) {
        const repaid = Number(data.repaid ?? 0);
        return { title, body: repaid > 0 ? t("bildirim.salary_settled.body", { repaid: f7(data.repaid)!, added: f7(data.added)! }) : t("bildirim.salary_settled.bodyNoDebt", { added: f7(data.added)! }) };
      }
      if (n.kind === "card_approved" && data.usdc != null) {
        return { title: `${data.merchant ?? title}${data.merchantTry ? ` · ₺${data.merchantTry}` : ""}`, body: t("bildirim.card_approved.body", { usdc: f7(data.usdc)!, limit: f7(data.remainingLimit) ?? "" }) };
      }
      return { title, body: n.body };
    };
    return { lang, setLang, t, locale, assetName, assetBlurb, labelHold, ago, notif };
  }, [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLang(): LangCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("LangProvider yok");
  return c;
}

/** Basitleştirilmiş SVG bayraklar (emoji bayraklar Windows'ta harf olarak görünür) */
function Bayrak({ lang, size = 18 }: { lang: Lang; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", style: { borderRadius: "50%", flex: "none", boxShadow: "0 1px 2px rgba(59,50,38,0.25)" } as const, "aria-hidden": true as const };
  switch (lang) {
    case "tr":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#E30A17" />
          <circle cx="10" cy="12" r="5.2" fill="#fff" />
          <circle cx="11.3" cy="12" r="4.2" fill="#E30A17" />
          <path d="M15.6 9.6l.7 2.1h2.2l-1.8 1.3.7 2.1-1.8-1.3-1.8 1.3.7-2.1-1.8-1.3h2.2z" fill="#fff" />
        </svg>
      );
    case "en":
      return (
        <svg {...common}>
          <clipPath id="uk"><circle cx="12" cy="12" r="12" /></clipPath>
          <g clipPath="url(#uk)">
            <rect width="24" height="24" fill="#012169" />
            <path d="M0 0l24 24M24 0L0 24" stroke="#fff" strokeWidth="4" />
            <path d="M0 0l24 24M24 0L0 24" stroke="#C8102E" strokeWidth="1.6" />
            <path d="M12 0v24M0 12h24" stroke="#fff" strokeWidth="6" />
            <path d="M12 0v24M0 12h24" stroke="#C8102E" strokeWidth="3.2" />
          </g>
        </svg>
      );
    case "pt":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="12" fill="#009C3B" />
          <path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z" fill="#FFDF00" />
          <circle cx="12" cy="12" r="3.6" fill="#002776" />
          <path d="M8.6 11.3c2.3-.6 4.6-.2 6.8 1.1" stroke="#fff" strokeWidth=".7" fill="none" />
        </svg>
      );
    case "es":
      return (
        <svg {...common}>
          <clipPath id="es"><circle cx="12" cy="12" r="12" /></clipPath>
          <g clipPath="url(#es)">
            <rect width="24" height="24" fill="#AA151B" />
            <rect y="6" width="24" height="12" fill="#F1BF00" />
          </g>
        </svg>
      );
  }
}

const LANG_NAME: Record<Lang, string> = { tr: "Türkçe", en: "English", pt: "Português", es: "Español" };

/**
 * Dil seçici — bayraklı açılır menü. Menü, cam kartların (backdrop-filter → kendi katman bağlamı) altında
 * kalmasın diye portal ile body'ye çizilir ve düğmenin konumuna sabitlenir (position: fixed).
 */
export function DilSecici({ koyu = false }: { koyu?: boolean }) {
  const { lang, setLang } = useLang();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
  }, []);
  useEffect(() => {
    if (!open) return;
    place();
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("click", close);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, place]);
  const menu = open && typeof document !== "undefined"
    ? createPortal(
        <ul className="dil-menu cam" role="listbox" style={{ top: pos.top, right: pos.right }} onClick={(e) => e.stopPropagation()}>
          {LANGS.map((l) => (
            <li key={l} role="option" aria-selected={lang === l} className={lang === l ? "aktif" : ""} onClick={() => { setLang(l); setOpen(false); }}>
              <Bayrak lang={l} />
              <span>{LANG_NAME[l]}</span>
              <span className="ikincil" style={{ marginLeft: "auto", fontSize: 11 }}>{l.toUpperCase()}</span>
            </li>
          ))}
        </ul>,
        document.body,
      )
    : null;
  return (
    <span className={`dil${koyu ? " koyu" : ""}`}>
      <button ref={btn} className="dil-btn" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} aria-haspopup="listbox" aria-expanded={open}>
        <Bayrak lang={lang} />
        <span>{lang.toUpperCase()}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
      {menu}
    </span>
  );
}
