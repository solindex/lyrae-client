import {
  Cluster,
  Config,
  findLargestTokenAccountForOwner,
  getPerpMarketByIndex,
  NodeBank,
  PerpMarketConfig,
  QUOTE_INDEX,
  RootBank,
} from '../src';
import configFile from '../src/ids.json';
import {
  Account,
  Commitment,
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import fs from 'fs';
import os from 'os';
import { LyraeClient } from '../src';
import {
  makeCancelAllPerpOrdersInstruction,
  makePlacePerpOrderInstruction,
  LyraeCache,
  sleep,
} from '../src';
import { BN } from 'bn.js';
import LyraeAccount from '../src/LyraeAccount';

async function fillBook() {
  // load lyrae group and clients
  const config = new Config(configFile);
  const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
  const groupName = process.env.GROUP || 'devnet.2';
  const groupIds = config.getGroup(cluster, groupName);
  if (!groupIds) {
    throw new Error(`Group ${groupName} not found`);
  }

  const lyraeProgramId = groupIds.lyraeProgramId;
  const lyraeGroupKey = groupIds.publicKey;

  const payer = new Account(
    JSON.parse(
      fs.readFileSync(
        process.env.KEYPAIR || os.homedir() + '/.config/solana/id.json',
        'utf-8',
      ),
    ),
  );
  console.log(`Payer: ${payer.publicKey.toBase58()}`);

  const connection = new Connection(
    process.env.ENDPOINT_URL || config.cluster_urls[cluster],
    'processed' as Commitment,
  );
  const client = new LyraeClient(connection, lyraeProgramId);

  const lyraeGroup = await client.getLyraeGroup(lyraeGroupKey);

  const marketIndex = 1;
  const perpMarketConfig = getPerpMarketByIndex(
    groupIds,
    marketIndex,
  ) as PerpMarketConfig;
  const perpMarket = await client.getPerpMarket(
    perpMarketConfig.publicKey,
    perpMarketConfig.baseDecimals,
    perpMarketConfig.quoteDecimals,
  );

  const quoteTokenInfo = lyraeGroup.getQuoteTokenInfo();
  const quoteTokenAccount = await findLargestTokenAccountForOwner(
    connection,
    payer.publicKey,
    quoteTokenInfo.mint,
  );
  const rootBank = (await lyraeGroup.loadRootBanks(connection))[
    QUOTE_INDEX
  ] as RootBank;
  const nodeBank = rootBank.nodeBankAccounts[0] as NodeBank;
  const cache = await lyraeGroup.loadCache(connection);
  // for (let i = 0; i < 3; i++) {
  //   const lyraeAccountStr = await client.initLyraeAccountAndDeposit(
  //     lyraeGroup,
  //     payer,
  //     quoteTokenInfo.rootBank,
  //     nodeBank.publicKey,
  //     nodeBank.vault,
  //     quoteTokenAccount.publicKey,
  //     1000,
  //     `testfunding${i}`,
  //   );
  //   const lyraeAccountPk = new PublicKey(lyraeAccountStr);
  //   const lyraeAccount = await client.getLyraeAccount(
  //     lyraeAccountPk,
  //     lyraeGroup.dexProgramId,
  //   );
  //   for (let j = 0; j < 1; j++) {
  //     for (let k = 0; k < 32; k++) {
  //       const tx = new Transaction();
  //
  //       const [nativeBidPrice, nativeBidSize] =
  //         perpMarket.uiToNativePriceQuantity(100000, 0.0001);
  //       const [nativeAskPrice, nativeAskSize] =
  //         perpMarket.uiToNativePriceQuantity(1, 0.0001);
  //
  //       const placeBidInstruction = makePlacePerpOrderInstruction(
  //         lyraeProgramId,
  //         lyraeGroup.publicKey,
  //         lyraeAccount.publicKey,
  //         payer.publicKey,
  //         lyraeGroup.lyraeCache,
  //         perpMarket.publicKey,
  //         perpMarket.bids,
  //         perpMarket.asks,
  //         perpMarket.eventQueue,
  //         lyraeAccount.getOpenOrdersKeysInBasket(),
  //         nativeBidPrice,
  //         nativeBidSize,
  //         new BN(Date.now()),
  //         'buy',
  //         'postOnlySlide',
  //       );
  //       tx.add(placeBidInstruction);
  //       const placeAskInstruction = makePlacePerpOrderInstruction(
  //         lyraeProgramId,
  //         lyraeGroup.publicKey,
  //         lyraeAccount.publicKey,
  //         payer.publicKey,
  //         lyraeGroup.lyraeCache,
  //         perpMarket.publicKey,
  //         perpMarket.bids,
  //         perpMarket.asks,
  //         perpMarket.eventQueue,
  //         lyraeAccount.getOpenOrdersKeysInBasket(),
  //         nativeAskPrice,
  //         nativeAskSize,
  //         new BN(Date.now()),
  //         'sell',
  //         'postOnlySlide',
  //       );
  //       tx.add(placeAskInstruction);
  //       // const txid = await client.sendTransaction(tx, payer, []);
  //     }
  //   }
  // }
  const fundingTxid = await client.updateFunding(
    lyraeGroup.publicKey,
    lyraeGroup.lyraeCache,
    perpMarket.publicKey,
    perpMarket.bids,
    perpMarket.asks,
    payer,
  );
  console.log(`fundingTxid: ${fundingTxid.toString()}`);
}
fillBook();
