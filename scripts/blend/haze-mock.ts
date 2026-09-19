/**
 * blend-utils içine kopyalanır: src/v2/testing-scripts/haze-mock.ts
 * mock-example.ts'in Haze uyarlaması:
 *   - BLND + mock USDC (yalnızca comet/backstop için) + Comet LP + oracle + Blend v2 (factory, backstop, emitter)
 *   - "Haze" havuzu: rezervler = testnet.contracts.json'daki HAZE_RESERVES (USDC, hUSDY, hXAU, hNVDA, hSHEL, hBMW; sıra COLLATERAL_CODES)
 *   - Backstop depozitosu (whale = treasury), havuz Active, ödül bölgesi
 *   - Treasury Circle USDC'yi havuza Supply eder (kart borçlarının likiditesi)
 * Çalıştırma: node ./lib/v2/testing-scripts/haze-mock.js haze
 */
import {
  BackstopContractV2,
  EmitterContract,
  I128MAX,
  PoolContractV2,
  Request,
  RequestType,
  ReserveConfigV2,
  ReserveEmissionMetadata,
} from '@blend-capital/blend-sdk';
import { Address, Asset, TransactionBuilder } from '@stellar/stellar-sdk';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { deployBlend } from '../deploy/blend.js';
import { tryDeployStellarAsset } from '../../v1/deploy/stellar-asset.js';
import { setupPool } from '../pool/pool-setup.js';
import { setupReserve } from '../pool/reserve-setup.js';
import { airdropAccount, bumpContractCode, bumpContractInstance, deployContract, installContract } from '../../utils/contract.js';
import { config } from '../../utils/env_config.js';
import { TxParams, invokeSorobanOperation, signWithKeypair } from '../../utils/tx.js';
import { setupPoolBackstop } from './backstop-pool-setup.js';
import { addressBook } from '../../utils/address-book.js';
import { OracleContract } from '../../external/oracle.js';
import { deployCometFactory } from '../../v1/deploy/comet-factory.js';
import { deployComet } from '../../v1/deploy/comet.js';

const txBuilderOptions: TransactionBuilder.TransactionBuilderOptions = {
  fee: '2000000', // 0,2 XLM / op: testnet surge fiyatlamasında 10_000 ile işlem ledger'a girmiyor ve blend-utils sonsuza kadar bekliyor
  timebounds: { minTime: 0, maxTime: 0 },
  networkPassphrase: config.passphrase,
};

const hazeCfg = JSON.parse(readFileSync(process.env.HAZE_CONFIG!, 'utf8'));
const USDC_SAC: string = hazeCfg.assets.USDC.sac;
const SUPPLY_USDC = Number(process.env.HAZE_SUPPLY_USDC ?? 200);
// Rezerv listesi: deploy.sh HAZE_RESERVES=code:sac:priceUsd:c_factor:l_factor:util:max_util;... olarak verir (COLLATERAL_CODES sırası)
const RESERVES = (process.env.HAZE_RESERVES ?? '')
  .split(';')
  .filter(Boolean)
  .map((r) => {
    const [code, sac, priceUsd, c_factor, l_factor, util, max_util] = r.split(':');
    return { code, sac, priceUsd: Number(priceUsd), c_factor: Number(c_factor), l_factor: Number(l_factor), util: Number(util), max_util: Number(max_util) };
  });
if (!USDC_SAC || RESERVES.length === 0 || RESERVES.some((r) => !r.sac)) throw new Error('HAZE_RESERVES / SAC adresleri eksik');
if (RESERVES[0].sac !== USDC_SAC) throw new Error('HAZE_RESERVES ilk rezerv USDC olmalı');

await mock();

