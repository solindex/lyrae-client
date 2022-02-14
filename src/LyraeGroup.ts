import { Connection, PublicKey } from '@solana/web3.js';
import { Big } from 'big.js';
import BN from 'bn.js';
import { NodeBank, NodeBankLayout } from '.';
import { I80F48, ONE_I80F48 } from './utils/fixednum';
import {
  MetaData,
  RootBankLayout,
  TokenInfo,
  SpotMarketInfo,
  PerpMarketInfo,
  PerpMarketLayout,
  LyraeCache,
  LyraeCacheLayout,
  QUOTE_INDEX,
  MAX_TOKENS,
} from './layout';
import PerpMarket from './PerpMarket';
import RootBank from './RootBank';
import { getMultipleAccounts, zeroKey } from './utils/utils';

export default class LyraeGroup {
  publicKey: PublicKey;
  metaData!: MetaData;
  numOracles!: number;
  tokens!: TokenInfo[];
  spotMarkets!: SpotMarketInfo[];
  perpMarkets!: PerpMarketInfo[];
  oracles!: PublicKey[];
  signerNonce!: BN;
  signerKey!: PublicKey;
  admin!: PublicKey;
  dexProgramId!: PublicKey;
  lyraeCache!: PublicKey;
  insuranceVault!: PublicKey;
  srmVault!: PublicKey;
  msrmVault!: PublicKey;
  feesVault!: PublicKey;
  validInterval!: number[];

  rootBankAccounts: (RootBank | undefined)[];

  maxlyraeAccounts!: BN;
  numlyraeAccounts!: BN;

  constructor(publicKey: PublicKey, decoded: any) {
    this.publicKey = publicKey;
    Object.assign(this, decoded);
    this.oracles = this.oracles.filter((o) => !o.equals(zeroKey));

    this.rootBankAccounts = new Array(MAX_TOKENS).fill(undefined);
  }

  getOracleIndex(oracle: PublicKey): number {
    for (let i = 0; i < this.numOracles; i++) {
      if (this.oracles[i].equals(oracle)) {
        return i;
      }
    }
    throw new Error('This Oracle does not belong to this LyraeGroup');
  }

  getSpotMarketIndex(spotMarketPk: PublicKey): number {
    for (let i = 0; i < this.numOracles; i++) {
      if (this.spotMarkets[i].spotMarket.equals(spotMarketPk)) {
        return i;
      }
    }
    throw new Error('This Market does not belong to this LyraeGroup');
  }

  getPerpMarketIndex(perpMarketPk: PublicKey): number {
    for (let i = 0; i < this.numOracles; i++) {
      if (this.perpMarkets[i].perpMarket.equals(perpMarketPk)) {
        return i;
      }
    }
    throw new Error('This PerpMarket does not belong to this LyraeGroup');
  }

  getTokenIndex(token: PublicKey): number {
    for (let i = 0; i < this.tokens.length; i++) {
      if (this.tokens[i].mint.equals(token)) {
        return i;
      }
    }
    throw new Error('This token does not belong in this LyraeGroup');
  }

  getRootBankIndex(rootBank: PublicKey): number {
    for (let i = 0; i < this.tokens.length; i++) {
      if (this.tokens[i].rootBank.equals(rootBank)) {
        return i;
      }
    }
    throw new Error('This root bank does not belong in this LyraeGroup');
  }

  getBorrowRate(tokenIndex: number): I80F48 {
    const rootBank = this.rootBankAccounts[tokenIndex];
    if (!rootBank)
      throw new Error(`Root bank at index ${tokenIndex} is not loaded`);

    return rootBank.getBorrowRate(this);
  }

  getDepositRate(tokenIndex: number): I80F48 {
    const rootBank = this.rootBankAccounts[tokenIndex];
    if (!rootBank)
      throw new Error(`Root bank at index ${tokenIndex} is not loaded`);

    return rootBank.getDepositRate(this);
  }

  getTokenDecimals(tokenIndex: number): number {
    const tokenInfo = this.tokens[tokenIndex];
    if (tokenInfo.decimals == 0) {
      if (this.oracles[tokenIndex].equals(zeroKey)) {
        throw new Error('No oracle for this tokenIndex');
      } else {
        return 6;
      }
    } else {
      return tokenInfo.decimals;
    }
  }

  cachePriceToUi(price: I80F48, tokenIndex: number): number {
    const decimalAdj = new Big(10).pow(
      this.getTokenDecimals(tokenIndex) - this.getTokenDecimals(QUOTE_INDEX),
    );
    return price.toBig().mul(decimalAdj).toNumber();
  }

