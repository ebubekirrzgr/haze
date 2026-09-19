use super::*;
use haze_credit::{HazeCredit, HazeCreditClient, Request as PoolRequest, REQ_SUPPLY};
use mock_oracle::{Asset as OAsset, MockOracle, MockOracleClient};
extern crate std;
use soroban_sdk::testutils::{
    Address as _, AuthorizedFunction, Events as _, Ledger as _, MockAuth, MockAuthInvoke,
};
use std::boxed::Box;
use soroban_sdk::{
    token::{Client as TokenClient, StellarAssetClient},
    vec, Env, IntoVal,
};

const T0: u64 = 1_700_000_000;

struct Fx {
    env: Env,
    vault: HazeVaultClient<'static>,
    vault_id: Address,
    pool: HazeCreditClient<'static>,
    pool_id: Address,
    oracle: MockOracleClient<'static>,
    usdc: Address,
    husdy: Address,
    owner: Address,
    operator: Address,
    settlement: Address,
    treasury: Address,
}

fn setup() -> Fx {
    let env = Env::default();
    env.ledger().set_timestamp(T0);
    env.ledger().set_sequence_number(1_000);
    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let operator = Address::generate(&env);
    let settlement = Address::generate(&env);
    let treasury = Address::generate(&env);

    let oracle_id = env.register(MockOracle, (&admin,));
    let oracle = MockOracleClient::new(&env, &oracle_id);
    let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let husdy = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let pool_id = env.register(HazeCredit, (&admin, &oracle_id));
    let pool = HazeCreditClient::new(&env, &pool_id);

    let vault_id = env.register(
        HazeVault,
        (
            &owner,
            &operator,
            &pool_id,
            &usdc,
            &settlement,
            &500_0000000i128, // günlük limit 500 USDC
        ),
    );
    let vault = HazeVaultClient::new(&env, &vault_id);

    // Kurulum işlemleri: admin/hazine için tüm yetkileri mock'la
    env.mock_all_auths();
    StellarAssetClient::new(&env, &usdc).mint(&treasury, &100_000_0000000);
    StellarAssetClient::new(&env, &usdc).mint(&owner, &2_000_0000000);
    StellarAssetClient::new(&env, &husdy).mint(&owner, &500_0000000);
    oracle.set_price(&OAsset::Stellar(usdc.clone()), &1_0000000);
    oracle.set_price(&OAsset::Stellar(husdy.clone()), &1_0200000);
    pool.add_reserve(&usdc, &9_500_000, &9_500_000, &500);
    pool.add_reserve(&husdy, &9_000_000, &1_000_000, &500);
    pool.submit(
        &treasury,
        &treasury,
        &treasury,
        &vec![
            &env,
            PoolRequest {
                request_type: REQ_SUPPLY,
                address: usdc.clone(),
                amount: 50_000_0000000,
            },
        ],
    );
    // Bundan sonra testler kendi yetkilerini açıkça verir
    env.set_auths(&[]);

    Fx {
        env,
        vault,
        vault_id,
        pool,
        pool_id,
        oracle,
        usdc,
        husdy,
        owner,
        operator,
        settlement,
        treasury,
    }
}

/// Sahip imzasıyla deposit: yalnızca owner'ın kendi transferi mock'lanır; havuzun vault'tan
/// çekişi (transfer(vault, pool)) authorize_as_current_contract ile gerçek yetkiyle geçmeli.
fn owner_deposit(f: &Fx, asset: &Address, amount: i128) -> Positions {
    let e = &f.env;
    f.vault
        .mock_auths(&[MockAuth {
            address: &f.owner,
            invoke: &MockAuthInvoke {
                contract: &f.vault_id,
                fn_name: "deposit",
                args: (asset.clone(), amount).into_val(e),
                sub_invokes: &[MockAuthInvoke {
                    contract: asset,
                    fn_name: "transfer",
                    args: (f.owner.clone(), f.vault_id.clone(), amount).into_val(e),
                    sub_invokes: &[],
                }],
            },
        }])
        .deposit(asset, &amount)
}

