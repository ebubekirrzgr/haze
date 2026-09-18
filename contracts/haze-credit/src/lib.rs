//! HazeCredit — Blend'in `submit(from, spender, to, requests)` imzasını taklit eden minimal kredi havuzu.
//!
//! İki amacı var:
//! 1. Yedek plan: kendi Blend dağıtımımız 8. saatte çalışmazsa HazeVault yalnızca havuz adresini
//!    değiştirir; arayüz aynı olduğu için vault kodu değişmez.
//! 2. Test havuzu: HazeVault'un native testleri bu kontrata karşı koşar.
//!
//! Desteklenen istek tipleri (Blend ile aynı numaralar):
//!   0 Supply · 1 Withdraw · 2 SupplyCollateral · 3 WithdrawCollateral · 4 Borrow · 5 Repay
//! Pozisyonlar Blend'in `Positions` yapısıyla aynı şekilde döner; ancak Blend'de değerler
//! b/dToken iken burada doğrudan varlık miktarıdır (7 ondalık). Faiz: sabit yıllık oran,
//! kullanıcı bazında basit birikim (her submit'te tahakkuk eder).
#![no_std]

use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, token, Address, Env, Map, Symbol, Vec,
};

pub const SCALAR_7: i128 = 1_0000000;
const SECONDS_PER_YEAR: i128 = 31_536_000;
const INSTANCE_TTL_THRESHOLD: u32 = 17280 * 7;
const INSTANCE_TTL_EXTEND: u32 = 17280 * 30;
const PERSIST_TTL_THRESHOLD: u32 = 17280 * 14;
const PERSIST_TTL_EXTEND: u32 = 17280 * 60;

pub const REQ_SUPPLY: u32 = 0;
pub const REQ_WITHDRAW: u32 = 1;
pub const REQ_SUPPLY_COLLATERAL: u32 = 2;
pub const REQ_WITHDRAW_COLLATERAL: u32 = 3;
pub const REQ_BORROW: u32 = 4;
pub const REQ_REPAY: u32 = 5;

// --- Blend ile birebir aynı tipler ---

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

// --- Oracle arayüzü (Blend PriceFeed) ---

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum Asset {
    Stellar(Address),
    Other(Symbol),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
}

#[contractclient(name = "OracleClient")]
pub trait PriceFeed {
    fn lastprice(env: Env, asset: Asset) -> Option<PriceData>;
    fn decimals(env: Env) -> u32;
}

