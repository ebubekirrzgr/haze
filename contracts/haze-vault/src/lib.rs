//! HazeVault — kullanıcı başına teminat kasası.
//!
//! Kullanıcının Blend pozisyonlarını tutar. Sahip (owner) = kullanıcının G-hesabı,
//! operatör = haze-api. Operatörün yetkisi kapsamı sınırlıdır: yalnızca karta borç açar
//! (borrow_for_card), iade eder (refund_for_card) ve maaş günü borcu kapatır (settle_salary).
//! Teminatı çekmek, dilediği yere borç almak yalnızca sahibin yetkisindedir.
//!
//! Havuz Blend v2 ya da HazeCredit olabilir; ikisi de `submit(from, spender, to, requests)`
//! arayüzünü sunar. Vault her zaman from = spender = to = kendisi olarak çağırır; token
//! sonra sahibine ya da takas hazinesine aktarılır.
#![no_std]

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contractclient, contractevent, contractimpl, contracttype, token, vec, Address,
    BytesN, Env, IntoVal, Map, Symbol, Vec,
};

const INSTANCE_TTL_THRESHOLD: u32 = 17280 * 7;
const INSTANCE_TTL_EXTEND: u32 = 17280 * 30;
/// auth_id idempotency kaydı ~7 gün yaşar
const AUTH_TTL_THRESHOLD: u32 = 17280 * 3;
const AUTH_TTL_EXTEND: u32 = 17280 * 7;
const DAY_SECONDS: u64 = 86_400;

pub const REQ_SUPPLY_COLLATERAL: u32 = 2;
pub const REQ_WITHDRAW_COLLATERAL: u32 = 3;
pub const REQ_BORROW: u32 = 4;
pub const REQ_REPAY: u32 = 5;

// --- Blend tipleri (havuz arayüzü) ---

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Request {
    pub request_type: u32,
    pub address: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Positions {
    pub liabilities: Map<u32, i128>,
    pub collateral: Map<u32, i128>,
    pub supply: Map<u32, i128>,
}

#[contractclient(name = "PoolClient")]
pub trait Pool {
    fn submit(
        env: Env,
        from: Address,
        spender: Address,
        to: Address,
        requests: Vec<Request>,
    ) -> Positions;
    fn get_positions(env: Env, address: Address) -> Positions;
}

// --- Vault tipleri ---

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    pub owner: Address,
    pub operator: Address,
    pub pool: Address,
    pub usdc: Address,
    pub settlement: Address,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CardState {
    pub day: u64,
    pub spent_today: i128,
    pub daily_limit: i128,
    pub frozen: bool,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    DailyLimit,
    Frozen,
    Spent(u64),
    Auth(BytesN<32>),
    /// İşlem para biriminde açılan kart borcu: varlık (SAC) adresi
    AuthAsset(BytesN<32>),
    /// Aynı yetkilendirmenin USDC karşılığı (günlük limit sayacı)
    AuthUsd(BytesN<32>),
}

// --- Olaylar (haze-api indexer bunları dinler) ---

#[contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct CardBorrow {
    #[topic]
    pub auth_id: BytesN<32>,
    pub amount: i128,
    pub spent_today: i128,
}

/// İşlem para biriminde (ör. hTRY) açılan kart borcu; CardBorrow ile birlikte yayımlanır.
#[contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct CardBorrowAsset {
    #[topic]
    pub auth_id: BytesN<32>,
    pub asset: Address,
    pub amount: i128,
    pub usd_amount: i128,
}

/// Kur masası: fiat borç hazineden gelen token'la kapatıldı, karşılığı USDC teminattan alındı.
#[contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct FxSettled {
    pub asset: Address,
    pub repaid: i128,
    pub usdc_paid: i128,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct CardRefund {
    #[topic]
    pub auth_id: BytesN<32>,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct SalarySettled {
    pub received: i128,
    pub repaid: i128,
    pub collateral_added: i128,
}

#[contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct VaultAction {
    #[topic]
    pub action: Symbol,
    pub asset: Address,
    pub amount: i128,
}

#[contract]
pub struct HazeVault;

#[contractimpl]
impl HazeVault {
    /// VaultFactory tarafından deploy edilir.
    pub fn __constructor(
        env: Env,
        owner: Address,
        operator: Address,
        pool: Address,
        usdc: Address,
        settlement: Address,
        daily_limit: i128,
    ) {
        assert!(daily_limit >= 0, "bad limit");
        env.storage().instance().set(
            &DataKey::Config,
            &Config {
                owner,
                operator,
                pool,
                usdc,
                settlement,
            },
        );
        env.storage().instance().set(&DataKey::DailyLimit, &daily_limit);
        env.storage().instance().set(&DataKey::Frozen, &false);
    }