export async function mock() {
  const whale = config.getUser('WHALE');
  await airdropAccount(whale);
  await airdropAccount(config.admin);
  const adminTxParams: TxParams = {
    account: await config.rpc.getAccount(config.admin.publicKey()),
    txBuilderOptions,
    signerFunction: async (txXDR: string) => signWithKeypair(txXDR, config.passphrase, config.admin),
  };
  const whaleTxParams: TxParams = {
    account: await config.rpc.getAccount(whale.publicKey()),
    txBuilderOptions,
    signerFunction: async (txXDR: string) => signWithKeypair(txXDR, config.passphrase, whale),
  };

  console.log('Tokens (BLND + backstop mock USDC)…');
  const BLND = await tryDeployStellarAsset(new Asset('BLND', config.admin.publicKey()), adminTxParams);
  const USDC = await tryDeployStellarAsset(new Asset('USDC', config.admin.publicKey()), adminTxParams);

  // BLND / mock USDC daha önce dağıtıldıysa tryDeployStellarAsset simülasyonda düşer ama SDK yerel sıra numarasını
  // yine de artırır; sonraki işlem sıra boşluğuyla gider ve core sessizce düşürür (getTransaction sonsuza kadar NOT_FOUND).
  // Hesabı zincirden yeniden yükleyerek sırayı eşitle.
  adminTxParams.account = await config.rpc.getAccount(config.admin.publicKey());
  whaleTxParams.account = await config.rpc.getAccount(whale.publicKey());

  console.log('Comet…');
  const cometFactory = await deployCometFactory(adminTxParams);
  const null_address = 'GCVJMEUXNIN7BYI4ERWW66ZJNTXRU2AWM65ZDYOODH5ZEZUM7UZXDEAD';
  const cometContract = await deployComet(
    cometFactory,
    adminTxParams,
    [BLND.contractId(), USDC.contractId()],
    [BigInt(0.8e7), BigInt(0.2e7)],
    [BigInt(1000e7), BigInt(25e7)],
    BigInt(0.003e7),
    null_address
  );

  console.log(`Oracle (${RESERVES.map((r) => r.code).join(', ')})…`);
  await installContract('oraclemock', adminTxParams);
  await deployContract('oraclemock', 'oraclemock', adminTxParams);
  await bumpContractCode('oraclemock', adminTxParams);
  await bumpContractInstance('oraclemock', adminTxParams);
  const oracle = new OracleContract(addressBook.getContractId('oraclemock'));
  await invokeSorobanOperation(
    oracle.setData(
      Address.fromString(config.admin.publicKey()),
      { tag: 'Other', values: ['USD'] },
      RESERVES.map((r) => ({ tag: 'Stellar' as const, values: [Address.fromString(r.sac)] as [Address] })),
      7,
      300
    ),
    () => undefined,
    adminTxParams
  );
  await invokeSorobanOperation(
    oracle.setPriceStable(RESERVES.map((r) => BigInt(Math.round(r.priceUsd * 1e7)))),
    () => undefined,
    adminTxParams
  );

  console.log('Blend v2 (factory, backstop, emitter)…');
  const [backstopContract] = await deployBlend(BLND.contractId(), cometContract.contractId(), USDC.contractId(), [], true, adminTxParams);

  console.log('Haze pool…');
  const pool = await setupPool(
    {
      admin: config.admin.publicKey(),
      name: 'Haze',
      salt: randomBytes(32),
      oracle: oracle.contractId(),
      min_collateral: BigInt(0),
      backstop_take_rate: 0.1e7,
      max_positions: 12,
    },
    adminTxParams
  );

  // Rezervler — havuz henüz Setup (6) durumunda olduğu için gecikmesiz. Sıra = COLLATERAL_CODES = oracle sırası.
  for (const [index, r] of RESERVES.entries()) {
    const meta: ReserveConfigV2 = {
      index, decimals: 7,
      c_factor: Math.round(r.c_factor * 1e7), l_factor: Math.round(r.l_factor * 1e7), util: Math.round(r.util * 1e7), max_util: Math.round(r.max_util * 1e7),
      r_base: 1000, r_one: 20_0000, r_two: 50_0000, r_three: 1_000_0000, reactivity: 20, supply_cap: I128MAX, enabled: true,
    };
    await setupReserve(pool.contractId(), { asset: r.sac, metadata: meta }, adminTxParams);
    console.log(`  rezerv ${index} ${r.code} c=${r.c_factor} l=${r.l_factor}`);
  }

  // Emisyon: USDC tedarikçilerine (b_token) %100
  const emissions: ReserveEmissionMetadata[] = [{ res_index: 0, res_type: 1, share: BigInt(1e7) }];
  await invokeSorobanOperation(pool.setEmissionsConfig(emissions), PoolContractV2.parsers.setEmissionsConfig, adminTxParams);

  console.log('Backstop deposit + Active…');
  await setupPoolBackstop(backstopContract.contractId(), pool.contractId(), cometContract.contractId(), BLND.contractId(), USDC.contractId(), adminTxParams, whaleTxParams, adminTxParams);

  console.log('BLND admin → emitter');
  const emitter = new EmitterContract(addressBook.getContractId('emitter'));
  try {
    await invokeSorobanOperation(BLND.set_admin(emitter.contractId()), () => undefined, adminTxParams);
  } catch (e) {
    // BLND önceki dağıtımdan kalmışsa admin'i zaten eski emitter'dadır; emisyon demo için gerekmez.
    console.log('  BLND set_admin atlandı (admin zaten devredilmiş): ' + (e instanceof Error ? e.message : String(e)).slice(0, 120));
  }

  if (SUPPLY_USDC > 0) {
    console.log(`Treasury ${SUPPLY_USDC} Circle USDC → Haze pool (Supply)`);
    const req: Request[] = [{ amount: BigInt(Math.round(SUPPLY_USDC * 1e7)), request_type: RequestType.Supply, address: USDC_SAC }];
    await invokeSorobanOperation(
      pool.submit({ from: whale.publicKey(), spender: whale.publicKey(), to: whale.publicKey(), requests: req }),
      PoolContractV2.parsers.submit,
      whaleTxParams
    );
  }

  const out = {
    poolFactory: addressBook.getContractId('poolFactoryV2'),
    backstop: backstopContract.contractId(),
    emitter: emitter.contractId(),
    blndToken: BLND.contractId(),
    lpToken: cometContract.contractId(),
    pool: pool.contractId(),
    oracle: oracle.contractId(),
  };
  console.log('\nHAZE_BLEND_JSON ' + JSON.stringify(out));
  const { BackstopContractV2: _b } = { BackstopContractV2 };
  void _b;
}
