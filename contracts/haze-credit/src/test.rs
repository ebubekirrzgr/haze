use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token::StellarAssetClient, vec, Env};

struct Fx {
    env: Env,
    pool: HazeCreditClient<'static>,
    oracle: mock_oracle::MockOracleClient<'static>,
    usdc: Address,
    husdy: Address,
    treasury: Address,
    user: Address,
}

fn setup() -> Fx {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_700_000_000);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let user = Address::generate(&env);

    let oracle_id = env.register(mock_oracle::MockOracle, (&admin,));
    let oracle = mock_oracle::MockOracleClient::new(&env, &oracle_id);

    let usdc = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let husdy = env.register_stellar_asset_contract_v2(admin.clone()).address();
    StellarAssetClient::new(&env, &usdc).mint(&treasury, &100_000_0000000);
    StellarAssetClient::new(&env, &usdc).mint(&user, &1_000_0000000);
    StellarAssetClient::new(&env, &husdy).mint(&user, &500_0000000);

    oracle.set_price(&mock_oracle::Asset::Stellar(usdc.clone()), &1_0000000);
    oracle.set_price(&mock_oracle::Asset::Stellar(husdy.clone()), &1_0200000);

    let pool_id = env.register(HazeCredit, (&admin, &oracle_id));
    let pool = HazeCreditClient::new(&env, &pool_id);
    // USDC: c 0.95, l 0.95, %5 faiz ; hUSDY: c 0.90, l 0.10
    assert_eq!(pool.add_reserve(&usdc, &9_500_000, &9_500_000, &500), 0);
    assert_eq!(pool.add_reserve(&husdy, &9_000_000, &1_000_000, &500), 1);

    // Hazine likidite sağlar
    pool.submit(
        &treasury,
        &treasury,
        &treasury,
        &vec![
            &env,
            Request {
                request_type: REQ_SUPPLY,
                address: usdc.clone(),
                amount: 50_000_0000000,
            },
        ],
    );
    Fx {
        env,
        pool,
        oracle,
        usdc,
        husdy,
        treasury,
        user,
    }
}

fn req(t: u32, a: &Address, amt: i128) -> Request {
    Request {
        request_type: t,
        address: a.clone(),
        amount: amt,
    }
}

#[test]
fn collateral_borrow_repay_flow() {
    let f = setup();
    let e = &f.env;
    // Belgedeki örnek: 1.000 USDC + 500 hUSDY (1,02) teminat
    let pos = f.pool.submit(
        &f.user,
        &f.user,
        &f.user,
        &vec![
            e,
            req(REQ_SUPPLY_COLLATERAL, &f.usdc, 1_000_0000000),
            req(REQ_SUPPLY_COLLATERAL, &f.husdy, 500_0000000),
        ],
    );
    assert_eq!(pos.collateral.get(0), Some(1_000_0000000));
    assert_eq!(pos.collateral.get(1), Some(500_0000000));
    let h = f.pool.get_health(&f.user);
    // EC = 950 + 510*0.9 = 1409
    assert_eq!(h.effective_collateral, 1_409_0000000);
    assert_eq!(h.effective_liabilities, 0);

    // 450 USDC borç al → hesaba geldi
    let usdc = token::Client::new(e, &f.usdc);
    let before = usdc.balance(&f.user);
    let pos = f.pool.submit(
        &f.user,
        &f.user,
        &f.user,
        &vec![e, req(REQ_BORROW, &f.usdc, 450_0000000)],
    );
    assert_eq!(pos.liabilities.get(0), Some(450_0000000));
    assert_eq!(usdc.balance(&f.user) - before, 450_0000000);
    let h = f.pool.get_health(&f.user);
    // EL = 450 / 0.95
    assert_eq!(h.effective_liabilities, 450_0000000 * SCALAR_7 / 9_500_000);

    // Fazla geri ödeme: tamamı çekilir, borçtan fazlası `to`ya iade edilir (Blend v2 davranışı)
    StellarAssetClient::new(e, &f.usdc).mint(&f.user, &1_000_0000000);
    let before = usdc.balance(&f.user);
    let pos = f.pool.submit(
        &f.user,
        &f.user,
        &f.user,
        &vec![e, req(REQ_REPAY, &f.usdc, 600_0000000)],
    );
    assert_eq!(pos.liabilities.get(0), None);
    assert_eq!(before - usdc.balance(&f.user), 450_0000000);
}