    // ===================== Sahip yetkisi =====================

    /// Varlığı sahibinden alır ve havuza teminat olarak yatırır (SupplyCollateral).
    pub fn deposit(env: Env, asset: Address, amount: i128) -> Positions {
        let cfg = Self::config(&env);
        cfg.owner.require_auth();
        assert!(amount > 0, "amount must be positive");
        Self::bump(&env);
        let me = env.current_contract_address();
        token::Client::new(&env, &asset).transfer(&cfg.owner, &me, &amount);
        let pos = Self::supply_collateral(&env, &cfg, &asset, amount);
        VaultAction {
            action: Symbol::new(&env, "deposit"),
            asset,
            amount,
        }
        .publish(&env);
        pos
    }

    /// Teminatı çeker ve sahibine gönderir. Havuz sağlıksız kalırsa işlem geri alınır.
    pub fn withdraw(env: Env, asset: Address, amount: i128) -> Positions {
        let cfg = Self::config(&env);
        cfg.owner.require_auth();
        assert!(amount > 0, "amount must be positive");
        Self::bump(&env);
        let me = env.current_contract_address();
        let before = token::Client::new(&env, &asset).balance(&me);
        let pos = Self::submit(
            &env,
            &cfg,
            vec![
                &env,
                Request {
                    request_type: REQ_WITHDRAW_COLLATERAL,
                    address: asset.clone(),
                    amount,
                },
            ],
        );
        // Havuz, pozisyondan fazlası istenirse mevcut kadarını verir; gerçekte geleni aktar.
        let got = token::Client::new(&env, &asset).balance(&me) - before;
        assert!(got > 0, "nothing withdrawn");
        token::Client::new(&env, &asset).transfer(&me, &cfg.owner, &got);
        VaultAction {
            action: Symbol::new(&env, "withdraw"),
            asset,
            amount: got,
        }
        .publish(&env);
        pos
    }

    /// Satmadan nakde çevir: teminata karşı USDC borç alır, sahibine gönderir.
    pub fn borrow(env: Env, amount: i128) -> Positions {
        let cfg = Self::config(&env);
        cfg.owner.require_auth();
        assert!(amount > 0, "amount must be positive");
        Self::bump(&env);
        let me = env.current_contract_address();
        let pos = Self::submit(
            &env,
            &cfg,
            vec![
                &env,
                Request {
                    request_type: REQ_BORROW,
                    address: cfg.usdc.clone(),
                    amount,
                },
            ],
        );
        token::Client::new(&env, &cfg.usdc).transfer(&me, &cfg.owner, &amount);
        VaultAction {
            action: Symbol::new(&env, "borrow"),
            asset: cfg.usdc.clone(),
            amount,
        }
        .publish(&env);
        pos
    }

    /// Teminata karşı herhangi bir havuz rezervini (ör. hTRY, hEUR gibi fiat token'lar) borç alır ve
    /// sahibine gönderir. Havuz, rezerv borç alınabilir değilse ya da sağlık faktörü bozulursa reddeder.
    pub fn borrow_asset(env: Env, asset: Address, amount: i128) -> Positions {
        let cfg = Self::config(&env);
        cfg.owner.require_auth();
        assert!(amount > 0, "amount must be positive");
        Self::bump(&env);
        let me = env.current_contract_address();
        let pos = Self::submit(
            &env,
            &cfg,
            vec![
                &env,
                Request {
                    request_type: REQ_BORROW,
                    address: asset.clone(),
                    amount,
                },
            ],
        );
        token::Client::new(&env, &asset).transfer(&me, &cfg.owner, &amount);
        VaultAction {
            action: Symbol::new(&env, "borrow"),
            asset,
            amount,
        }
        .publish(&env);
        pos
    }

