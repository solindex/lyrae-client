import fs from 'fs';
import os from 'os';
import { Cluster, Config, QUOTE_INDEX, sleep } from '../src';
import configFile from '../src/ids.json';
import {
  Account,
  Commitment,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import TestGroup from './TestGroup';

async function testCloseAccount() {
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

  //const accountPk = await testGroup.client.initLyraeAccount(lyraeGroup, payer);
  const accountPk = await testGroup.client.createLyraeAccount(lyraeGroup, payer, 1);
  //const accountPk2 = await testGroup.client.createLyraeAccount(lyraeGroup, payer, 1);
  console.log('Created Account:', accountPk.toBase58());
  //console.log('Created Account:', accountPk2.toBase58());
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
  await testGroup.runKeeper();

  // Test creating and closing an advanced orders account
  await testGroup.client.addPerpTriggerOrder(
    lyraeGroup,
    account,
    perpMarkets[0],
    payer,
    'limit',
    'buy',
    50000,
    0.0001,
    'above',
    51000,
    true,
  );
  await account.reload(connection);
  console.log(account.advancedOrdersKey.toBase58());
  const txid = await testGroup.client.closeAdvancedOrders(
    lyraeGroup,
    account,
    payer,
  );
  console.log('CloseAdvancedOrders', txid);
  await account.reload(connection);
  console.log(account.advancedOrdersKey.toBase58());

  // Test creating and closing a spot open orders account
  console.log(testGroup.spotMarkets[0].minOrderSize);
  await testGroup.client.placeSpotOrder2(
    lyraeGroup,
    account,
    testGroup.spotMarkets[0],
    testGroup.payer,
    'buy',
    10,
    1000,
    'ioc',
  );
  await testGroup.runCrank();
  const openOrders = await testGroup.spotMarkets[0].loadOrdersForOwner(
    connection,
    account.publicKey,
  );
  for (const order of openOrders) {
    await testGroup.client.cancelSpotOrder(
      lyraeGroup,
      account,
      payer,
      testGroup.spotMarkets[0],
      order,
    );
  }
  await testGroup.runCrank();
  await testGroup.client.settleFunds(
    lyraeGroup,
    account,
    payer,
    testGroup.spotMarkets[0],
  );
  await testGroup.runCrank();
  await account.reload(connection);
  console.log(account.spotOpenOrders[0].toBase58());
  const closeSpotTx = await testGroup.client.closeSpotOpenOrders(
    lyraeGroup,
    account,
    payer,
    0,
  );
  console.log('CloseSpotOpenOrders', closeSpotTx);
  await account.reload(connection);
  console.log(account.spotOpenOrders[0].toBase58());

  await testGroup.client.withdraw(
    lyraeGroup,
    account,
    payer,
    quoteRootBank.publicKey,
    quoteNodeBanks[0].publicKey,
    quoteNodeBanks[0].vault,
    10000,
    false,
  );

  const closeLyraeAccountTxid = await testGroup.client.closeLyraeAccount(
    lyraeGroup,
    account,
    payer,
  );
  console.log('CloseLyraeAccount', closeLyraeAccountTxid);
}

testCloseAccount();
