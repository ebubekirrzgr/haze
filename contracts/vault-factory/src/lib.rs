//! VaultFactory — kullanıcı başına deterministik HazeVault deploy eder.
//!
//! salt = sha256(owner XDR) olduğu için haze-api vault adresini zincire sormadan hesaplayabilir
//! (`vault_address`). Operatör, havuz, USDC ve takas hazinesi factory'de tutulur; havuz
//! Blend'den HazeCredit'e (yedek plan) admin tarafından değiştirilebilir — yeni vault'lar yeni
//! havuzu kullanır.
#![no_std]

use soroban_sdk::{contract, contractevent, contractimpl, contracttype, xdr::ToXdr, Address, BytesN, Env};

const INSTANCE_TTL_THRESHOLD: u32 = 17280 * 7;
const INSTANCE_TTL_EXTEND: u32 = 17280 * 30;

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct FactoryConfig {
    pub admin: Address,
    pub vault_wasm_hash: BytesN<32>,
    pub operator: Address,
    pub pool: Address,
    pub usdc: Address,
    pub settlement: Address,
    pub default_daily_limit: i128,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    Vault(Address),
}

#[contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct VaultCreated {
    #[topic]
    pub owner: Address,
    pub vault: Address,
}

#[contract]
pub struct VaultFactory;

#[contractimpl]
impl VaultFactory {
    pub fn __constructor(
        env: Env,
        admin: Address,
        vault_wasm_hash: BytesN<32>,
        operator: Address,
        pool: Address,
        usdc: Address,
        settlement: Address,
        default_daily_limit: i128,
    ) {
        env.storage().instance().set(
            &DataKey::Config,
            &FactoryConfig {
                admin,
                vault_wasm_hash,
                operator,
                pool,
                usdc,
                settlement,
                default_daily_limit,
            },
        );
    }

    /// Sahip için vault deploy eder (sahip imzası gerekir; onboarding işleminde kullanıcı imzalar,
    /// sponsor ücreti öder). Zaten varsa mevcut adresi döner.
    pub fn create_vault(env: Env, owner: Address, daily_limit: Option<i128>) -> Address {
        owner.require_auth();
        Self::bump(&env);
        if let Some(existing) = env
            .storage()
            .persistent()
            .get::<DataKey, Address>(&DataKey::Vault(owner.clone()))
        {
            return existing;
        }
        let cfg = Self::config(&env);
        let limit = daily_limit.unwrap_or(cfg.default_daily_limit);
        let salt = Self::salt_for(&env, &owner);
        let vault = env.deployer().with_current_contract(salt).deploy_contract(
            soroban_sdk::ContractExecutable::Wasm(cfg.vault_wasm_hash.clone()),
            (
                owner.clone(),
                cfg.operator.clone(),
                cfg.pool.clone(),
                cfg.usdc.clone(),
                cfg.settlement.clone(),
                limit,
            ),
        );
        env.storage()
            .persistent()
            .set(&DataKey::Vault(owner.clone()), &vault);
        env.storage().persistent().extend_ttl(
            &DataKey::Vault(owner.clone()),
            INSTANCE_TTL_THRESHOLD,
            INSTANCE_TTL_EXTEND,
        );
        VaultCreated {
            owner,
            vault: vault.clone(),
        }
        .publish(&env);
        vault
    }

    /// Deterministik vault adresi (deploy edilmemiş olsa da hesaplanır).
    pub fn vault_address(env: Env, owner: Address) -> Address {
        let salt = Self::salt_for(&env, &owner);
        env.deployer()
            .with_current_contract(salt)
            .deployed_address()
    }

    /// Deploy edilmiş vault (yoksa None).
    pub fn get_vault(env: Env, owner: Address) -> Option<Address> {
        env.storage().persistent().get(&DataKey::Vault(owner))
    }

    pub fn get_config(env: Env) -> FactoryConfig {
        Self::config(&env)
    }

    // --- admin ---

    pub fn set_pool(env: Env, pool: Address) {
        let mut cfg = Self::config(&env);
        cfg.admin.require_auth();
        cfg.pool = pool;
        env.storage().instance().set(&DataKey::Config, &cfg);
    }

    pub fn set_vault_wasm_hash(env: Env, hash: BytesN<32>) {
        let mut cfg = Self::config(&env);
        cfg.admin.require_auth();
        cfg.vault_wasm_hash = hash;
        env.storage().instance().set(&DataKey::Config, &cfg);
    }

    pub fn set_operator(env: Env, operator: Address) {
        let mut cfg = Self::config(&env);
        cfg.admin.require_auth();
        cfg.operator = operator;
        env.storage().instance().set(&DataKey::Config, &cfg);
    }

    pub fn set_settlement(env: Env, settlement: Address) {
        let mut cfg = Self::config(&env);
        cfg.admin.require_auth();
        cfg.settlement = settlement;
        env.storage().instance().set(&DataKey::Config, &cfg);
    }

    // --- iç ---

    fn config(env: &Env) -> FactoryConfig {
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    fn bump(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND);
    }

    fn salt_for(env: &Env, owner: &Address) -> BytesN<32> {
        env.crypto().sha256(&owner.clone().to_xdr(env)).into()
    }
}

#[cfg(test)]
mod test {
    extern crate std;
    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn setup(env: &Env) -> (VaultFactoryClient<'_>, Address) {
        let admin = Address::generate(env);
        let id = env.register(
            VaultFactory,
            (
                &admin,
                &BytesN::from_array(env, &[7u8; 32]),
                &Address::generate(env),
                &Address::generate(env),
                &Address::generate(env),
                &Address::generate(env),
                &500_0000000i128,
            ),
        );
        (VaultFactoryClient::new(env, &id), admin)
    }

    #[test]
    fn vault_address_is_deterministic_per_owner() {
        let env = Env::default();
        let (f, _) = setup(&env);
        let a = Address::generate(&env);
        let b = Address::generate(&env);
        assert_eq!(f.vault_address(&a), f.vault_address(&a));
        assert_ne!(f.vault_address(&a), f.vault_address(&b));
        assert!(f.get_vault(&a).is_none());
    }

    #[test]
    fn admin_can_switch_pool() {
        let env = Env::default();
        env.mock_all_auths();
        let (f, _) = setup(&env);
        let new_pool = Address::generate(&env);
        f.set_pool(&new_pool);
        assert_eq!(f.get_config().pool, new_pool);
    }

    /// Gerçek deploy testi wasm gerektirir; `contracts:build` sonrası fixture ile koşar.
    #[test]
    #[ignore]
    fn create_vault_deploys_with_fixture_wasm() {
        let env = Env::default();
        env.mock_all_auths();
        let wasm = std::fs::read("../../target/wasm32v1-none/release/haze_vault.wasm")
            .expect("önce `pnpm contracts:build`");
        let hash = env.deployer().upload_contract_wasm(soroban_sdk::Bytes::from_slice(&env, &wasm));
        let admin = Address::generate(&env);
        let id = env.register(
            VaultFactory,
            (
                &admin,
                &hash,
                &Address::generate(&env),
                &Address::generate(&env),
                &Address::generate(&env),
                &Address::generate(&env),
                &500_0000000i128,
            ),
        );
        let f = VaultFactoryClient::new(&env, &id);
        let owner = Address::generate(&env);
        let v = f.create_vault(&owner, &None);
        assert_eq!(v, f.vault_address(&owner));
        assert_eq!(f.get_vault(&owner), Some(v.clone()));
        // ikinci çağrı aynı adresi döner
        assert_eq!(f.create_vault(&owner, &None), v);
    }
}