    /// `asset` cinsinden borcu sahibin bakiyesiyle öder. Havuz borçtan fazlasını almaz; artan tutar
    /// (fiat rezervler teminat sayılmadığı için) sahibine geri gönderilir.
    pub fn repay_asset(env: Env, asset: Address, amount: i128) -> Positions {
        let cfg = Self::config(&env);
        cfg.owner.require_auth();
        assert!(amount > 0, "amount must be positive");
        Self::bump(&env);
        let me = env.current_contract_address();
        let tok = token::Client::new(&env, &asset);
        tok.transfer(&cfg.owner, &me, &amount);
        Self::authorize_pool_pull(&env, &cfg, &asset, amount);
        let pos = Self::submit(
            &env,
            &cfg,
            vec![
                &env,
                Request {
                    request_type: REQ_REPAY,
                    address: asset.clone(),
                    amount,
                },
            ],
        );
        let leftover = tok.balance(&me);
        if leftover > 0 {
            tok.transfer(&me, &cfg.owner, &leftover);
        }
        VaultAction {
            action: Symbol::new(&env, "repay"),
            asset,
            amount: amount - leftover,
        }
        .publish(&env);
        pos
    }

    /// Sahip USDC'siyle borç öder. Borçtan fazlası havuz tarafından alınmaz; artan vault'ta kalır
    /// ve teminata eklenir.
    pub fn repay(env: Env, amount: i128) -> Positions {
        let cfg = Self::config(&env);
        cfg.owner.require_auth();
        assert!(amount > 0, "amount must be positive");
        Self::bump(&env);
        let me = env.current_contract_address();
        token::Client::new(&env, &cfg.usdc).transfer(&cfg.owner, &me, &amount);
        let (pos, repaid, added) = Self::repay_then_collateralize(&env, &cfg, amount);
        VaultAction {
            action: Symbol::new(&env, "repay"),
            asset: cfg.usdc.clone(),
            amount: repaid,
        }
        .publish(&env);
        if added > 0 {
            VaultAction {
                action: Symbol::new(&env, "deposit"),
                asset: cfg.usdc.clone(),
                amount: added,
            }
            .publish(&env);
        }
        pos
    }

    pub fn set_daily_limit(env: Env, limit: i128) {
        let cfg = Self::config(&env);
        cfg.owner.require_auth();
        assert!(limit >= 0, "bad limit");
        Self::bump(&env);
        env.storage().instance().set(&DataKey::DailyLimit, &limit);
    }

    /// Kartı dondur / çöz.
    pub fn set_frozen(env: Env, frozen: bool) {
        let cfg = Self::config(&env);
        cfg.owner.require_auth();
        Self::bump(&env);
        env.storage().instance().set(&DataKey::Frozen, &frozen);
    }

    // ===================== Operatör yetkisi =====================

    /// Kart yetkilendirmesi için USDC borç açar ve takas hazinesine aktarır.
    /// auth_id idempotency anahtarıdır (Lithic yetkilendirme token'ının sha256'sı).
    pub fn borrow_for_card(env: Env, amount: i128, auth_id: BytesN<32>) -> Positions {
        let cfg = Self::config(&env);
        cfg.operator.require_auth();
        assert!(amount > 0, "amount must be positive");
        Self::bump(&env);

        let frozen: bool = env.storage().instance().get(&DataKey::Frozen).unwrap_or(false);
        assert!(!frozen, "card frozen");

        let auth_key = DataKey::Auth(auth_id.clone());
        assert!(
            !env.storage().persistent().has(&auth_key),
            "auth already processed"
        );

        let day = env.ledger().timestamp() / DAY_SECONDS;
        let spent_key = DataKey::Spent(day);
        let spent: i128 = env.storage().temporary().get(&spent_key).unwrap_or(0);
        let limit: i128 = env.storage().instance().get(&DataKey::DailyLimit).unwrap_or(0);
        let new_spent = spent + amount;
        assert!(new_spent <= limit, "daily limit exceeded");

        let me = env.current_contract_address();
        let pos = Self::submit(
            &env,
            &cfg,
            vec![
                &env,
                Request {
                    request_type: REQ_BORROW,
                    address: cfg.usdc.clone(),
                    amount,
                },
            ],
        );
        token::Client::new(&env, &cfg.usdc).transfer(&me, &cfg.settlement, &amount);

        env.storage().temporary().set(&spent_key, &new_spent);
        env.storage()
            .temporary()
            .extend_ttl(&spent_key, 17280, 17280 * 2);
        env.storage().persistent().set(&auth_key, &amount);
        env.storage()
            .persistent()
            .extend_ttl(&auth_key, AUTH_TTL_THRESHOLD, AUTH_TTL_EXTEND);

        CardBorrow {
            auth_id,
            amount,
            spent_today: new_spent,
        }
        .publish(&env);
        pos
    }