// --- HazeCredit'e özgü tipler ---

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ReserveConfig {
    pub asset: Address,
    pub index: u32,
    /// Teminat faktörü, 7 ondalık (0,95 = 9_500_000)
    pub c_factor: u32,
    /// Borç faktörü, 7 ondalık
    pub l_factor: u32,
    /// Yıllık sabit borç faizi, baz puan (500 = %5)
    pub borrow_rate_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Health {
    /// Etkin teminat (USD, 7 ondalık)
    pub effective_collateral: i128,
    /// Etkin borç (USD, 7 ondalık)
    pub effective_liabilities: i128,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Oracle,
    Reserves,
    ResIndex(Address),
    Pos(Address),
    Accrued(Address),
}

#[contract]
pub struct HazeCredit;

#[contractimpl]
impl HazeCredit {
    pub fn __constructor(env: Env, admin: Address, oracle: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Oracle, &oracle);
        env.storage()
            .instance()
            .set(&DataKey::Reserves, &Vec::<ReserveConfig>::new(&env));
    }

    /// Rezerv ekle (admin). Sıra = rezerv indeksi.
    pub fn add_reserve(
        env: Env,
        asset: Address,
        c_factor: u32,
        l_factor: u32,
        borrow_rate_bps: u32,
    ) -> u32 {
        Self::admin(&env).require_auth();
        Self::bump(&env);
        assert!(
            !env.storage().instance().has(&DataKey::ResIndex(asset.clone())),
            "reserve exists"
        );
        let mut reserves: Vec<ReserveConfig> =
            env.storage().instance().get(&DataKey::Reserves).unwrap();
        let index = reserves.len();
        reserves.push_back(ReserveConfig {
            asset: asset.clone(),
            index,
            c_factor,
            l_factor,
            borrow_rate_bps,
        });
        env.storage().instance().set(&DataKey::Reserves, &reserves);
        env.storage()
            .instance()
            .set(&DataKey::ResIndex(asset), &index);
        index
    }

    pub fn set_oracle(env: Env, oracle: Address) {
        Self::admin(&env).require_auth();
        env.storage().instance().set(&DataKey::Oracle, &oracle);
    }

    // --- Blend arayüzü ---

    /// Blend ile aynı imza. `from` pozisyon sahibi, `spender` token veren, `to` token alan.
    pub fn submit(
        env: Env,
        from: Address,
        spender: Address,
        to: Address,
        requests: Vec<Request>,
    ) -> Positions {
        from.require_auth();
        if spender != from {
            spender.require_auth();
        }
        Self::bump(&env);
        let pool = env.current_contract_address();
        let mut pos = Self::accrued_positions(&env, &from);
        let mut check_health = false;

        for req in requests.iter() {
            assert!(req.amount > 0, "amount must be positive");
            let idx = Self::reserve_index(&env, &req.address);
            let tok = token::Client::new(&env, &req.address);
            match req.request_type {
                REQ_SUPPLY => {
                    tok.transfer(&spender, &pool, &req.amount);
                    let cur = pos.supply.get(idx).unwrap_or(0);
                    pos.supply.set(idx, cur + req.amount);
                }
                REQ_WITHDRAW => {
                    let cur = pos.supply.get(idx).unwrap_or(0);
                    let amt = if req.amount > cur { cur } else { req.amount };
                    assert!(amt > 0, "nothing to withdraw");
                    Self::set_or_remove(&mut pos.supply, idx, cur - amt);
                    tok.transfer(&pool, &to, &amt);
                }
                REQ_SUPPLY_COLLATERAL => {
                    tok.transfer(&spender, &pool, &req.amount);
                    let cur = pos.collateral.get(idx).unwrap_or(0);
                    pos.collateral.set(idx, cur + req.amount);
                }
                REQ_WITHDRAW_COLLATERAL => {
                    let cur = pos.collateral.get(idx).unwrap_or(0);
                    let amt = if req.amount > cur { cur } else { req.amount };
                    assert!(amt > 0, "nothing to withdraw");
                    Self::set_or_remove(&mut pos.collateral, idx, cur - amt);
                    tok.transfer(&pool, &to, &amt);
                    check_health = true;
                }
                REQ_BORROW => {
                    let cur = pos.liabilities.get(idx).unwrap_or(0);
                    pos.liabilities.set(idx, cur + req.amount);
                    tok.transfer(&pool, &to, &req.amount);
                    check_health = true;
                }
                REQ_REPAY => {
                    // Blend v2 gibi: istenen tutarın tamamı spender'dan çekilir, borçtan fazlası
                    // `to` adresine iade edilir. Böylece spender'ın verdiği transfer yetkisi
                    // tam tutarla eşleşir.
                    let cur = pos.liabilities.get(idx).unwrap_or(0);
                    tok.transfer(&spender, &pool, &req.amount);
                    if req.amount > cur {
                        let refund = req.amount - cur;
                        tok.transfer(&pool, &to, &refund);
                        Self::set_or_remove(&mut pos.liabilities, idx, 0);
                    } else {
                        Self::set_or_remove(&mut pos.liabilities, idx, cur - req.amount);
                    }
                }
                _ => panic!("unsupported request type"),
            }
        }

        if check_health {
            let h = Self::compute_health(&env, &pos);
            assert!(
                h.effective_liabilities == 0 || h.effective_collateral >= h.effective_liabilities,
                "position unhealthy"
            );
        }

        Self::store_positions(&env, &from, &pos);
        pos
    }

    /// Blend ile aynı: kullanıcının pozisyonları (faiz tahakkuk etmiş görünüm).
    pub fn get_positions(env: Env, address: Address) -> Positions {
        Self::accrued_positions(&env, &address)
    }

    // --- HazeCredit'e özgü okuma ---

    pub fn get_health(env: Env, address: Address) -> Health {
        let pos = Self::accrued_positions(&env, &address);
        Self::compute_health(&env, &pos)
    }

    pub fn get_reserves(env: Env) -> Vec<ReserveConfig> {
        env.storage().instance().get(&DataKey::Reserves).unwrap()
    }

    pub fn get_oracle(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Oracle).unwrap()
    }

    // --- iç yardımcılar ---

    fn admin(env: &Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    fn bump(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND);
    }

    fn reserve_index(env: &Env, asset: &Address) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::ResIndex(asset.clone()))
            .expect("unknown reserve")
    }

    fn reserves(env: &Env) -> Vec<ReserveConfig> {
        env.storage().instance().get(&DataKey::Reserves).unwrap()
    }

    fn set_or_remove(map: &mut Map<u32, i128>, idx: u32, value: i128) {
        if value <= 0 {
            map.remove(idx);
        } else {
            map.set(idx, value);
        }
    }

    fn empty_positions(env: &Env) -> Positions {
        Positions {
            liabilities: Map::new(env),
            collateral: Map::new(env),
            supply: Map::new(env),
        }
    }

    /// Saklanan pozisyonu okur ve son tahakkuktan bu yana basit faiz ekler (yazmaz).
    fn accrued_positions(env: &Env, user: &Address) -> Positions {
        let key = DataKey::Pos(user.clone());
        let mut pos: Positions = match env.storage().persistent().get(&key) {
            Some(p) => p,
            None => return Self::empty_positions(env),
        };
        let last: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::Accrued(user.clone()))
            .unwrap_or(env.ledger().timestamp());
        let now = env.ledger().timestamp();
        if now > last && pos.liabilities.len() > 0 {
            let dt = (now - last) as i128;
            let reserves = Self::reserves(env);
            for (idx, amt) in pos.liabilities.iter() {
                let cfg = reserves.get(idx).unwrap();
                let interest =
                    amt * (cfg.borrow_rate_bps as i128) * dt / (10_000 * SECONDS_PER_YEAR);
                pos.liabilities.set(idx, amt + interest);
            }
        }
        pos
    }

    fn store_positions(env: &Env, user: &Address, pos: &Positions) {
        let key = DataKey::Pos(user.clone());
        let akey = DataKey::Accrued(user.clone());
        env.storage().persistent().set(&key, pos);
        env.storage()
            .persistent()
            .set(&akey, &env.ledger().timestamp());
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSIST_TTL_THRESHOLD, PERSIST_TTL_EXTEND);
        env.storage()
            .persistent()
            .extend_ttl(&akey, PERSIST_TTL_THRESHOLD, PERSIST_TTL_EXTEND);
    }

    fn price_of(_env: &Env, oracle: &OracleClient, asset: &Address) -> i128 {
        oracle
            .lastprice(&Asset::Stellar(asset.clone()))
            .expect("no price")
            .price
    }

    fn compute_health(env: &Env, pos: &Positions) -> Health {
        let oracle = OracleClient::new(env, &Self::get_oracle(env.clone()));
        let reserves = Self::reserves(env);
        let mut ec: i128 = 0;
        let mut el: i128 = 0;
        for (idx, amt) in pos.collateral.iter() {
            let cfg = reserves.get(idx).unwrap();
            let value = amt * Self::price_of(env, &oracle, &cfg.asset) / SCALAR_7;
            ec += value * (cfg.c_factor as i128) / SCALAR_7;
        }
        for (idx, amt) in pos.liabilities.iter() {
            let cfg = reserves.get(idx).unwrap();
            let value = amt * Self::price_of(env, &oracle, &cfg.asset) / SCALAR_7;
            el += value * SCALAR_7 / (cfg.l_factor as i128);
        }
        Health {
            effective_collateral: ec,
            effective_liabilities: el,
        }
    }
}

#[cfg(test)]
mod test;
