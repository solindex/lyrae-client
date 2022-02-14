import fs from 'fs';
import os from 'os';
import {
  Account,
  Cluster,
  Commitment,
  Connection,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import {
  Config,
  getMultipleAccounts,
  makeCachePerpMarketsInstruction,
  makeCachePricesInstruction,
  makeCacheRootBankInstruction,
  makeUpdateFundingInstruction,
  makeUpdateRootBankInstruction,
  LyraeClient,
  msrmMints,
  PerpEventQueue,
  PerpEventQueueLayout,
  zeroKey,
} from '../src';
import listMarket from '../src/commands/listMarket';
import configFile from '../src/ids.json';
import BN from 'bn.js';
import {
  decodeEventQueue,
  DexInstructions,
  Market,
} from '@project-serum/serum';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';

export default class TestGroup {
  FIXED_IDS: any[] = [
    {
      symbol: 'LYR',
      decimals: 6,
      baseLot: 1000000,
      quoteLot: 100,
      initLeverage: 1.25,
      maintLeverage: 2.5,
      liquidationFee: 0.2,
      oracleProvider: 'switchboard',
      mint: 'Bb9bsTQa1bGEtQ5KagGkvSHyuLqDWumFUcRqFusFNJWC',
    },
    {
      symbol: 'BTC',
      decimals: 6,
      baseLot: 100,
      quoteLot: 10,
      price: 45000,
      mint: '3UNBZ6o52WTWwjac2kPUb4FyodhU1vFkRJheu1Sh2TvU',
    },
    {
      symbol: 'ETH',
      decimals: 6,
      baseLot: 1000,
      quoteLot: 10,
      oracleProvider: 'pyth',
      mint: 'Cu84KB3tDL6SbFgToHMLYVDJJXdJjenNzSKikeAvzmkA',
    },
    {
      symbol: 'SOL',
      decimals: 9,
      baseLot: 100000000,
      quoteLot: 100,
      oracleProvider: 'pyth',
      mint: 'So11111111111111111111111111111111111111112',
    },
    {
      symbol: 'SRM',
      decimals: 6,
      baseLot: 100000,
      quoteLot: 100,
      oracleProvider: 'pyth',
      mint: 'AvtB6w9xboLwA145E221vhof5TddhqsChYcx7Fy3xVMH',
    },
    {
      symbol: 'RAY',
      decimals: 6,
      baseLot: 100000,
      quoteLot: 100,
      oracleProvider: 'pyth',
      mint: '3YFQ7UYJ7sNGpXTKBxM3bYLVxKpzVudXAe4gLExh5b3n',
      initLeverage: 3,
      maintLeverage: 6,
      liquidationFee: 0.0833,
    },
    {
      symbol: 'USDT',
      decimals: 6,
      baseLot: 1000000,
      quoteLot: 100,
      oracleProvider: 'pyth',
      mint: 'DAwBSXe6w9g37wdE2tCrFbho3QHKZi4PjuBytQCULap2',
      initLeverage: 10,
      maintLeverage: 20,
      liquidationFee: 0.025,
    },
    {
      symbol: 'USDC',
      decimals: 6,
      mint: '8FRFC6MoGGkMFQwngccyu69VnYbzykGeez7ignHVAFSN',
    },
  ];
  quoteMint = new PublicKey(
    this.FIXED_IDS.find((id) => id.symbol === 'USDC')?.mint,
  );
  lyraeProgramId = new PublicKey(
    '4skJ85cdxQAFVKbcGgfun8iZPL7BadVYXG3kGEGkufqA',
  );
  serumProgramId = new PublicKey(
    'DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY',
  );
  feesVault = new PublicKey('54PcMYTAZd8uRaYyb3Cwgctcfc1LchGMaqVrmxgr3yVs'); // devnet vault owned by daffy
  PYTH_ORACLES_DEVNET = {
    BTC: 'HovQMDrbAgAYPCmHVSrezcSmkMtXSSUsLDFANExrZh2J',
    ETH: 'EdVCmQ9FSPcVe5YySXDPCRmc8aDQLKJ9xvYBMZPie1Vw',
    SOL: 'J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix',
    SRM: '992moaMQKs32GKZ9dxi8keyM2bUmbrwBZpK4p2K6X5Vs',
    RAY: '8PugCXTAHLM9kfLSQWe2njE5pzAgUdpPk3Nx5zSm7BD3', // LUNA
    LYR: '4GqTjGm686yihQ1m1YdTsSvfm4mNfadv6xskzgCYWNC5', // XAU
    DOGE: '4L6YhY8VvUgmqG5MvJkUJATtzB2rFqdrJwQCmFLv4Jzy',
    SUSHI: 'BLArYBCUYhdWiY8PCUTpvFE21iaJq85dvxLk9bYMobcU', // LTC
    FTT: '6vivTRs5ZPeeXbjo7dfburfaYDWoXjBtdtuYgQRuGfu',
    USDT: '38xoQ4oeJCBrcVvca2cGk7iV1dAfrmTR1kmhSCJQ8Jto',
  };
  SWITCHBOARD_ORACLES_DEVNET = {
    LYR: '8k7F9Xb36oFJsjpCKpsXvg4cgBRoZtwNTc3EzG5Ttd2o',
  };
  oraclePks: PublicKey[] = [];
  lyraeGroupKey: PublicKey = zeroKey;
  client: LyraeClient;
  payer: Account;
  connection: Connection;
  log: boolean;
  logger: any;
  spotMarkets: Market[] = [];

  constructor(log: boolean = false) {
    const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
    const config = new Config(configFile);
    this.log = log;
    if (!this.log) {
      this.logger = console.log;
    }

    this.payer = new Account(
      JSON.parse(
        process.env.KEYPAIR ||
        fs.readFileSync(
          os.homedir() + '/.config/solana/devnet.json',
          'utf-8',
        ),
      ),
    );
    this.connection = new Connection(
      config.cluster_urls[cluster],
      'processed' as Commitment,
    );

    this.client = new LyraeClient(this.connection, this.lyraeProgramId);
  }

  async init(): Promise<PublicKey> {
    console.log('Creating Lyrae Group...');
    if (!this.log) {
      console.log = function () { };
    }

    this.lyraeGroupKey = await this.client.initLyraeGroup(
      this.quoteMint,
      msrmMints['devnet'],
      this.serumProgramId,
      this.feesVault,
      10,
      0.7,
      0.06,
      1.5,
      this.payer,
    );

    let group = await this.client.getLyraeGroup(this.lyraeGroupKey);
    for (let i = 0; i < this.FIXED_IDS.length; i++) {
      const fids = this.FIXED_IDS[i];
      if (fids.symbol === 'USDC') {
        continue;
      }

      console.log(`adding ${fids.symbol} oracle`);
      if (fids.price) {
        await this.client.addStubOracle(this.lyraeGroupKey, this.payer);
        const tempGroup = await this.client.getLyraeGroup(this.lyraeGroupKey);
        this.oraclePks.push(new PublicKey(tempGroup.oracles[i]));
        await this.client.setStubOracle(
          this.lyraeGroupKey,
          this.oraclePks[this.oraclePks.length - 1],
          this.payer,
          fids.price,
        );
      } else {
        if (fids.oracleProvider === 'pyth') {
          const oraclePk = new PublicKey(this.PYTH_ORACLES_DEVNET[fids.symbol]);
          await this.client.addOracle(group, oraclePk, this.payer);
          this.oraclePks.push(oraclePk);
        } else if (fids.oracleProvider === 'switchboard') {
          const oraclePk = new PublicKey(
            this.SWITCHBOARD_ORACLES_DEVNET[fids.symbol],
          );
          await this.client.addOracle(group, oraclePk, this.payer);
          this.oraclePks.push(oraclePk);
        }
      }

      console.log(`listing and adding ${fids.symbol} spot market`);
      const mint = new PublicKey(fids.mint);
      const marketPk = await listMarket(
        this.connection,
        this.payer,
        this.lyraeProgramId,
        mint,
        new PublicKey(this.FIXED_IDS[this.FIXED_IDS.length - 1].mint),
        fids.baseLot,
        fids.quoteLot,
        group.dexProgramId,
      );
      this.spotMarkets.push(
        await Market.load(
          this.connection,
          marketPk,
          undefined,
          this.serumProgramId,
        ),
      );
      console.log(this.oraclePks[i].toBase58());
      console.log(marketPk.toBase58());
      await this.client.addSpotMarket(
        group,
        this.oraclePks[i],
        marketPk,
        mint,
        this.payer,
        fids.maintLeverage ? fids.maintLeverage : 10,
        fids.initLeverage ? fids.initLeverage : 5,
        fids.liquidationFee ? fids.liquidationFee : 0.05,
        0.7,
        0.06,
        1.5,
      );

      if (fids.symbol === 'BTC' || fids.symbol === 'SOL') {
        console.log(`adding ${fids.symbol} perp market`);
        await this.client.addPerpMarket(
          group,
          this.oraclePks[i],
          new PublicKey(this.FIXED_IDS[0].mint),
          this.payer,
          2 * fids.maintLeverage ? fids.maintLeverage : 10,
          2 * fids.initLeverage ? fids.initLeverage : 5,
          2 * fids.liquidationFee ? fids.liquidationFee : 0.05,
          0,
          0.0005,
          fids.baseLot,
          fids.quoteLot,
          256,
          1,
          200,
          3600,
          0,
          2,
        );
      }
      console.log('---');
    }
    if (!this.log) {
      console.log = this.logger;
    }
    console.log(
      'Succcessfully created new Lyrae Group ' + this.lyraeGroupKey.toBase58(),
    );

    return this.lyraeGroupKey;
  }

  async runCrank() {
    console.log('runCrank');
    if (!this.log) {
      console.log = function () { };
    }

    const quoteToken = new Token(
      this.connection,
      this.spotMarkets[0].quoteMintAddress,
      TOKEN_PROGRAM_ID,
      this.payer,
    );
    const quoteWallet = await quoteToken
      .getOrCreateAssociatedAccountInfo(this.payer.publicKey)
      .then((a) => a.address);

    const baseWallets = await Promise.all(
      this.spotMarkets.map((m) => {
        const token = new Token(
          this.connection,
          m.baseMintAddress,
          TOKEN_PROGRAM_ID,
          this.payer,
        );

        return token
          .getOrCreateAssociatedAccountInfo(this.payer.publicKey)
          .then((a) => a.address);
      }),
    );

    const eventQueuePks = this.spotMarkets.map(
      (market) => market['_decoded'].eventQueue,
    );

    const eventQueueAccts = await getMultipleAccounts(
      this.connection,
      eventQueuePks,
    );
    for (let i = 0; i < eventQueueAccts.length; i++) {
      const accountInfo = eventQueueAccts[i].accountInfo;
      const events = decodeEventQueue(accountInfo.data);

      if (events.length === 0) {
        continue;
      }

      const accounts: Set<string> = new Set();
      for (const event of events) {
        accounts.add(event.openOrders.toBase58());

        // Limit unique accounts to first 10
        if (accounts.size >= 10) {
          break;
        }
      }

      const openOrdersAccounts = [...accounts]
        .map((s) => new PublicKey(s))
        .sort((a, b) => a.toBuffer().swap64().compare(b.toBuffer().swap64()));

      const instr = DexInstructions.consumeEvents({
        market: this.spotMarkets[i].publicKey,
        eventQueue: this.spotMarkets[i]['_decoded'].eventQueue,
        coinFee: baseWallets[i],
        pcFee: quoteWallet,
        openOrdersAccounts,
        limit: 5,
        programId: this.serumProgramId,
      });

      const transaction = new Transaction();
      transaction.add(instr);

      console.log(
        'market',
        i,
        'sending consume events for',
        events.length,
        'events',
      );
      await this.client.sendTransaction(transaction, this.payer, []);
    }

    if (!this.log) {
      console.log = this.logger;
    }
  }

  async runKeeper() {
    console.log('runKeeper');
    if (!this.log) {
      console.log = function () { };
    }
    await this.updateCache();
    await this.updateBanksAndMarkets();
    await this.consumeEvents();
    if (!this.log) {
      console.log = this.logger;
    }
  }

  async updateBanksAndMarkets() {
    console.log('processKeeperTransactions');
    const promises: Promise<string>[] = [];
    const lyraeGroup = await this.client.getLyraeGroup(this.lyraeGroupKey);
    const perpMarkets = await Promise.all(
      [1, 3].map((marketIndex) => {
        return lyraeGroup.loadPerpMarket(this.connection, marketIndex, 6, 6);
      }),
    );
    const rootBanks = await lyraeGroup.loadRootBanks(this.connection);

    const updateRootBankTransaction = new Transaction();
    this.FIXED_IDS.forEach((token, i) => {
      if (rootBanks[i]) {
        updateRootBankTransaction.add(
          makeUpdateRootBankInstruction(
            this.lyraeProgramId,
            lyraeGroup.publicKey,
            lyraeGroup.lyraeCache,
            rootBanks[i]!.publicKey,
            rootBanks[i]!.nodeBanks.filter((n) => !n.equals(zeroKey)),
          ),
        );
      }
    });

    const updateFundingTransaction = new Transaction();
    perpMarkets.forEach((market) => {
      if (market) {
        updateFundingTransaction.add(
          makeUpdateFundingInstruction(
            this.lyraeProgramId,
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
        this.client.sendTransaction(updateRootBankTransaction, this.payer, []),
      );
    }
    if (updateFundingTransaction.instructions.length > 0) {
      promises.push(
        this.client.sendTransaction(updateFundingTransaction, this.payer, []),
      );
    }

    await Promise.all(promises);
  }

  async consumeEvents() {
    console.log('processConsumeEvents');
    const lyraeGroup = await this.client.getLyraeGroup(this.lyraeGroupKey);
    const perpMarkets = await Promise.all(
      [1, 3].map((marketIndex) => {
        return lyraeGroup.loadPerpMarket(this.connection, marketIndex, 6, 6);
      }),
    );
    const eventQueuePks = perpMarkets.map((mkt) => mkt.eventQueue);
    const eventQueueAccts = await getMultipleAccounts(
      this.connection,
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

    for (let i = 0; i < perpMktAndEventQueue.length; i++) {
      const { perpMarket, eventQueue } = perpMktAndEventQueue[i];

      const events = eventQueue.getUnconsumedEvents();
      if (events.length === 0) {
        console.log('No events to consume');
        continue;
      }

      const accounts: Set<string> = new Set();
      for (const event of events) {
        if (event.fill) {
          accounts.add(event.fill.maker.toBase58());
          accounts.add(event.fill.taker.toBase58());
        } else if (event.out) {
          accounts.add(event.out.owner.toBase58());
        }

        // Limit unique accounts to first 10
        if (accounts.size >= 10) {
          break;
        }
      }

      await this.client.consumeEvents(
        lyraeGroup,
        perpMarket,
        Array.from(accounts)
          .map((s) => new PublicKey(s))
          .sort(),
        this.payer,
        new BN(5),
      );
      console.log(`Consumed up to ${events.length} events`);
    }
  }

  async updateCache() {
    console.log('processUpdateCache');
    const batchSize = 8;
    const promises: Promise<string>[] = [];
    const lyraeGroup = await this.client.getLyraeGroup(this.lyraeGroupKey);
    const rootBanks = lyraeGroup.tokens
      .map((t) => t.rootBank)
      .filter((t) => !t.equals(zeroKey));
    const oracles = lyraeGroup.oracles.filter((o) => !o.equals(zeroKey));
    const perpMarkets = lyraeGroup.perpMarkets
      .filter((pm) => !pm.isEmpty())
      .map((pm) => pm.perpMarket);

    for (let i = 0; i < rootBanks.length / batchSize; i++) {
      const startIndex = i * batchSize;
      const endIndex = i * batchSize + batchSize;
      const cacheTransaction = new Transaction();
      cacheTransaction.add(
        makeCacheRootBankInstruction(
          this.lyraeProgramId,
          lyraeGroup.publicKey,
          lyraeGroup.lyraeCache,
          rootBanks.slice(startIndex, endIndex),
        ),
      );

      cacheTransaction.add(
        makeCachePricesInstruction(
          this.lyraeProgramId,
          lyraeGroup.publicKey,
          lyraeGroup.lyraeCache,
          oracles.slice(startIndex, endIndex),
        ),
      );

      cacheTransaction.add(
        makeCachePerpMarketsInstruction(
          this.lyraeProgramId,
          lyraeGroup.publicKey,
          lyraeGroup.lyraeCache,
          perpMarkets.slice(startIndex, endIndex),
        ),
      );
      if (cacheTransaction.instructions.length > 0) {
        promises.push(
          this.client.sendTransaction(cacheTransaction, this.payer, []),
        );
      }
    }

    await Promise.all(promises);
  }

  async setOracle(marketIndex, price) {
    await this.client.setStubOracle(
      this.lyraeGroupKey,
      this.oraclePks[marketIndex],
      this.payer,
      price,
    );
  }
}