    /// Kart yetkilendirmesi için işlem para biriminin token'ını (ör. Türkiye'de hTRY) borç alır ve takas
    /// hazinesine aktarır: kullanıcı harcadığı para biriminde borçlanır, dolar teminatı yerinde kalır.
    /// `usd_amount`: günlük limit sayacı için USDC karşılığı (haze-api ASA kararında aynı değeri kullanır).
    pub fn borrow_for_card_asset(env: Env, asset: Address, amount: i128, usd_amount: i128, auth_id: BytesN<32>) -> Positions {
        let cfg = Self::config(&env);
        cfg.operator.require_auth();
        assert!(amount > 0 && usd_amount > 0, "amount must be positive");
        Self::bump(&env);

        let frozen: bool = env.storage().instance().get(&DataKey::Frozen).unwrap_or(false);
        assert!(!frozen, "card frozen");
        let auth_key = DataKey::Auth(auth_id.clone());
        assert!(!env.storage().persistent().has(&auth_key), "auth already processed");

        let day = env.ledger().timestamp() / DAY_SECONDS;
        let spent_key = DataKey::Spent(day);
        let spent: i128 = env.storage().temporary().get(&spent_key).unwrap_or(0);
        let limit: i128 = env.storage().instance().get(&DataKey::DailyLimit).unwrap_or(0);
        let new_spent = spent + usd_amount;
        assert!(new_spent <= limit, "daily limit exceeded");

        let me = env.current_contract_address();
        let pos = Self::submit(
            &env,
            &cfg,
            vec![&env, Request { request_type: REQ_BORROW, address: asset.clone(), amount }],
        );
        token::Client::new(&env, &asset).transfer(&me, &cfg.settlement, &amount);

        env.storage().temporary().set(&spent_key, &new_spent);
        env.storage().temporary().extend_ttl(&spent_key, 17280, 17280 * 2);
        env.storage().persistent().set(&auth_key, &amount);
        env.storage().persistent().extend_ttl(&auth_key, AUTH_TTL_THRESHOLD, AUTH_TTL_EXTEND);
        let asset_key = DataKey::AuthAsset(auth_id.clone());
        env.storage().persistent().set(&asset_key, &asset);
        env.storage().persistent().extend_ttl(&asset_key, AUTH_TTL_THRESHOLD, AUTH_TTL_EXTEND);
        let usd_key = DataKey::AuthUsd(auth_id.clone());
        env.storage().persistent().set(&usd_key, &usd_amount);
        env.storage().persistent().extend_ttl(&usd_key, AUTH_TTL_THRESHOLD, AUTH_TTL_EXTEND);

        CardBorrow { auth_id: auth_id.clone(), amount: usd_amount, spent_today: new_spent }.publish(&env);
        CardBorrowAsset { auth_id, asset, amount, usd_amount }.publish(&env);
        pos
    }

    /// İade / void (işlem para birimi): takas hazinesi token'ı vault'a geri göndermiş olmalı; borç o
    /// tokenla ödenir, artan hazineye döner. Günlük sayaç USDC karşılığı kadar düşülür.
    pub fn refund_for_card_asset(env: Env, amount: i128, auth_id: BytesN<32>) -> Positions {
        let cfg = Self::config(&env);
        cfg.operator.require_auth();
        assert!(amount > 0, "amount must be positive");
        Self::bump(&env);
        let auth_key = DataKey::Auth(auth_id.clone());
        let borrowed: i128 = env.storage().persistent().get(&auth_key).expect("unknown auth");
        let asset: Address = env.storage().persistent().get(&DataKey::AuthAsset(auth_id.clone())).expect("not an asset auth");
        let usd_total: i128 = env.storage().persistent().get(&DataKey::AuthUsd(auth_id.clone())).unwrap_or(0);
        assert!(amount <= borrowed, "refund exceeds borrow");
        let me = env.current_contract_address();
        let tok = token::Client::new(&env, &asset);
        assert!(tok.balance(&me) >= amount, "refund not funded");

        Self::authorize_pool_pull(&env, &cfg, &asset, amount);
        let pos = Self::submit(
            &env,
            &cfg,
            vec![&env, Request { request_type: REQ_REPAY, address: asset.clone(), amount }],
        );
        let leftover = tok.balance(&me);
        if leftover > 0 {
            tok.transfer(&me, &cfg.settlement, &leftover);
        }

        env.storage().persistent().set(&auth_key, &(borrowed - amount));
        // günlük sayaç: iade oranında USDC karşılığı düşülür
        let usd_back = if borrowed > 0 { usd_total * amount / borrowed } else { 0 };
        let day = env.ledger().timestamp() / DAY_SECONDS;
        let spent_key = DataKey::Spent(day);
        let spent: i128 = env.storage().temporary().get(&spent_key).unwrap_or(0);
        let new_spent = if spent > usd_back { spent - usd_back } else { 0 };
        env.storage().temporary().set(&spent_key, &new_spent);

        CardRefund { auth_id, amount: usd_back }.publish(&env);
        pos
    }

