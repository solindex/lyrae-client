import * as os from 'os';
import * as fs from 'fs';
import { LyraeClient } from '../client';
import {
  Account,
  Commitment,
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import { getMultipleAccounts, zeroKey } from '../utils/utils';
import configFile from '../ids.json';
import { Cluster, Config } from '../config';
import {
  makeCachePerpMarketsInstruction,
  makeCachePricesInstruction,
  makeCacheRootBankInstruction,
  makeUpdateFundingInstruction,
  makeUpdateRootBankInstruction,
} from '../instruction';
import BN from 'bn.js';
import { PerpEventQueueLayout } from '../layout';
import { LyraeGroup, PerpMarket, promiseUndef } from '..';
import PerpEventQueue from '../PerpEventQueue';

let lastRootBankCacheUpdate = 0;
const groupName = process.env.GROUP || 'mainnet.1';
const updateCacheInterval = parseInt(
  process.env.UPDATE_CACHE_INTERVAL || '3000',
);
const updateRootBankCacheInterval = parseInt(
  process.env.UPDATE_ROOT_BANK_CACHE_INTERVAL || '5000',
);
const processKeeperInterval = parseInt(
  process.env.PROCESS_KEEPER_INTERVAL || '10000',
);
const consumeEventsInterval = parseInt(
  process.env.CONSUME_EVENTS_INTERVAL || '1000',
);
const maxUniqueAccounts = parseInt(process.env.MAX_UNIQUE_ACCOUNTS || '10');
const consumeEventsLimit = new BN(process.env.CONSUME_EVENTS_LIMIT || '10');
const consumeEvents = process.env.CONSUME_EVENTS
  ? process.env.CONSUME_EVENTS === 'true'
  : true;
const cluster = (process.env.CLUSTER || 'mainnet') as Cluster;
const config = new Config(configFile);
const groupIds = config.getGroup(cluster, groupName);

if (!groupIds) {
  throw new Error(`Group ${groupName} not found`);
}
const lyraeProgramId = groupIds.lyraeProgramId;
const lyraeGroupKey = groupIds.publicKey;
const payer = new Account(
  JSON.parse(
    process.env.KEYPAIR ||
    fs.readFileSync(os.homedir() + '/.config/solana/blw.json', 'utf-8'),
  ),
);
const connection = new Connection(
  process.env.ENDPOINT_URL || config.cluster_urls[cluster],
  'processed' as Commitment,
);

const client = new LyraeClient(connection, lyraeProgramId);

async function main() {
  if (!groupIds) {
    throw new Error(`Group ${groupName} not found`);
  }
  const lyraeGroup = await client.getLyraeGroup(lyraeGroupKey);
  const perpMarkets = await Promise.all(
    groupIds.perpMarkets.map((m) => {
      return lyraeGroup.loadPerpMarket(
        connection,
        m.marketIndex,
        m.baseDecimals,
        m.quoteDecimals,
      );
    }),
  );

  processUpdateCache(lyraeGroup);
  processKeeperTransactions(lyraeGroup, perpMarkets);

  if (consumeEvents) {
    processConsumeEvents(lyraeGroup, perpMarkets);
  }
}
console.time('processUpdateCache');

async function processUpdateCache(lyraeGroup: LyraeGroup) {
  console.timeEnd('processUpdateCache');

  try {
    const batchSize = 8;
    const promises: Promise<string>[] = [];
    const rootBanks = lyraeGroup.tokens
      .map((t) => t.rootBank)
      .filter((t) => !t.equals(zeroKey));
    const oracles = lyraeGroup.oracles.filter((o) => !o.equals(zeroKey));
    const perpMarkets = lyraeGroup.perpMarkets
      .filter((pm) => !pm.isEmpty())
      .map((pm) => pm.perpMarket);
    const nowTs = Date.now();
    let shouldUpdateRootBankCache = false;
    if (nowTs - lastRootBankCacheUpdate > updateRootBankCacheInterval) {
      shouldUpdateRootBankCache = true;
      lastRootBankCacheUpdate = nowTs;
    }
    for (let i = 0; i < rootBanks.length / batchSize; i++) {
      const startIndex = i * batchSize;
      const endIndex = i * batchSize + batchSize;
      const cacheTransaction = new Transaction();
      if (shouldUpdateRootBankCache) {
        cacheTransaction.add(
          makeCacheRootBankInstruction(
            lyraeProgramId,
            lyraeGroup.publicKey,
            lyraeGroup.lyraeCache,
            rootBanks.slice(startIndex, endIndex),
          ),
        );
      }
      cacheTransaction.add(
        makeCachePricesInstruction(
          lyraeProgramId,
          lyraeGroup.publicKey,
          lyraeGroup.lyraeCache,
          oracles.slice(startIndex, endIndex),
        ),
      );

      cacheTransaction.add(
        makeCachePerpMarketsInstruction(
          lyraeProgramId,
          lyraeGroup.publicKey,
          lyraeGroup.lyraeCache,
          perpMarkets.slice(startIndex, endIndex),
        ),
      );
      if (cacheTransaction.instructions.length > 0) {
        promises.push(client.sendTransaction(cacheTransaction, payer, []));
      }
    }

    Promise.all(promises).catch((err) => {
      console.error('Error updating cache', err);
    });
  } finally {
    console.time('processUpdateCache');
    setTimeout(processUpdateCache, updateCacheInterval, lyraeGroup);
  }
}

async function processConsumeEvents(
  lyraeGroup: LyraeGroup,
  perpMarkets: PerpMarket[],
) {
  try {
    const eventQueuePks = perpMarkets.map((mkt) => mkt.eventQueue);
    const eventQueueAccts = await getMultipleAccounts(
      connection,
      eventQueuePks,
    );

    const perpMktAndEventQueue = eventQueueAccts.map(
      ({ publicKey, accountInfo }) => {
        const parsed = PerpEventQueueLayout.decode(accountInfo?.data);
        const eventQueue = new PerpEventQueue(parsed);
        const perpMarket = perpMarkets.find((mkt) =>
          mkt.eventQueue.equals(publicKey),
        );
        if (!perpMarket) {
          throw new Error('PerpMarket not found');
        }
        return { perpMarket, eventQueue };
      },
    );

    const promises: Promise<string | void>[] = perpMktAndEventQueue.map(
      ({ perpMarket, eventQueue }) => {
        const events = eventQueue.getUnconsumedEvents();
        if (events.length === 0) {
          // console.log('No events to consume');
          return promiseUndef();
        }

        const accounts: Set<string> = new Set();
        for (const event of events) {
          if (event.fill) {
            accounts.add(event.fill.maker.toBase58());
            accounts.add(event.fill.taker.toBase58());
          } else if (event.out) {
            accounts.add(event.out.owner.toBase58());
          }

          // Limit unique accounts to first 20 or 21
          if (accounts.size >= maxUniqueAccounts) {
            break;
          }
        }

        return client
          .consumeEvents(
            lyraeGroup,
            perpMarket,
            Array.from(accounts)
              .map((s) => new PublicKey(s))
              .sort(),
            payer,
            consumeEventsLimit,
          )
          .then(() => {
            console.log(
              `Consumed up to ${events.length
              } events ${perpMarket.publicKey.toBase58()}`,
            );
            console.log(
              'EVENTS:',
              events.map((e) => e?.fill?.seqNum.toString()),
            );
          })
          .catch((err) => {
            console.error('Error consuming events', err);
          });
      },
    );

    Promise.all(promises);
  } finally {
    setTimeout(
      processConsumeEvents,
      consumeEventsInterval,
      lyraeGroup,
      perpMarkets,
    );
  }
}

async function processKeeperTransactions(
  lyraeGroup: LyraeGroup,
  perpMarkets: PerpMarket[],
) {
  try {
    if (!groupIds) {
      throw new Error(`Group ${groupName} not found`);
    }
    console.log('processKeeperTransactions');
    const batchSize = 8;
    const promises: Promise<string>[] = [];

    const filteredPerpMarkets = perpMarkets.filter(
      (pm) => !pm.publicKey.equals(zeroKey),
    );

    for (let i = 0; i < groupIds.tokens.length / batchSize; i++) {
      const startIndex = i * batchSize;
      const endIndex = i * batchSize + batchSize;

      const updateRootBankTransaction = new Transaction();
      groupIds.tokens.slice(startIndex, endIndex).forEach((token) => {
        updateRootBankTransaction.add(
          makeUpdateRootBankInstruction(
            lyraeProgramId,
            lyraeGroup.publicKey,
            lyraeGroup.lyraeCache,
            token.rootKey,
            token.nodeKeys,
          ),
        );
      });

      const updateFundingTransaction = new Transaction();
      filteredPerpMarkets.slice(startIndex, endIndex).forEach((market) => {
        if (market) {
          updateFundingTransaction.add(
            makeUpdateFundingInstruction(
              lyraeProgramId,
              lyraeGroup.publicKey,
              lyraeGroup.lyraeCache,
              market.publicKey,
              market.bids,
              market.asks,
            ),
          );
        }
      });

      if (updateRootBankTransaction.instructions.length > 0) {
        promises.push(
          client.sendTransaction(updateRootBankTransaction, payer, []),
        );
      }
      if (updateFundingTransaction.instructions.length > 0) {
        promises.push(
          client.sendTransaction(updateFundingTransaction, payer, []),
        );
      }
    }

    Promise.all(promises).catch((err) => {
      console.error('Error processing keeper instructions', err);
    });
  } finally {
    setTimeout(
      processKeeperTransactions,
      processKeeperInterval,
      lyraeGroup,
      perpMarkets,
    );
  }
}

main();