  getPrice(tokenIndex: number, lyraeCache: LyraeCache): I80F48 {
    if (tokenIndex === QUOTE_INDEX) return ONE_I80F48;
    const decimalAdj = new Big(10).pow(
      this.getTokenDecimals(tokenIndex) - this.getTokenDecimals(QUOTE_INDEX),
    );

    return I80F48.fromBig(
      lyraeCache.priceCache[tokenIndex]?.price.toBig().mul(decimalAdj),
    );
  }

  getPriceUi(tokenIndex: number, lyraeCache: LyraeCache): number {
    if (tokenIndex === QUOTE_INDEX) return 1;

    return (
      lyraeCache.priceCache[tokenIndex]?.price.toNumber() *
      Math.pow(
        10,
        this.getTokenDecimals(tokenIndex) - this.getTokenDecimals(QUOTE_INDEX),
      )
    );
  }

  getPriceNative(tokenIndex: number, lyraeCache: LyraeCache): I80F48 {
    if (tokenIndex === QUOTE_INDEX) return ONE_I80F48;

    return lyraeCache.priceCache[tokenIndex].price;
  }

  getUiTotalDeposit(tokenIndex: number): I80F48 {
    const rootBank = this.rootBankAccounts[tokenIndex];
    if (!rootBank)
      throw new Error(`Root bank at index ${tokenIndex} is not loaded`);

    return rootBank.getUiTotalDeposit(this);
  }

  getUiTotalBorrow(tokenIndex: number): I80F48 {
    const rootBank = this.rootBankAccounts[tokenIndex];
    if (!rootBank)
      throw new Error(`Root bank at index ${tokenIndex} is not loaded`);

    return rootBank.getUiTotalBorrow(this);
  }

  async loadCache(connection: Connection): Promise<LyraeCache> {
    const account = await connection.getAccountInfo(this.lyraeCache);
    if (!account || !account?.data) throw new Error('Unable to load cache');

    const decoded = LyraeCacheLayout.decode(account.data);
    return new LyraeCache(this.lyraeCache, decoded);
  }

  onCacheChange(connection: Connection, cb: (c: LyraeCache) => void): number {
    const sub = connection.onAccountChange(
      this.lyraeCache,
      (ai, _) => {
        const decoded = LyraeCacheLayout.decode(ai.data);
        const parsed = new LyraeCache(this.lyraeCache, decoded);
        cb(parsed);
      },
      connection.commitment,
    );

    return sub;
  }

  async loadRootBanks(
    connection: Connection,
  ): Promise<(RootBank | undefined)[]> {
    const rootBankPks = this.tokens
      .map((t) => t.rootBank)
      .filter((rB) => !rB.equals(zeroKey));

    const rootBankAccts = await getMultipleAccounts(connection, rootBankPks);

    const parsedRootBanks = rootBankAccts.map((acc) => {
      const decoded = RootBankLayout.decode(acc.accountInfo.data);
      return new RootBank(acc.publicKey, decoded);
    });

    const nodeBankPks = parsedRootBanks.map((bank) =>
      bank.nodeBanks.filter((key) => !key.equals(zeroKey)),
    );
    const nodeBankAccts = await getMultipleAccounts(
      connection,
      nodeBankPks.flat(),
    );

    const nodeBankAccounts = nodeBankAccts.map((acc) => {
      const decoded = NodeBankLayout.decode(acc.accountInfo.data);
      return new NodeBank(acc.publicKey, decoded);
    });

    let nodeBankIndex = 0;
    for (let i = 0; i < parsedRootBanks.length; i++) {
      const rootBank = parsedRootBanks[i];
      const numNodeBanks = rootBank.nodeBanks.filter(
        (pk) => !pk.equals(zeroKey),
      ).length;

      rootBank.nodeBankAccounts = nodeBankAccounts.slice(
        nodeBankIndex,
        nodeBankIndex + numNodeBanks,
      );
      nodeBankIndex += numNodeBanks;
    }

    this.rootBankAccounts = this.tokens.map((t) => {
      const rootBank = parsedRootBanks.find((rB) =>
        rB.publicKey.equals(t.rootBank),
      );
      return rootBank ?? undefined;
    });

    return this.rootBankAccounts;
  }

  async loadPerpMarket(
    connection: Connection,
    marketIndex: number,
    baseDecimals: number,
    quoteDecimals: number,
  ): Promise<PerpMarket> {
    const pk = this.perpMarkets[marketIndex].perpMarket;
    const acc = await connection.getAccountInfo(pk);
    const decoded = PerpMarketLayout.decode(acc?.data);
    return new PerpMarket(pk, baseDecimals, quoteDecimals, decoded);
  }

  getQuoteTokenInfo(): TokenInfo {
    return this.tokens[this.tokens.length - 1];
  }
}