    /// Kur masası (maaş günü): hazine `fiat_amount` kadar `asset`'i vault'a göndermiş olmalı; fiat borç bununla
    /// kapatılır, artan hazineye döner; karşılığı `usdc_amount` USDC teminattan çekilip takas hazinesine gider.
    /// Operatör kur ve tutarı belirler (SEP-38 kuru); güven varsayımı README'de.
    pub fn settle_fx(env: Env, asset: Address, fiat_amount: i128, usdc_amount: i128) -> Positions {
        let cfg = Self::config(&env);
        cfg.operator.require_auth();
        assert!(fiat_amount > 0 && usdc_amount >= 0, "bad amounts");
        Self::bump(&env);
        let me = env.current_contract_address();
        let tok = token::Client::new(&env, &asset);
        let before = tok.balance(&me);
        assert!(before >= fiat_amount, "fx not funded");
        Self::authorize_pool_pull(&env, &cfg, &asset, fiat_amount);
        let mut pos = Self::submit(
            &env,
            &cfg,
            vec![&env, Request { request_type: REQ_REPAY, address: asset.clone(), amount: fiat_amount }],
        );
        let after = tok.balance(&me);
        let repaid = before - after;
        if after > 0 {
            tok.transfer(&me, &cfg.settlement, &after);
        }
        if usdc_amount > 0 {
            pos = Self::submit(
                &env,
                &cfg,
                vec![&env, Request { request_type: REQ_WITHDRAW_COLLATERAL, address: cfg.usdc.clone(), amount: usdc_amount }],
            );
            token::Client::new(&env, &cfg.usdc).transfer(&me, &cfg.settlement, &usdc_amount);
        }
        FxSettled { asset, repaid, usdc_paid: usdc_amount }.publish(&env);
        pos
    }

    /// İade / void: takas hazinesi USDC'yi vault'a geri göndermiş olmalı; vault'taki USDC ile
    /// Repay yapılır, artan teminata eklenir. Gün içi harcama sayacı düşülür.
    pub fn refund_for_card(env: Env, amount: i128, auth_id: BytesN<32>) -> Positions {
        let cfg = Self::config(&env);
        cfg.operator.require_auth();
        assert!(amount > 0, "amount must be positive");
        Self::bump(&env);
        let auth_key = DataKey::Auth(auth_id.clone());
        let borrowed: i128 = env
            .storage()
            .persistent()
            .get(&auth_key)
            .expect("unknown auth");
        assert!(amount <= borrowed, "refund exceeds borrow");
        let me = env.current_contract_address();
        let bal = token::Client::new(&env, &cfg.usdc).balance(&me);
        assert!(bal >= amount, "refund not funded");

        let (pos, _repaid, _added) = Self::repay_then_collateralize(&env, &cfg, amount);

        env.storage().persistent().set(&auth_key, &(borrowed - amount));
        let day = env.ledger().timestamp() / DAY_SECONDS;
        let spent_key = DataKey::Spent(day);
        let spent: i128 = env.storage().temporary().get(&spent_key).unwrap_or(0);
        let new_spent = if spent > amount { spent - amount } else { 0 };
        env.storage().temporary().set(&spent_key, &new_spent);

        CardRefund { auth_id, amount }.publish(&env);
        pos
    }

    /// Maaş günü: sahibin vault'a verdiği USDC allowance'ı ile `amount` çekilir; önce borç
    /// (`repay_amount` kadar, borçla sınırlı) kapatılır, kalan teminata eklenir.
    /// `repay_amount` haze-api tarafından blend-sdk ile okunan güncel borçtur; 0 ise borç yok.
    pub fn settle_salary(env: Env, amount: i128, repay_amount: i128) -> Positions {
        let cfg = Self::config(&env);
        cfg.operator.require_auth();
        assert!(amount > 0, "amount must be positive");
        assert!(repay_amount >= 0, "bad repay amount");
        Self::bump(&env);
        let me = env.current_contract_address();
        token::Client::new(&env, &cfg.usdc).transfer_from(&me, &cfg.owner, &me, &amount);
        let want_repay = if repay_amount > amount { amount } else { repay_amount };
        let (pos, repaid, added) = if want_repay > 0 {
            Self::repay_then_collateralize(&env, &cfg, want_repay)
        } else {
            let pos = Self::supply_collateral(&env, &cfg, &cfg.usdc, amount);
            (pos, 0, amount)
        };
        SalarySettled {
            received: amount,
            repaid,
            collateral_added: added,
        }
        .publish(&env);
        pos
    }

