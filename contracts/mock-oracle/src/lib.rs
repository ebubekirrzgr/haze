//! MockOracle — Blend'in PriceFeed arayüzüyle uyumlu, admin'in fiyat yazdığı basit oracle.
//!
//! Blend havuzu `lastprice(Asset) -> Option<PriceData>` ve `decimals()` çağırır.
//! HazeCredit (yedek havuz) da aynı arayüzü kullanır; böylece fiyat botu tek kontrata yazar.
//! Tüm fiyatlar 7 ondalık (USDC = 1_0000000).
#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Vec};

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

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Price(Asset),
    Assets,
}

pub const DECIMALS: u32 = 7;
const INSTANCE_TTL_THRESHOLD: u32 = 17280 * 7;
const INSTANCE_TTL_EXTEND: u32 = 17280 * 30;

#[contract]
pub struct MockOracle;

#[contractimpl]
impl MockOracle {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::Assets, &Vec::<Asset>::new(&env));
    }

    /// Fiyat yaz (admin). price 7 ondalıklı.
    pub fn set_price(env: Env, asset: Asset, price: i128) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        assert!(price > 0, "price must be positive");
        Self::bump(&env);
        let data = PriceData {
            price,
            timestamp: env.ledger().timestamp(),
        };
        env.storage()
            .instance()
            .set(&DataKey::Price(asset.clone()), &data);
        let mut assets: Vec<Asset> = env.storage().instance().get(&DataKey::Assets).unwrap();
        if !assets.contains(&asset) {
            assets.push_back(asset);
            env.storage().instance().set(&DataKey::Assets, &assets);
        }
    }

    /// Toplu fiyat yazımı (fiyat botu tek işlemle günceller).
    pub fn set_prices(env: Env, assets: Vec<Asset>, prices: Vec<i128>) {
        assert!(assets.len() == prices.len(), "length mismatch");
        for i in 0..assets.len() {
            Self::set_price(env.clone(), assets.get(i).unwrap(), prices.get(i).unwrap());
        }
    }

    // --- Blend PriceFeed arayüzü ---

    pub fn lastprice(env: Env, asset: Asset) -> Option<PriceData> {
        env.storage().instance().get(&DataKey::Price(asset))
    }

    pub fn decimals(_env: Env) -> u32 {
        DECIMALS
    }

    pub fn assets(env: Env) -> Vec<Asset> {
        env.storage().instance().get(&DataKey::Assets).unwrap()
    }

    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    fn bump(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND);
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn set_and_read_price() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let id = env.register(MockOracle, (&admin,));
        let c = MockOracleClient::new(&env, &id);
        let usdc = Address::generate(&env);
        c.set_price(&Asset::Stellar(usdc.clone()), &1_0000000);
        let p = c.lastprice(&Asset::Stellar(usdc.clone())).unwrap();
        assert_eq!(p.price, 1_0000000);
        assert_eq!(c.decimals(), 7);
        assert_eq!(c.assets().len(), 1);
        assert!(c.lastprice(&Asset::Other(Symbol::new(&env, "XAU"))).is_none());
    }
}