#[test]
#[should_panic(expected = "position unhealthy")]
fn borrow_beyond_limit_reverts() {
    let f = setup();
    let e = &f.env;
    f.pool.submit(
        &f.user,
        &f.user,
        &f.user,
        &vec![
            e,
            req(REQ_SUPPLY_COLLATERAL, &f.usdc, 1_000_0000000),
            req(REQ_BORROW, &f.usdc, 960_0000000), // limit ~ 902
        ],
    );
}

#[test]
#[should_panic(expected = "position unhealthy")]
fn withdraw_collateral_under_debt_reverts() {
    let f = setup();
    let e = &f.env;
    f.pool.submit(
        &f.user,
        &f.user,
        &f.user,
        &vec![
            e,
            req(REQ_SUPPLY_COLLATERAL, &f.usdc, 1_000_0000000),
            req(REQ_BORROW, &f.usdc, 800_0000000),
        ],
    );
    f.pool.submit(
        &f.user,
        &f.user,
        &f.user,
        &vec![e, req(REQ_WITHDRAW_COLLATERAL, &f.usdc, 500_0000000)],
    );
}

#[test]
fn interest_accrues_over_time() {
    let f = setup();
    let e = &f.env;
    f.pool.submit(
        &f.user,
        &f.user,
        &f.user,
        &vec![
            e,
            req(REQ_SUPPLY_COLLATERAL, &f.usdc, 1_000_0000000),
            req(REQ_BORROW, &f.usdc, 400_0000000),
        ],
    );
    // bir yıl ileri: %5 → 420
    e.ledger().set_timestamp(1_700_000_000 + 31_536_000);
    let pos = f.pool.get_positions(&f.user);
    assert_eq!(pos.liabilities.get(0), Some(420_0000000));
    // sonraki submit tahakkuku yazar
    let pos = f.pool.submit(
        &f.user,
        &f.user,
        &f.user,
        &vec![e, req(REQ_REPAY, &f.usdc, 20_0000000)],
    );
    assert_eq!(pos.liabilities.get(0), Some(400_0000000));
}

#[test]
fn price_change_moves_limit() {
    let f = setup();
    let e = &f.env;
    f.pool.submit(
        &f.user,
        &f.user,
        &f.user,
        &vec![e, req(REQ_SUPPLY_COLLATERAL, &f.husdy, 500_0000000)],
    );
    let h1 = f.pool.get_health(&f.user).effective_collateral;
    f.oracle
        .set_price(&mock_oracle::Asset::Stellar(f.husdy.clone()), &1_1000000);
    let h2 = f.pool.get_health(&f.user).effective_collateral;
    assert!(h2 > h1);
    assert_eq!(h2, 550_0000000 * 9_000_000 / SCALAR_7);
}

#[test]
fn treasury_can_withdraw_supply() {
    let f = setup();
    let e = &f.env;
    let usdc = token::Client::new(e, &f.usdc);
    let before = usdc.balance(&f.treasury);
    let pos = f.pool.submit(
        &f.treasury,
        &f.treasury,
        &f.treasury,
        &vec![e, req(REQ_WITHDRAW, &f.usdc, 1_000_0000000)],
    );
    assert_eq!(pos.supply.get(0), Some(49_000_0000000));
    assert_eq!(usdc.balance(&f.treasury) - before, 1_000_0000000);
}