fn op_auth<'a>(f: &'a Fx, fn_name: &'a str, args: soroban_sdk::Vec<soroban_sdk::Val>) -> MockAuth<'a> {
    MockAuth {
        address: &f.operator,
        invoke: Box::leak(Box::new(MockAuthInvoke {
            contract: &f.vault_id,
            fn_name,
            args,
            sub_invokes: &[],
        })),
    }
}

fn auth_id(env: &Env, n: u8) -> BytesN<32> {
    BytesN::from_array(env, &[n; 32])
}

#[test]
fn deposit_supplies_collateral_with_real_contract_auth() {
    let f = setup();
    let pos = owner_deposit(&f, &f.usdc, 1_000_0000000);
    assert_eq!(pos.collateral.get(0), Some(1_000_0000000));
    // owner'ın yetkisi gerçekten istendi (auths() son çağrıya aittir)
    let auths = f.env.auths();
    assert!(auths.iter().any(|(addr, inv)| addr == &f.owner
        && matches!(&inv.function, AuthorizedFunction::Contract((c, name, _)) if c == &f.vault_id && name == &Symbol::new(&f.env, "deposit"))));
    let pos = owner_deposit(&f, &f.husdy, 500_0000000);
    assert_eq!(pos.collateral.get(1), Some(500_0000000));
    // Havuz tokenleri tutuyor, vault'ta idle bakiye yok
    assert_eq!(TokenClient::new(&f.env, &f.usdc).balance(&f.vault_id), 0);
    assert_eq!(
        TokenClient::new(&f.env, &f.usdc).balance(&f.pool_id),
        51_000_0000000
    );
}

#[test]
#[should_panic]
fn deposit_without_owner_auth_fails() {
    let f = setup();
    f.vault.deposit(&f.usdc, &1_000_0000000);
}

#[test]
fn card_borrow_moves_usdc_to_settlement_and_tracks_daily_spend() {
    let f = setup();
    let e = &f.env;
    owner_deposit(&f, &f.usdc, 1_000_0000000);
    owner_deposit(&f, &f.husdy, 500_0000000);

    let usdc = TokenClient::new(e, &f.usdc);
    let a1 = auth_id(e, 1);
    let pos = f
        .vault
        .mock_auths(&[op_auth(&f, "borrow_for_card", (12_5000000i128, a1.clone()).into_val(e))])
        .borrow_for_card(&12_5000000, &a1);
    // event yayınlandı (events().all() son çağrıya aittir)
    let evs = e.events().all();
    assert!(!evs.filter_by_contract(&f.vault_id).events().is_empty());
    assert_eq!(pos.liabilities.get(0), Some(12_5000000));
    assert_eq!(usdc.balance(&f.settlement), 12_5000000);
    assert_eq!(usdc.balance(&f.vault_id), 0);
    // teminat değişmedi
    assert_eq!(pos.collateral.get(0), Some(1_000_0000000));
    assert_eq!(pos.collateral.get(1), Some(500_0000000));

    let st = f.vault.card_state();
    assert_eq!(st.spent_today, 12_5000000);
    assert_eq!(st.daily_limit, 500_0000000);
    assert!(!st.frozen);
    assert_eq!(f.vault.auth_amount(&a1), Some(12_5000000));

    // ertesi gün sayaç sıfırlanır
    e.ledger().set_timestamp(T0 + 86_400);
    assert_eq!(f.vault.card_state().spent_today, 0);
}

#[test]
#[should_panic(expected = "auth already processed")]
fn card_borrow_is_idempotent() {
    let f = setup();
    let e = &f.env;
    owner_deposit(&f, &f.usdc, 1_000_0000000);
    let a1 = auth_id(e, 1);
    let args: soroban_sdk::Vec<soroban_sdk::Val> = (10_0000000i128, a1.clone()).into_val(e);
    f.vault
        .mock_auths(&[op_auth(&f, "borrow_for_card", args.clone())])
        .borrow_for_card(&10_0000000, &a1);
    f.vault
        .mock_auths(&[op_auth(&f, "borrow_for_card", args)])
        .borrow_for_card(&10_0000000, &a1);
}

