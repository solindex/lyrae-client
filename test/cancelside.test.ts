import fs from 'fs';
import os from 'os';
import { Cluster, Config, QUOTE_INDEX, sleep } from '../src';
import configFile from '../src/ids.json';
import { Account, Commitment, Connection } from '@solana/web3.js';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import TestGroup from './TestGroup';

async function testCancelSide() {
  const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
  const sleepTime = 2000;
  const config = new Config(configFile);

  const payer = new Account(
    JSON.parse(
      process.env.KEYPAIR ||
      fs.readFileSync(os.homedir() + '/.config/solana/devnet.json', 'utf-8'),
    ),
  );
  const connection = new Connection(
    config.cluster_urls[cluster],
    'processed' as Commitment,
  );

  const testGroup = new TestGroup();
  const lyraeGroupKey = await testGroup.init();
  const lyraeGroup = await testGroup.client.getLyraeGroup(lyraeGroupKey);
  const perpMarkets = await Promise.all(
    [1, 3].map((marketIndex) => {
      return lyraeGroup.loadPerpMarket(connection, marketIndex, 6, 6);
    }),
  );

  const cache = await lyraeGroup.loadCache(connection);
  const rootBanks = await lyraeGroup.loadRootBanks(connection);
  const quoteRootBank = rootBanks[QUOTE_INDEX];
  if (!quoteRootBank) {
    throw new Error('Quote Rootbank Not Found');
  }
  const quoteNodeBanks = await quoteRootBank.loadNodeBanks(connection);

  const accountPk = await testGroup.client.createLyraeAccount(
    lyraeGroup,
    payer,
    1,
  );
  console.log('Created Account:', accountPk.toBase58());

  await sleep(sleepTime);
  const account = await testGroup.client.getLyraeAccount(
    accountPk,
    lyraeGroup.dexProgramId,
  );

  const quoteTokenInfo = lyraeGroup.tokens[QUOTE_INDEX];
  const quoteToken = new Token(
    connection,
    quoteTokenInfo.mint,
    TOKEN_PROGRAM_ID,
    payer,
  );
  const quoteWallet = await quoteToken.getOrCreateAssociatedAccountInfo(
    payer.publicKey,
  );

  await testGroup.runKeeper();
  await testGroup.client.deposit(
    lyraeGroup,
    account,
    payer,
    quoteRootBank.publicKey,
    quoteNodeBanks[0].publicKey,
    quoteNodeBanks[0].vault,
    quoteWallet.address,
    10000,
  );

  console.log('changeParams');
  const info = lyraeGroup.perpMarkets[1];
  await testGroup.client.changePerpMarketParams2(
    lyraeGroup,
    perpMarkets[0],
    payer,
    20,
    10,
    info.liquidationFee.toNumber(),
    info.makerFee.toNumber(),
    info.takerFee.toNumber(),
    1,
    200,
    3601,
    0,
    2,
    1,
    0,
  );

  await testGroup.runKeeper();

  console.log('placePerpBid');
  await testGroup.client.placePerpOrder(
    lyraeGroup,
    account,
    cache.publicKey,
    perpMarkets[0],
    payer,
    'buy',
    1,
    1,
  );

  await testGroup.runKeeper();

  await account.reload(testGroup.connection);
  let pm = await lyraeGroup.loadPerpMarket(testGroup.connection, 1, 6, 6);
  let bids = await pm.loadBids(testGroup.connection);
  console.log('bids', [...bids].length);

  console.log('cancelPerpBids');
  await testGroup.client.cancelPerpOrderSide(
    lyraeGroup,
    account,
    pm,
    payer,
    'buy',
    1,
  );

  await account.reload(testGroup.connection);
  pm = await lyraeGroup.loadPerpMarket(testGroup.connection, 1, 6, 6);
  bids = await pm.loadBids(testGroup.connection);
  console.log('bids', [...bids].length);

  console.log('placePerpAsk');
  await testGroup.client.placePerpOrder(
    lyraeGroup,
    account,
    cache.publicKey,
    perpMarkets[0],
    payer,
    'sell',
    100000,
    1,
  );

  await testGroup.runKeeper();

  await account.reload(testGroup.connection);
  pm = await lyraeGroup.loadPerpMarket(testGroup.connection, 1, 6, 6);
  let asks = await pm.loadAsks(testGroup.connection);
  console.log('asks', [...asks].length);

  console.log('cancelPerpAsks');
  await testGroup.client.cancelPerpOrderSide(
    lyraeGroup,
    account,
    pm,
    payer,
    'sell',
    1,
  );

  await account.reload(testGroup.connection);
  pm = await lyraeGroup.loadPerpMarket(testGroup.connection, 1, 6, 6);
  asks = await pm.loadAsks(testGroup.connection);
  console.log('asks', [...asks].length);
}

testCancelSide();
