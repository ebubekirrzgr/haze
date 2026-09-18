/**
 * blend-utils içine kopyalanır: src/v2/testing-scripts/haze-mock.ts
 * mock-example.ts'in Haze uyarlaması:
 *   - BLND + mock USDC (yalnızca comet/backstop için) + Comet LP + oracle + Blend v2 (factory, backstop, emitter)
 *   - "Haze" havuzu: rezervler = Circle testnet USDC SAC, hUSDY SAC, hXAU SAC (testnet.contracts.json'dan)
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
  fee: '10000',
  timebounds: { minTime: 0, maxTime: 0 },
  networkPassphrase: config.passphrase,
};

const hazeCfg = JSON.parse(readFileSync(process.env.HAZE_CONFIG!, 'utf8'));
const USDC_SAC: string = hazeCfg.assets.USDC.sac;
const HUSDY_SAC: string = hazeCfg.assets.hUSDY.sac;
const HXAU_SAC: string = hazeCfg.assets.hXAU.sac;
const XAU_USD = Number(process.env.XAU_USD ?? 2400);
const SUPPLY_USDC = Number(process.env.HAZE_SUPPLY_USDC ?? 200);
if (!USDC_SAC || !HUSDY_SAC || !HXAU_SAC) throw new Error('testnet.contracts.json içinde SAC adresleri eksik');

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

  console.log('Oracle (Circle USDC, hUSDY, hXAU)…');
  await installContract('oraclemock', adminTxParams);
  await deployContract('oraclemock', 'oraclemock', adminTxParams);
  await bumpContractCode('oraclemock', adminTxParams);
  await bumpContractInstance('oraclemock', adminTxParams);
  const oracle = new OracleContract(addressBook.getContractId('oraclemock'));
  await invokeSorobanOperation(
    oracle.setData(
      Address.fromString(config.admin.publicKey()),
      { tag: 'Other', values: ['USD'] },
      [
        { tag: 'Stellar', values: [Address.fromString(USDC_SAC)] },
        { tag: 'Stellar', values: [Address.fromString(HUSDY_SAC)] },
        { tag: 'Stellar', values: [Address.fromString(HXAU_SAC)] },
      ],
      7,
      300
    ),
    () => undefined,
    adminTxParams
  );
  await invokeSorobanOperation(
    oracle.setPriceStable([BigInt(1e7), BigInt(1e7), BigInt(Math.round(XAU_USD * 1e7))]),
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
      max_positions: 8,
    },
    adminTxParams
  );

  // Rezervler — havuz henüz Setup (6) durumunda olduğu için gecikmesiz.
  const usdcReserve: ReserveConfigV2 = {
    index: 0, decimals: 7, c_factor: 950_0000, l_factor: 950_0000, util: 800_0000, max_util: 950_0000,
    r_base: 1000, r_one: 20_0000, r_two: 50_0000, r_three: 1_000_0000, reactivity: 20, supply_cap: I128MAX, enabled: true,
  };
  const husdyReserve: ReserveConfigV2 = {
    index: 1, decimals: 7, c_factor: 900_0000, l_factor: 100_0000, util: 500_0000, max_util: 600_0000,
    r_base: 1000, r_one: 20_0000, r_two: 50_0000, r_three: 1_000_0000, reactivity: 20, supply_cap: I128MAX, enabled: true,
  };
  const hxauReserve: ReserveConfigV2 = {
    index: 2, decimals: 7, c_factor: 750_0000, l_factor: 100_0000, util: 500_0000, max_util: 600_0000,
    r_base: 1000, r_one: 20_0000, r_two: 50_0000, r_three: 1_000_0000, reactivity: 20, supply_cap: I128MAX, enabled: true,
  };
  await setupReserve(pool.contractId(), { asset: USDC_SAC, metadata: usdcReserve }, adminTxParams);
  await setupReserve(pool.contractId(), { asset: HUSDY_SAC, metadata: husdyReserve }, adminTxParams);
  await setupReserve(pool.contractId(), { asset: HXAU_SAC, metadata: hxauReserve }, adminTxParams);

  // Emisyon: USDC tedarikçilerine (b_token) %100
  const emissions: ReserveEmissionMetadata[] = [{ res_index: 0, res_type: 1, share: BigInt(1e7) }];
  await invokeSorobanOperation(pool.setEmissionsConfig(emissions), PoolContractV2.parsers.setEmissionsConfig, adminTxParams);

  console.log('Backstop deposit + Active…');
  await setupPoolBackstop(backstopContract.contractId(), pool.contractId(), cometContract.contractId(), BLND.contractId(), USDC.contractId(), adminTxParams, whaleTxParams, adminTxParams);

  console.log('BLND admin → emitter');
  const emitter = new EmitterContract(addressBook.getContractId('emitter'));
  await invokeSorobanOperation(BLND.set_admin(emitter.contractId()), () => undefined, adminTxParams);

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