#[test]
#[should_panic(expected = "daily limit exceeded")]
fn card_borrow_respects_daily_limit() {
    let f = setup();
    let e = &f.env;
    owner_deposit(&f, &f.usdc, 1_000_0000000);
    let a1 = auth_id(e, 1);
    f.vault
        .mock_auths(&[op_auth(&f, "borrow_for_card", (400_0000000i128, a1.clone()).into_val(e))])
        .borrow_for_card(&400_0000000, &a1);
    let a2 = auth_id(e, 2);
    f.vault
        .mock_auths(&[op_auth(&f, "borrow_for_card", (150_0000000i128, a2.clone()).into_val(e))])
        .borrow_for_card(&150_0000000, &a2);
}

#[test]
#[should_panic(expected = "card frozen")]
fn frozen_card_rejects_borrow() {
    let f = setup();
    let e = &f.env;
    owner_deposit(&f, &f.usdc, 1_000_0000000);
    f.vault
        .mock_auths(&[MockAuth {
            address: &f.owner,
            invoke: &MockAuthInvoke {
                contract: &f.vault_id,
                fn_name: "set_frozen",
                args: (true,).into_val(e),
                sub_invokes: &[],
            },
        }])
        .set_frozen(&true);
    assert!(f.vault.card_state().frozen);
    let a1 = auth_id(e, 1);
    f.vault
        .mock_auths(&[op_auth(&f, "borrow_for_card", (10_0000000i128, a1.clone()).into_val(e))])
        .borrow_for_card(&10_0000000, &a1);
}

#[test]
#[should_panic(expected = "position unhealthy")]
fn card_borrow_beyond_collateral_reverts_in_pool() {
    let f = setup();
    let e = &f.env;
    owner_deposit(&f, &f.usdc, 100_0000000);
    let a1 = auth_id(e, 1);
    f.vault
        .mock_auths(&[op_auth(&f, "borrow_for_card", (99_0000000i128, a1.clone()).into_val(e))])
        .borrow_for_card(&99_0000000, &a1);
}

#[test]
#[should_panic]
fn owner_cannot_call_operator_function() {
    let f = setup();
    let e = &f.env;
    owner_deposit(&f, &f.usdc, 1_000_0000000);
    let a1 = auth_id(e, 1);
    f.vault
        .mock_auths(&[MockAuth {
            address: &f.owner,
            invoke: &MockAuthInvoke {
                contract: &f.vault_id,
                fn_name: "borrow_for_card",
                args: (10_0000000i128, a1.clone()).into_val(e),
                sub_invokes: &[],
            },
        }])
        .borrow_for_card(&10_0000000, &a1);
}

#[test]
#[should_panic]
fn operator_cannot_withdraw() {
    let f = setup();
    let e = &f.env;
    owner_deposit(&f, &f.usdc, 1_000_0000000);
    f.vault
        .mock_auths(&[op_auth(&f, "withdraw", (f.usdc.clone(), 10_0000000i128).into_val(e))])
        .withdraw(&f.usdc, &10_0000000);
}

#[test]
fn salary_settles_debt_and_collateralizes_rest() {
    let f = setup();
    let e = &f.env;
    owner_deposit(&f, &f.usdc, 1_000_0000000);
    let a1 = auth_id(e, 1);
    f.vault
        .mock_auths(&[op_auth(&f, "borrow_for_card", (120_0000000i128, a1.clone()).into_val(e))])
        .borrow_for_card(&120_0000000, &a1);

    // Sahip vault'a süreli allowance verir (maaş 300 USDC)
    let usdc = TokenClient::new(e, &f.usdc);
    usdc.mock_all_auths()
        .approve(&f.owner, &f.vault_id, &300_0000000, &(e.ledger().sequence() + 10_000));
    e.set_auths(&[]);

    // haze-api güncel borcu okur ve settle_salary çağırır
    let debt = f.pool.get_positions(&f.vault_id).liabilities.get(0).unwrap();
    assert_eq!(debt, 120_0000000);
    let pos = f
        .vault
        .mock_auths(&[op_auth(&f, "settle_salary", (300_0000000i128, debt).into_val(e))])
        .settle_salary(&300_0000000, &debt);
    assert_eq!(pos.liabilities.get(0), None);
    assert_eq!(pos.collateral.get(0), Some(1_180_0000000));
    assert_eq!(usdc.balance(&f.vault_id), 0);
    assert_eq!(usdc.balance(&f.owner), 2_000_0000000 - 1_000_0000000 - 300_0000000);
}

