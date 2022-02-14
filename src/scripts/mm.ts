import {
  Cluster,
  Config,
  getPerpMarketByBaseSymbol,
  PerpMarketConfig,
} from '../config';
import configFile from '../ids.json';
import {
  Account,
  Commitment,
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import fs from 'fs';
import os from 'os';
import { LyraeClient } from '../client';
import {
  BookSide,
  makeCancelAllPerpOrdersInstruction,
  makePlacePerpOrderInstruction,
  LyraeCache,
  ONE_BN,
  sleep,
} from '../index';
import { BN } from 'bn.js';
import LyraeAccount from '../LyraeAccount';
import LyraeGroup from '../LyraeGroup';
import PerpMarket from '../PerpMarket';

const interval = parseInt(process.env.INTERVAL || '10000');
const control = { isRunning: true, interval: interval };

async function mm() {
  // load lyrae group and clients
  const config = new Config(configFile);
  const groupName = process.env.GROUP || 'devnet.2';
  const lyraeAccountName = process.env.LYRAE_ACCOUNT_NAME;

  const groupIds = config.getGroupWithName(groupName);
  if (!groupIds) {
    throw new Error(`Group ${groupName} not found`);
  }
  const cluster = groupIds.cluster as Cluster;
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

  const ownerAccounts = await client.getLyraeAccountsForOwner(
    lyraeGroup,
    payer.publicKey,
    true,
  );

  let lyraeAccountPk;
  if (lyraeAccountName) {
    for (const ownerAccount of ownerAccounts) {
      if (lyraeAccountName === ownerAccount.name) {
        lyraeAccountPk = ownerAccount.publicKey;
        break;
      }
    }
    if (!lyraeAccountPk) {
      throw new Error('LYRAE_ACCOUNT_NAME not found');
    }
  } else {
    const lyraeAccountPkStr = process.env.LYRAE_ACCOUNT_PUBKEY;
    if (!lyraeAccountPkStr) {
      throw new Error(
        'Please add env variable LYRAE_ACCOUNT_PUBKEY or LYRAE_ACCOUNT_NAME',
      );
    } else {
      lyraeAccountPk = new PublicKey(lyraeAccountPkStr);
    }
  }

  // TODO make it be able to quote all markets
  const marketName = process.env.MARKET;
  if (!marketName) {
    throw new Error('Please add env variable MARKET');
  }

  const perpMarketConfig = getPerpMarketByBaseSymbol(
    groupIds,
    marketName.toUpperCase(),
  ) as PerpMarketConfig;
  const marketIndex = perpMarketConfig.marketIndex;
  const perpMarket = await client.getPerpMarket(
    perpMarketConfig.publicKey,
    perpMarketConfig.baseDecimals,
    perpMarketConfig.quoteDecimals,
  );

  const sizePerc = parseFloat(process.env.SIZE_PERC || '0.1');
  const charge = parseFloat(process.env.CHARGE || '0.0010');
  const leanCoeff = parseFloat(process.env.LEAN_COEFF || '0.0005');
  const bias = parseFloat(process.env.BIAS || '0.0');
  const requoteThresh = parseFloat(process.env.REQUOTE_THRESH || '0.0');
  const takeSpammers = process.env.TAKE_SPAMMERS === 'true';

  const spammerCharge = parseFloat(process.env.SPAMMER_CHARGE || '2'); // multiplier on charge

  process.on('SIGINT', function () {
    console.log('Caught keyboard interrupt. Canceling orders');
    control.isRunning = false;
    onExit(
      client,
      payer,
      lyraeProgramId,
      lyraeGroup,
      perpMarket,
      lyraeAccountPk,
    );
  });

  while (control.isRunning) {
    try {
      // get fresh data
      // get orderbooks, get perp markets, caches
      // TODO load pyth oracle itself for most accurate prices
      const [bids, asks, lyraeCache, lyraeAccount]: [
        BookSide,
        BookSide,
        LyraeCache,
        LyraeAccount,
      ] = await Promise.all([
        perpMarket.loadBids(connection),
        perpMarket.loadAsks(connection),
        lyraeGroup.loadCache(connection),
        client.getLyraeAccount(lyraeAccountPk, lyraeGroup.dexProgramId),
      ]);

      // TODO store the prices in an array to calculate volatility

      // Model logic
      const fairValue = lyraeGroup.getPrice(marketIndex, lyraeCache).toNumber();
      const equity = lyraeAccount
        .computeValue(lyraeGroup, lyraeCache)
        .toNumber();
      const perpAccount = lyraeAccount.perpAccounts[marketIndex];
      // TODO look at event queue as well for unprocessed fills
      const basePos = perpAccount.getBasePositionUi(perpMarket);

      // TODO volatility adjustment
      const size = (equity * sizePerc) / fairValue;
      const lean = (-leanCoeff * basePos) / size;
      const bidPrice = fairValue * (1 - charge + lean + bias);
      const askPrice = fairValue * (1 + charge + lean + bias);

      const [modelBidPrice, nativeBidSize] = perpMarket.uiToNativePriceQuantity(
        bidPrice,
        size,
      );
      const [modelAskPrice, nativeAskSize] = perpMarket.uiToNativePriceQuantity(
        askPrice,
        size,
      );

      const bestBid = bids.getBest();
      const bestAsk = asks.getBest();

      const bookAdjBid =
        bestAsk !== undefined
          ? BN.min(bestAsk.priceLots.sub(ONE_BN), modelBidPrice)
          : modelBidPrice;
      const bookAdjAsk =
        bestBid !== undefined
          ? BN.max(bestBid.priceLots.add(ONE_BN), modelAskPrice)
          : modelAskPrice;

      // TODO use order book to requote if size has changed
      const openOrders = lyraeAccount
        .getPerpOpenOrders()
        .filter((o) => o.marketIndex === marketIndex);
      let moveOrders = openOrders.length === 0 || openOrders.length > 2;
      for (const o of openOrders) {
        console.log(
          `${o.side} ${o.price.toString()} -> ${o.side === 'buy' ? bookAdjBid.toString() : bookAdjAsk.toString()
          }`,
        );

        if (o.side === 'buy') {
          if (
            Math.abs(o.price.toNumber() / bookAdjBid.toNumber() - 1) >
            requoteThresh
          ) {
            moveOrders = true;
          }
        } else {
          if (
            Math.abs(o.price.toNumber() / bookAdjAsk.toNumber() - 1) >
            requoteThresh
          ) {
            moveOrders = true;
          }
        }
      }

      // Start building the transaction
      const tx = new Transaction();

      /*
      Clear 1 lot size orders at the top of book that bad people use to manipulate the price
       */
      if (
        takeSpammers &&
        bestBid !== undefined &&
        bestBid.sizeLots.eq(ONE_BN) &&
        bestBid.priceLots.toNumber() / modelAskPrice.toNumber() - 1 >
        spammerCharge * charge + 0.0005
      ) {
        console.log(`${marketName}-PERP taking best bid spammer`);
        const takerSell = makePlacePerpOrderInstruction(
          lyraeProgramId,
          lyraeGroup.publicKey,
          lyraeAccount.publicKey,
          payer.publicKey,
          lyraeCache.publicKey,
          perpMarket.publicKey,
          perpMarket.bids,
          perpMarket.asks,
          perpMarket.eventQueue,
          lyraeAccount.getOpenOrdersKeysInBasket(),
          bestBid.priceLots,
          ONE_BN,
          new BN(Date.now()),
          'sell',
          'ioc',
        );
        tx.add(takerSell);
      } else if (
        takeSpammers &&
        bestAsk !== undefined &&
        bestAsk.sizeLots.eq(ONE_BN) &&
        modelBidPrice.toNumber() / bestAsk.priceLots.toNumber() - 1 >
        spammerCharge * charge + 0.0005
      ) {
        console.log(`${marketName}-PERP taking best ask spammer`);
        const takerBuy = makePlacePerpOrderInstruction(
          lyraeProgramId,
          lyraeGroup.publicKey,
          lyraeAccount.publicKey,
          payer.publicKey,
          lyraeCache.publicKey,
          perpMarket.publicKey,
          perpMarket.bids,
          perpMarket.asks,
          perpMarket.eventQueue,
          lyraeAccount.getOpenOrdersKeysInBasket(),
          bestAsk.priceLots,
          ONE_BN,
          new BN(Date.now()),
          'buy',
          'ioc',
        );
        tx.add(takerBuy);
      }
      if (moveOrders) {
        // cancel all, requote
        const cancelAllInstr = makeCancelAllPerpOrdersInstruction(
          lyraeProgramId,
          lyraeGroup.publicKey,
          lyraeAccount.publicKey,
          payer.publicKey,
          perpMarket.publicKey,
          perpMarket.bids,
          perpMarket.asks,
          new BN(20),
        );

        const placeBidInstr = makePlacePerpOrderInstruction(
          lyraeProgramId,
          lyraeGroup.publicKey,
          lyraeAccount.publicKey,
          payer.publicKey,
          lyraeCache.publicKey,
          perpMarket.publicKey,
          perpMarket.bids,
          perpMarket.asks,
          perpMarket.eventQueue,
          lyraeAccount.getOpenOrdersKeysInBasket(),
          bookAdjBid,
          nativeBidSize,
          new BN(Date.now()),
          'buy',
          'postOnlySlide',
        );

        const placeAskInstr = makePlacePerpOrderInstruction(
          lyraeProgramId,
          lyraeGroup.publicKey,
          lyraeAccount.publicKey,
          payer.publicKey,
          lyraeCache.publicKey,
          perpMarket.publicKey,
          perpMarket.bids,
          perpMarket.asks,
          perpMarket.eventQueue,
          lyraeAccount.getOpenOrdersKeysInBasket(),
          bookAdjAsk,
          nativeAskSize,
          new BN(Date.now()),
          'sell',
          'postOnlySlide',
        );
        tx.add(cancelAllInstr);
        tx.add(placeBidInstr);
        tx.add(placeAskInstr);
      } else {
        console.log(`${marketName}-PERP Not requoting. No need to move orders`);
      }
      if (tx.instructions.length > 0) {
        const txid = await client.sendTransaction(tx, payer, []);
        console.log(
          `${marketName}-PERP adjustment success: ${txid.toString()}`,
        );
      }
    } catch (e) {
      // sleep for some time and retry
      console.log(e);
    } finally {
      console.log(`sleeping for ${interval / 1000}s`);
      await sleep(interval);
    }
  }
}

async function onExit(
  client: LyraeClient,
  payer: Account,
  lyraeProgramId: PublicKey,
  lyraeGroup: LyraeGroup,
  perpMarket: PerpMarket,
  lyraeAccountPk: PublicKey,
) {
  await sleep(control.interval);
  const lyraeAccount = await client.getLyraeAccount(
    lyraeAccountPk,
    lyraeGroup.dexProgramId,
  );

  const cancelAllInstr = makeCancelAllPerpOrdersInstruction(
    lyraeProgramId,
    lyraeGroup.publicKey,
    lyraeAccount.publicKey,
    payer.publicKey,
    perpMarket.publicKey,
    perpMarket.bids,
    perpMarket.asks,
    new BN(20),
  );
  const tx = new Transaction();
  tx.add(cancelAllInstr);

  const txid = await client.sendTransaction(tx, payer, []);
  console.log(`cancel successful: ${txid.toString()}`);

  process.exit();
}

function startMarketMaker() {
  if (control.isRunning) {
    mm().finally(startMarketMaker);
  }
}

process.on('unhandledRejection', function (err, promise) {
  console.error(
    'Unhandled rejection (promise: ',
    promise,
    ', reason: ',
    err,
    ').',
  );
});

startMarketMaker();