    // ===================== Okuma =====================

    pub fn card_state(env: Env) -> CardState {
        let day = env.ledger().timestamp() / DAY_SECONDS;
        CardState {
            day,
            spent_today: env
                .storage()
                .temporary()
                .get(&DataKey::Spent(day))
                .unwrap_or(0),
            daily_limit: env.storage().instance().get(&DataKey::DailyLimit).unwrap_or(0),
            frozen: env.storage().instance().get(&DataKey::Frozen).unwrap_or(false),
        }
    }

    pub fn get_config(env: Env) -> Config {
        Self::config(&env)
    }

    pub fn positions(env: Env) -> Positions {
        let cfg = Self::config(&env);
        PoolClient::new(&env, &cfg.pool).get_positions(&env.current_contract_address())
    }

    /// auth_id için açılmış borç (yoksa None). haze-api idempotency kontrolü için.
    pub fn auth_amount(env: Env, auth_id: BytesN<32>) -> Option<i128> {
        env.storage().persistent().get(&DataKey::Auth(auth_id))
    }

    // ===================== İç yardımcılar =====================

    fn config(env: &Env) -> Config {
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    fn bump(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND);
    }

    /// Havuz, vault'tan token çekecekse (SupplyCollateral, Repay) bu alt çağrıya önceden yetki verir.
    fn authorize_pool_pull(env: &Env, cfg: &Config, asset: &Address, amount: i128) {
        let me = env.current_contract_address();
        env.authorize_as_current_contract(vec![
            env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: asset.clone(),
                    fn_name: Symbol::new(env, "transfer"),
                    args: (me, cfg.pool.clone(), amount).into_val(env),
                },
                sub_invocations: vec![env],
            }),
        ]);
    }

    fn submit(env: &Env, cfg: &Config, requests: Vec<Request>) -> Positions {
        let me = env.current_contract_address();
        PoolClient::new(env, &cfg.pool).submit(&me, &me, &me, &requests)
    }

    fn supply_collateral(env: &Env, cfg: &Config, asset: &Address, amount: i128) -> Positions {
        Self::authorize_pool_pull(env, cfg, asset, amount);
        Self::submit(
            env,
            cfg,
            vec![
                env,
                Request {
                    request_type: REQ_SUPPLY_COLLATERAL,
                    address: asset.clone(),
                    amount,
                },
            ],
        )
    }

    /// Vault'taki USDC ile `amount` kadar Repay dener; havuz borçtan fazlasını almaz.
    /// Vault'ta kalan USDC teminata eklenir. Döner: (pozisyon, ödenen, teminata eklenen)
    fn repay_then_collateralize(env: &Env, cfg: &Config, amount: i128) -> (Positions, i128, i128) {
        let me = env.current_contract_address();
        let usdc = token::Client::new(env, &cfg.usdc);
        let before = usdc.balance(&me);
        // Borç yoksa Repay isteği göndermeden doğrudan teminata ekle (Blend 0 borçta Repay'i sevmez).
        let has_debt = PoolClient::new(env, &cfg.pool)
            .get_positions(&me)
            .liabilities
            .len()
            > 0;
        if !has_debt {
            let pos = Self::supply_collateral(env, cfg, &cfg.usdc, before);
            return (pos, 0, before);
        }
        Self::authorize_pool_pull(env, cfg, &cfg.usdc, amount);
        let mut pos = Self::submit(
            env,
            cfg,
            vec![
                env,
                Request {
                    request_type: REQ_REPAY,
                    address: cfg.usdc.clone(),
                    amount,
                },
            ],
        );
        let after = usdc.balance(&me);
        let repaid = before - after;
        let leftover = after;
        if leftover > 0 {
            pos = Self::supply_collateral(env, cfg, &cfg.usdc, leftover);
        }
        (pos, repaid, leftover)
    }
}

#[cfg(test)]
mod test;