#[test]
fn salary_with_no_debt_goes_straight_to_collateral() {
    let f = setup();
    let e = &f.env;
    owner_deposit(&f, &f.usdc, 100_0000000);
    let usdc = TokenClient::new(e, &f.usdc);
    usdc.mock_all_auths()
        .approve(&f.owner, &f.vault_id, &300_0000000, &(e.ledger().sequence() + 10_000));
    e.set_auths(&[]);
    let pos = f
        .vault
        .mock_auths(&[op_auth(&f, "settle_salary", (250_0000000i128, 0i128).into_val(e))])
        .settle_salary(&250_0000000, &0);
    assert_eq!(pos.collateral.get(0), Some(350_0000000));
}

#[test]
fn salary_repay_amount_overstated_is_capped_by_pool() {
    // API'nin okuduğu borç, faiz nedeniyle zincirdekinden farklı olabilir; havuz fazlasını almaz
    let f = setup();
    let e = &f.env;
    owner_deposit(&f, &f.usdc, 1_000_0000000);
    let a1 = auth_id(e, 1);
    f.vault
        .mock_auths(&[op_auth(&f, "borrow_for_card", (50_0000000i128, a1.clone()).into_val(e))])
        .borrow_for_card(&50_0000000, &a1);
    let usdc = TokenClient::new(e, &f.usdc);
    usdc.mock_all_auths()
        .approve(&f.owner, &f.vault_id, &300_0000000, &(e.ledger().sequence() + 10_000));
    e.set_auths(&[]);
    let pos = f
        .vault
        .mock_auths(&[op_auth(&f, "settle_salary", (200_0000000i128, 80_0000000i128).into_val(e))])
        .settle_salary(&200_0000000, &80_0000000);
    assert_eq!(pos.liabilities.get(0), None);
    assert_eq!(pos.collateral.get(0), Some(1_150_0000000));
}

#[test]
fn owner_withdraw_and_borrow() {
    let f = setup();
    let e = &f.env;
    owner_deposit(&f, &f.usdc, 1_000_0000000);
    owner_deposit(&f, &f.husdy, 500_0000000);
    let husdy = TokenClient::new(e, &f.husdy);
    let usdc = TokenClient::new(e, &f.usdc);

    // Teminattan çek (altın/hUSDY satarak nakde çevirme modu)
    let pos = f
        .vault
        .mock_auths(&[MockAuth {
            address: &f.owner,
            invoke: &MockAuthInvoke {
                contract: &f.vault_id,
                fn_name: "withdraw",
                args: (f.husdy.clone(), 200_0000000i128).into_val(e),
                sub_invokes: &[],
            },
        }])
        .withdraw(&f.husdy, &200_0000000);
    assert_eq!(pos.collateral.get(1), Some(300_0000000));
    assert_eq!(husdy.balance(&f.owner), 200_0000000);

    // Satmadan çek (borçla)
    let before = usdc.balance(&f.owner);
    let pos = f
        .vault
        .mock_auths(&[MockAuth {
            address: &f.owner,
            invoke: &MockAuthInvoke {
                contract: &f.vault_id,
                fn_name: "borrow",
                args: (150_0000000i128,).into_val(e),
                sub_invokes: &[],
            },
        }])
        .borrow(&150_0000000);
    assert_eq!(pos.liabilities.get(0), Some(150_0000000));
    assert_eq!(usdc.balance(&f.owner) - before, 150_0000000);

    // Sahip borcu öder
    let pos = f
        .vault
        .mock_auths(&[MockAuth {
            address: &f.owner,
            invoke: &MockAuthInvoke {
                contract: &f.vault_id,
                fn_name: "repay",
                args: (150_0000000i128,).into_val(e),
                sub_invokes: &[MockAuthInvoke {
                    contract: &f.usdc,
                    fn_name: "transfer",
                    args: (f.owner.clone(), f.vault_id.clone(), 150_0000000i128).into_val(e),
                    sub_invokes: &[],
                }],
            },
        }])
        .repay(&150_0000000);
    assert_eq!(pos.liabilities.get(0), None);
}

#[test]
fn refund_repays_from_returned_usdc() {
    let f = setup();
    let e = &f.env;
    owner_deposit(&f, &f.usdc, 1_000_0000000);
    let a1 = auth_id(e, 1);
    f.vault
        .mock_auths(&[op_auth(&f, "borrow_for_card", (40_0000000i128, a1.clone()).into_val(e))])
        .borrow_for_card(&40_0000000, &a1);
    assert_eq!(f.vault.card_state().spent_today, 40_0000000);

    // Takas hazinesi USDC'yi vault'a iade eder (void)
    let usdc = TokenClient::new(e, &f.usdc);
    usdc.mock_all_auths()
        .transfer(&f.settlement, &f.vault_id, &40_0000000);
    e.set_auths(&[]);

    let pos = f
        .vault
        .mock_auths(&[op_auth(&f, "refund_for_card", (40_0000000i128, a1.clone()).into_val(e))])
        .refund_for_card(&40_0000000, &a1);
    assert_eq!(pos.liabilities.get(0), None);
    assert_eq!(pos.collateral.get(0), Some(1_000_0000000));
    assert_eq!(f.vault.card_state().spent_today, 0);
    assert_eq!(f.vault.auth_amount(&a1), Some(0));
    let _ = (&f.oracle, &f.treasury);
}

#[test]
fn positions_view_reads_pool() {
    let f = setup();
    owner_deposit(&f, &f.usdc, 10_0000000);
    let pos = f.vault.positions();
    assert_eq!(pos.collateral.get(0), Some(10_0000000));
    assert_eq!(f.vault.get_config().owner, f.owner);
}

#[test]
fn owner_can_borrow_and_repay_any_reserve() {
    // Fiat rezerv modeli: hUSDY havuzda borç alınabilir (l_factor 0,1); sahip USDC teminatına karşı hUSDY borçlanır.
    let f = setup();
    let e = &f.env;
    // Havuza borç verilecek hUSDY likiditesi (fiat rezervlerde hazine sağlar)
    e.mock_all_auths();
    StellarAssetClient::new(e, &f.husdy).mint(&f.treasury, &1_000_0000000);
    f.pool.submit(
        &f.treasury,
        &f.treasury,
        &f.treasury,
        &vec![e, PoolRequest { request_type: REQ_SUPPLY, address: f.husdy.clone(), amount: 1_000_0000000 }],
    );
    e.set_auths(&[]);
    owner_deposit(&f, &f.usdc, 1_000_0000000);
    let husdy = TokenClient::new(e, &f.husdy);
    let before = husdy.balance(&f.owner);

    let pos = f
        .vault
        .mock_auths(&[MockAuth {
            address: &f.owner,
            invoke: &MockAuthInvoke {
                contract: &f.vault_id,
                fn_name: "borrow_asset",
                args: (f.husdy.clone(), 20_0000000i128).into_val(e),
                sub_invokes: &[],
            },
        }])
        .borrow_asset(&f.husdy, &20_0000000);
    assert_eq!(pos.liabilities.get(1), Some(20_0000000));
    assert_eq!(husdy.balance(&f.owner) - before, 20_0000000);

    // Fazlasıyla öde: havuz yalnızca borcu alır, artan sahibe döner
    let pos = f
        .vault
        .mock_auths(&[MockAuth {
            address: &f.owner,
            invoke: &MockAuthInvoke {
                contract: &f.vault_id,
                fn_name: "repay_asset",
                args: (f.husdy.clone(), 25_0000000i128).into_val(e),
                sub_invokes: &[MockAuthInvoke {
                    contract: &f.husdy,
                    fn_name: "transfer",
                    args: (f.owner.clone(), f.vault_id.clone(), 25_0000000i128).into_val(e),
                    sub_invokes: &[],
                }],
            },
        }])
        .repay_asset(&f.husdy, &25_0000000);
    assert_eq!(pos.liabilities.get(1).unwrap_or(0), 0);
    assert_eq!(husdy.balance(&f.owner), before);
    assert_eq!(husdy.balance(&f.vault_id), 0);
}

