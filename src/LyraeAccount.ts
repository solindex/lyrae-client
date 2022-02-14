import { Market, OpenOrders, Orderbook } from '@project-serum/serum';
import { AccountInfo, Connection, PublicKey } from '@solana/web3.js';
import { I80F48, ONE_I80F48, ZERO_I80F48 } from './utils/fixednum';
import {
  FREE_ORDER_SLOT,
  LyraeAccountLayout,
  LyraeCache,
  MAX_PAIRS,
  MetaData,
  QUOTE_INDEX,
  RootBankCache,
} from './layout';
import {
  getWeights,
  nativeI80F48ToUi,
  nativeToUi,
  splitOpenOrders,
  zeroKey,
} from './utils/utils';
import RootBank from './RootBank';
import BN from 'bn.js';
import LyraeGroup from './LyraeGroup';
import PerpAccount from './PerpAccount';
import { EOL } from 'os';
import {
  AdvancedOrdersLayout,
  getMarketByPublicKey,
  getMultipleAccounts,
  getPriceFromKey,
  getTokenByMint,
  GroupConfig,
  PerpMarketConfig,
  PerpTriggerOrder,
  sleep,
  TokenConfig,
  ZERO_BN,
  Config,
} from '.';
import PerpMarket from './PerpMarket';
import { Order } from '@project-serum/serum/lib/market';
import IDS from './ids.json';

export default class LyraeAccount {
  publicKey: PublicKey;
  metaData!: MetaData;
  lyraeGroup!: PublicKey;
  owner!: PublicKey;

  inMarginBasket!: boolean[];
  numInMarginBasket!: number;
  deposits!: I80F48[];
  borrows!: I80F48[];

  spotOpenOrders!: PublicKey[];
  spotOpenOrdersAccounts: (OpenOrders | undefined)[];

  perpAccounts!: PerpAccount[];
  orderMarket!: number[];
  orderSide!: string[];
  orders!: BN[];
  clientOrderIds!: BN[];

  msrmAmount!: BN;

  beingLiquidated!: boolean;
  isBankrupt!: boolean;
  info!: number[];

  advancedOrdersKey!: PublicKey;
  advancedOrders: { perpTrigger?: PerpTriggerOrder }[];

  notUpgradable!: boolean;
  delegate!: PublicKey;

  constructor(publicKey: PublicKey, decoded: any) {
    this.publicKey = publicKey;
    this.spotOpenOrdersAccounts = new Array(MAX_PAIRS).fill(undefined);
    this.advancedOrders = [];
    Object.assign(this, decoded);
  }

  get name(): string {
    return this.info
      ? String.fromCharCode(...this.info).replace(
        new RegExp(String.fromCharCode(0), 'g'),
        '',
      )
      : '';
  }

  getLiquidationPrice(
    lyraeGroup: LyraeGroup,
    lyraeCache: LyraeCache,
    oracleIndex: number,
  ): I80F48 | undefined {
    const { spot, perps, quote } = this.getHealthComponents(
      lyraeGroup,
      lyraeCache,
    );

    let partialHealth = quote;
    let weightedAsset = ZERO_I80F48;
    for (let i = 0; i < lyraeGroup.numOracles; i++) {
      const w = getWeights(lyraeGroup, i, 'Maint');
      if (i === oracleIndex) {
        const weightedSpot = spot[i].mul(
          spot[i].isPos() ? w.spotAssetWeight : w.spotLiabWeight,
        );
        const weightedPerps = perps[i].mul(
          perps[i].isPos() ? w.perpAssetWeight : w.perpLiabWeight,
        );
        weightedAsset = weightedSpot.add(weightedPerps).neg();
      } else {
        const price = lyraeCache.priceCache[i].price;
        const spotHealth = spot[i]
          .mul(price)
          .mul(spot[i].isPos() ? w.spotAssetWeight : w.spotLiabWeight);
        const perpHealth = perps[i]
          .mul(price)
          .mul(perps[i].isPos() ? w.perpAssetWeight : w.perpLiabWeight);
        partialHealth = partialHealth.add(spotHealth).add(perpHealth);
      }
    }

    if (weightedAsset.isZero()) {
      return undefined;
    }
    const liqPrice = partialHealth.div(weightedAsset);
    if (liqPrice.isNeg()) {
      return undefined;
    }
    return liqPrice.mul(
      // adjust for decimals in the price
      I80F48.fromNumber(
        Math.pow(
          10,
          lyraeGroup.tokens[oracleIndex].decimals -
          lyraeGroup.tokens[QUOTE_INDEX].decimals,
        ),
      ),
    );
  }

  hasAnySpotOrders(): boolean {
    return this.inMarginBasket.some((b) => b);
  }

  async reload(
    connection: Connection,
    dexProgramId: PublicKey | undefined = undefined,
  ): Promise<LyraeAccount> {
    const acc = await connection.getAccountInfo(this.publicKey);
    Object.assign(this, LyraeAccountLayout.decode(acc?.data));
    if (dexProgramId) {
      await this.loadOpenOrders(connection, dexProgramId);
    }
    return this;
  }

  async reloadFromSlot(
    connection: Connection,
    lastSlot = 0,
    dexProgramId: PublicKey | undefined = undefined,
  ): Promise<[LyraeAccount, number]> {
    let slot = -1;
    let value: AccountInfo<Buffer> | null = null;

    while (slot <= lastSlot) {
      const response = await connection.getAccountInfoAndContext(
        this.publicKey,
      );
      slot = response.context?.slot;
      value = response.value;
      await sleep(250);
    }

    Object.assign(this, LyraeAccountLayout.decode(value?.data));
    if (dexProgramId) {
      await this.loadOpenOrders(connection, dexProgramId);
    }
    return [this, slot];
  }

  async loadSpotOrdersForMarket(
    connection: Connection,
    market: Market,
    marketIndex: number,
  ): Promise<Order[]> {
    const [bidsInfo, asksInfo] = await getMultipleAccounts(connection, [
      market.bidsAddress,
      market.asksAddress,
    ]);

    const bids = Orderbook.decode(market, bidsInfo.accountInfo.data);
    const asks = Orderbook.decode(market, asksInfo.accountInfo.data);

    return [...bids, ...asks].filter((o) =>
      o.openOrdersAddress.equals(this.spotOpenOrders[marketIndex]),
    );
  }

  async loadOpenOrders(
    connection: Connection,
    serumDexPk: PublicKey,
  ): Promise<(OpenOrders | undefined)[]> {
    const accounts = await getMultipleAccounts(
      connection,
      this.spotOpenOrders.filter((pk) => !pk.equals(zeroKey)),
    );

    this.spotOpenOrdersAccounts = this.spotOpenOrders.map((openOrderPk) => {
      if (openOrderPk.equals(zeroKey)) {
        return undefined;
      }
      const account = accounts.find((a) => a.publicKey.equals(openOrderPk));
      return account
        ? OpenOrders.fromAccountInfo(
          openOrderPk,
          account.accountInfo,
          serumDexPk,
        )
        : undefined;
    });
    return this.spotOpenOrdersAccounts;
  }

  async loadAdvancedOrders(
    connection: Connection,
  ): Promise<{ perpTrigger?: PerpTriggerOrder }[]> {
    if (this.advancedOrdersKey.equals(zeroKey)) return [];

    const acc = await connection.getAccountInfo(this.advancedOrdersKey);
    const decoded = AdvancedOrdersLayout.decode(acc?.data);
    this.advancedOrders = decoded.orders;
    return decoded.orders;
  }

  getNativeDeposit(
    rootBank: RootBank | RootBankCache,
    tokenIndex: number,
  ): I80F48 {
    return rootBank.depositIndex.mul(this.deposits[tokenIndex]);
  }

  getNativeBorrow(
    rootBank: RootBank | RootBankCache,
    tokenIndex: number,
  ): I80F48 {
    return rootBank.borrowIndex.mul(this.borrows[tokenIndex]);
  }

  getUiDeposit(
    rootBank: RootBank | RootBankCache,
    lyraeGroup: LyraeGroup,
    tokenIndex: number,
  ): I80F48 {
    return nativeI80F48ToUi(
      this.getNativeDeposit(rootBank, tokenIndex).floor(),
      lyraeGroup.getTokenDecimals(tokenIndex),
    );
  }

  getUiBorrow(
    rootBank: RootBank | RootBankCache,
    lyraeGroup: LyraeGroup,
    tokenIndex: number,
  ): I80F48 {
    return nativeI80F48ToUi(
      this.getNativeBorrow(rootBank, tokenIndex).ceil(),
      lyraeGroup.getTokenDecimals(tokenIndex),
    );
  }

  getSpotVal(lyraeGroup, lyraeCache, index, assetWeight) {
    let assetsVal = ZERO_I80F48;
    const price = lyraeGroup.getPrice(index, lyraeCache);

    const depositVal = this.getUiDeposit(
      lyraeCache.rootBankCache[index],
      lyraeGroup,
      index,
    )
      .mul(price)
      .mul(assetWeight);
    assetsVal = assetsVal.add(depositVal);

    const openOrdersAccount = this.spotOpenOrdersAccounts[index];
    if (openOrdersAccount !== undefined) {
      assetsVal = assetsVal.add(
        I80F48.fromNumber(
          nativeToUi(
            openOrdersAccount.baseTokenTotal.toNumber(),
            lyraeGroup.tokens[index].decimals,
          ),
        )
          .mul(price)
          .mul(assetWeight),
      );
      assetsVal = assetsVal.add(
        I80F48.fromNumber(
          nativeToUi(
            openOrdersAccount.quoteTokenTotal.toNumber() +
            openOrdersAccount['referrerRebatesAccrued'].toNumber(),
            lyraeGroup.tokens[QUOTE_INDEX].decimals,
          ),
        ),
      );
    }

    return assetsVal;
  }

  getAssetsVal(
    lyraeGroup: LyraeGroup,
    lyraeCache: LyraeCache,
    healthType?: HealthType,
  ): I80F48 {
    let assetsVal = ZERO_I80F48;
    // quote currency deposits
    assetsVal = assetsVal.add(
      this.getUiDeposit(
        lyraeCache.rootBankCache[QUOTE_INDEX],
        lyraeGroup,
        QUOTE_INDEX,
      ),
    );

    for (let i = 0; i < lyraeGroup.numOracles; i++) {
      let assetWeight = ONE_I80F48;
      if (healthType === 'Maint') {
        assetWeight = lyraeGroup.spotMarkets[i].maintAssetWeight;
      } else if (healthType === 'Init') {
        assetWeight = lyraeGroup.spotMarkets[i].initAssetWeight;
      }

      const spotVal = this.getSpotVal(lyraeGroup, lyraeCache, i, assetWeight);
      assetsVal = assetsVal.add(spotVal);

      const price = lyraeCache.priceCache[i].price;
      const perpsUiAssetVal = nativeI80F48ToUi(
        this.perpAccounts[i].getAssetVal(
          lyraeGroup.perpMarkets[i],
          price,
          lyraeCache.perpMarketCache[i].shortFunding,
          lyraeCache.perpMarketCache[i].longFunding,
        ),
        lyraeGroup.tokens[QUOTE_INDEX].decimals,
      );

      assetsVal = assetsVal.add(perpsUiAssetVal);
    }

    return assetsVal;
  }

  getLiabsVal(
    lyraeGroup: LyraeGroup,
    lyraeCache: LyraeCache,
    healthType?: HealthType,
  ): I80F48 {
    let liabsVal = ZERO_I80F48;

    liabsVal = liabsVal.add(
      this.getUiBorrow(
        lyraeCache.rootBankCache[QUOTE_INDEX],
        lyraeGroup,
        QUOTE_INDEX,
      ),
    );

    for (let i = 0; i < lyraeGroup.numOracles; i++) {
      let liabWeight = ONE_I80F48;
      const price = lyraeGroup.getPrice(i, lyraeCache);
      if (healthType === 'Maint') {
        liabWeight = lyraeGroup.spotMarkets[i].maintLiabWeight;
      } else if (healthType === 'Init') {
        liabWeight = lyraeGroup.spotMarkets[i].initLiabWeight;
      }

      liabsVal = liabsVal.add(
        this.getUiBorrow(lyraeCache.rootBankCache[i], lyraeGroup, i).mul(
          price.mul(liabWeight),
        ),
      );

      const perpsUiLiabsVal = nativeI80F48ToUi(
        this.perpAccounts[i].getLiabsVal(
          lyraeGroup.perpMarkets[i],
          lyraeCache.priceCache[i].price,
          lyraeCache.perpMarketCache[i].shortFunding,
          lyraeCache.perpMarketCache[i].longFunding,
        ),
        lyraeGroup.tokens[QUOTE_INDEX].decimals,
      );

      liabsVal = liabsVal.add(perpsUiLiabsVal);
    }
    return liabsVal;
  }

  getNativeLiabsVal(
    lyraeGroup: LyraeGroup,
    lyraeCache: LyraeCache,
    healthType?: HealthType,
  ): I80F48 {
    let liabsVal = ZERO_I80F48;

    liabsVal = liabsVal.add(
      this.getNativeBorrow(lyraeCache.rootBankCache[QUOTE_INDEX], QUOTE_INDEX),
    );

    for (let i = 0; i < lyraeGroup.numOracles; i++) {
      const price = lyraeCache.priceCache[i].price;
      let liabWeight = ONE_I80F48;
      if (healthType === 'Maint') {
        liabWeight = lyraeGroup.spotMarkets[i].maintLiabWeight;
      } else if (healthType === 'Init') {
        liabWeight = lyraeGroup.spotMarkets[i].initLiabWeight;
      }

      liabsVal = liabsVal.add(
        this.getNativeBorrow(lyraeCache.rootBankCache[i], i).mul(
          price.mul(liabWeight),
        ),
      );

      liabsVal = liabsVal.add(
        this.perpAccounts[i].getLiabsVal(
          lyraeGroup.perpMarkets[i],
          price,
          lyraeCache.perpMarketCache[i].shortFunding,
          lyraeCache.perpMarketCache[i].longFunding,
        ),
      );
    }
    return liabsVal;
  }

  getNet(bankCache: RootBankCache, tokenIndex: number): I80F48 {
    return this.deposits[tokenIndex]
      .mul(bankCache.depositIndex)
      .sub(this.borrows[tokenIndex].mul(bankCache.borrowIndex));
  }

  getWeightedAssetsLiabsVals(
    lyraeGroup: LyraeGroup,
    lyraeCache: LyraeCache,
    spot: I80F48[],
    perps: I80F48[],
    quote: I80F48,
    healthType?: HealthType,
  ): { assets: I80F48; liabs: I80F48 } {
    let assets = ZERO_I80F48;
    let liabs = ZERO_I80F48;

    if (quote.isPos()) {
      assets = assets.add(quote);
    } else {
      liabs = liabs.add(quote.neg());
    }

    for (let i = 0; i < lyraeGroup.numOracles; i++) {
      const w = getWeights(lyraeGroup, i, healthType);
      const price = lyraeCache.priceCache[i].price;
      if (spot[i].isPos()) {
        assets = spot[i].mul(price).mul(w.spotAssetWeight).add(assets);
      } else {
        liabs = spot[i].neg().mul(price).mul(w.spotLiabWeight).add(liabs);
      }

      if (perps[i].isPos()) {
        assets = perps[i].mul(price).mul(w.perpAssetWeight).add(assets);
      } else {
        liabs = perps[i].neg().mul(price).mul(w.perpLiabWeight).add(liabs);
      }
    }
    return { assets, liabs };
  }

  getHealthFromComponents(
    lyraeGroup: LyraeGroup,
    lyraeCache: LyraeCache,
    spot: I80F48[],
    perps: I80F48[],
    quote: I80F48,
    healthType: HealthType,
  ): I80F48 {
    const health = quote;
    for (let i = 0; i < lyraeGroup.numOracles; i++) {
      const w = getWeights(lyraeGroup, i, healthType);
      const price = lyraeCache.priceCache[i].price;
      const spotHealth = spot[i]
        .mul(price)
        .imul(spot[i].isPos() ? w.spotAssetWeight : w.spotLiabWeight);
      const perpHealth = perps[i]
        .mul(price)
        .imul(perps[i].isPos() ? w.perpAssetWeight : w.perpLiabWeight);

      health.iadd(spotHealth).iadd(perpHealth);
    }

    return health;
  }

  getHealthsFromComponents(
    lyraeGroup: LyraeGroup,
    lyraeCache: LyraeCache,
    spot: I80F48[],
    perps: I80F48[],
    quote: I80F48,
    healthType: HealthType,
  ): { spot: I80F48; perp: I80F48 } {
    const spotHealth = quote;
    const perpHealth = quote;
    for (let i = 0; i < lyraeGroup.numOracles; i++) {
      const w = getWeights(lyraeGroup, i, healthType);
      const price = lyraeCache.priceCache[i].price;
      const _spotHealth = spot[i]
        .mul(price)
        .imul(spot[i].isPos() ? w.spotAssetWeight : w.spotLiabWeight);
      const _perpHealth = perps[i]
        .mul(price)
        .imul(perps[i].isPos() ? w.perpAssetWeight : w.perpLiabWeight);

      spotHealth.iadd(_spotHealth);
      perpHealth.iadd(_perpHealth);
    }

    return { spot: spotHealth, perp: perpHealth };
  }

  getMarketMarginAvailable(
    lyraeGroup: LyraeGroup,
    lyraeCache: LyraeCache,
    marketIndex: number,
    marketType: 'spot' | 'perp',
  ): I80F48 {
    const health = this.getHealth(lyraeGroup, lyraeCache, 'Init');

    if (health.lte(ZERO_I80F48)) {
      return ZERO_I80F48;
    }
    const w = getWeights(lyraeGroup, marketIndex, 'Init');
    const weight =
      marketType === 'spot' ? w.spotAssetWeight : w.perpAssetWeight;
    if (weight.gte(ONE_I80F48)) {
      // This is actually an error state and should not happen
      return health;
    } else {
      return health.div(ONE_I80F48.sub(weight));
    }
  }

  getAvailableBalance(
    lyraeGroup: LyraeGroup,
    lyraeCache: LyraeCache,
    tokenIndex: number,
  ): I80F48 {
    const health = this.getHealth(lyraeGroup, lyraeCache, 'Init');
    const net = this.getNet(lyraeCache.rootBankCache[tokenIndex], tokenIndex);

    if (tokenIndex === QUOTE_INDEX) {
      return health.min(net).max(ZERO_I80F48);
    } else {
      const w = getWeights(lyraeGroup, tokenIndex, 'Init');

      return net
        .min(
          health
            .div(w.spotAssetWeight)
            .div(lyraeCache.priceCache[tokenIndex].price),
        )
        .max(ZERO_I80F48);
    }
  }

  getHealthComponents(
    lyraeGroup: LyraeGroup,
    lyraeCache: LyraeCache,
  ): { spot: I80F48[]; perps: I80F48[]; quote: I80F48 } {
    const spot = Array(lyraeGroup.numOracles).fill(ZERO_I80F48);
    const perps = Array(lyraeGroup.numOracles).fill(ZERO_I80F48);
    const quote = this.getNet(
      lyraeCache.rootBankCache[QUOTE_INDEX],
      QUOTE_INDEX,
    );

    for (let i = 0; i < lyraeGroup.numOracles; i++) {
      const bankCache = lyraeCache.rootBankCache[i];
      const price = lyraeCache.priceCache[i].price;
      const baseNet = this.getNet(bankCache, i);

      // Evaluate spot first
      const openOrders = this.spotOpenOrdersAccounts[i];
      if (this.inMarginBasket[i] && openOrders !== undefined) {
        const { quoteFree, quoteLocked, baseFree, baseLocked } =
          splitOpenOrders(openOrders);

        // base total if all bids were executed
        const bidsBaseNet = baseNet
          .add(quoteLocked.div(price))
          .iadd(baseFree)
          .iadd(baseLocked);

        // base total if all asks were executed
        const asksBaseNet = baseNet.add(baseFree);

        // bids case worse if it has a higher absolute position
        if (bidsBaseNet.abs().gt(asksBaseNet.abs())) {
          spot[i] = bidsBaseNet;
          quote.iadd(quoteFree);
        } else {
          spot[i] = asksBaseNet;
          quote.iadd(baseLocked.mul(price)).iadd(quoteFree).iadd(quoteLocked);
        }
      } else {
        spot[i] = baseNet;
      }

      // Evaluate perps
      if (!lyraeGroup.perpMarkets[i].perpMarket.equals(zeroKey)) {
        const perpMarketCache = lyraeCache.perpMarketCache[i];
        const perpAccount = this.perpAccounts[i];
        const baseLotSize = lyraeGroup.perpMarkets[i].baseLotSize;
        const quoteLotSize = lyraeGroup.perpMarkets[i].quoteLotSize;
        const takerQuote = I80F48.fromI64(
          perpAccount.takerQuote.mul(quoteLotSize),
        );
        const basePos = I80F48.fromI64(
          perpAccount.basePosition.add(perpAccount.takerBase).imul(baseLotSize),
        );
        const bidsQuantity = I80F48.fromI64(
          perpAccount.bidsQuantity.mul(baseLotSize),
        );
        const asksQuantity = I80F48.fromI64(
          perpAccount.asksQuantity.mul(baseLotSize),
        );

        const bidsBaseNet = basePos.add(bidsQuantity);
        const asksBaseNet = basePos.sub(asksQuantity);

        if (bidsBaseNet.abs().gt(asksBaseNet.abs())) {
          const quotePos = perpAccount
            .getQuotePosition(perpMarketCache)
            .add(takerQuote)
            .isub(bidsQuantity.mul(price));
          quote.iadd(quotePos);
          perps[i] = bidsBaseNet;
        } else {
          const quotePos = perpAccount
            .getQuotePosition(perpMarketCache)
            .add(takerQuote)
            .iadd(asksQuantity.mul(price));
          quote.iadd(quotePos);
          perps[i] = asksBaseNet;
        }
      } else {
        perps[i] = ZERO_I80F48;
      }
    }

    return { spot, perps, quote };
  }

  getHealth(
    lyraeGroup: LyraeGroup,
    lyraeCache: LyraeCache,
    healthType: HealthType,
  ): I80F48 {
    const { spot, perps, quote } = this.getHealthComponents(
      lyraeGroup,
      lyraeCache,
    );
    const health = this.getHealthFromComponents(
      lyraeGroup,
      lyraeCache,
      spot,
      perps,
      quote,
      healthType,
    );
    return health;
  }

  getHealthRatio(
    lyraeGroup: LyraeGroup,
    lyraeCache: LyraeCache,
    healthType: HealthType,
  ): I80F48 {
    const { spot, perps, quote } = this.getHealthComponents(
      lyraeGroup,
      lyraeCache,
    );

    const { assets, liabs } = this.getWeightedAssetsLiabsVals(
      lyraeGroup,
      lyraeCache,
      spot,
      perps,
      quote,
      healthType,
    );

    if (liabs.gt(ZERO_I80F48)) {
      return assets.div(liabs).sub(ONE_I80F48).mul(I80F48.fromNumber(100));
    } else {
      return I80F48.fromNumber(100);
    }
  }

  computeValue(lyraeGroup: LyraeGroup, lyraeCache: LyraeCache): I80F48 {
    return this.getAssetsVal(lyraeGroup, lyraeCache).sub(
      this.getLiabsVal(lyraeGroup, lyraeCache),
    );
  }

  lyrAccruedValue(lyraeGroup: LyraeGroup, lyraeCache: LyraeCache): I80F48 {
    const config = new Config(IDS);
    const groupConfig = config.groups.find((g) =>
      g.publicKey.equals(lyraeGroup.publicKey),
    ) as GroupConfig;

    const mngoOracleIndex = groupConfig.oracles.findIndex(
      (t) => t.symbol === 'LYR',
    );
    const mngoTokenIndex = groupConfig.tokens.findIndex(
      (t) => t.symbol === 'LYR',
    );

    const mngoPrice = lyraeCache.priceCache[mngoOracleIndex].price;
    const mngoDecimals = lyraeGroup.tokens[mngoTokenIndex].decimals;

    let val = ZERO_I80F48;
    for (let i = 0; i < lyraeGroup.numOracles; i++) {
      const mgnoAccruedUiVal = nativeI80F48ToUi(
        I80F48.fromI64(this.perpAccounts[i].lyrAccrued).mul(mngoPrice),
        mngoDecimals,
      );

      val = val.add(mgnoAccruedUiVal);
    }

    return val;
  }

  getLeverage(lyraeGroup: LyraeGroup, lyraeCache: LyraeCache): I80F48 {
    const liabs = this.getLiabsVal(lyraeGroup, lyraeCache);
    const assets = this.getAssetsVal(lyraeGroup, lyraeCache);

    if (assets.gt(ZERO_I80F48)) {
      return liabs.div(assets.sub(liabs));
    }
    return ZERO_I80F48;
  }

  calcTotalPerpUnsettledPnl(
    lyraeGroup: LyraeGroup,
    lyraeCache: LyraeCache,
  ): I80F48 {
    let pnl = ZERO_I80F48;
    for (let i = 0; i < lyraeGroup.perpMarkets.length; i++) {
      const perpMarketInfo = lyraeGroup.perpMarkets[i];
      if (perpMarketInfo.isEmpty()) continue;

      const price = lyraeCache.getPrice(i);
      pnl = pnl.add(
        this.perpAccounts[i].getPnl(
          perpMarketInfo,
          lyraeCache.perpMarketCache[i],
          price,
        ),
      );
    }
    return pnl;
  }

  calcTotalPerpPosUnsettledPnl(
    lyraeGroup: LyraeGroup,
    lyraeCache: LyraeCache,
  ): I80F48 {
    let pnl = ZERO_I80F48;
    for (let i = 0; i < lyraeGroup.perpMarkets.length; i++) {
      const perpMarketInfo = lyraeGroup.perpMarkets[i];
      if (perpMarketInfo.isEmpty()) continue;

      const price = lyraeCache.getPrice(i);
      const perpAccountPnl = this.perpAccounts[i].getPnl(
        perpMarketInfo,
        lyraeCache.perpMarketCache[i],
        price,
      );
      if (perpAccountPnl.isPos()) {
        pnl = pnl.add(perpAccountPnl);
      }
    }
    return pnl;
  }

  getMaxLeverageForMarket(
    lyraeGroup: LyraeGroup,
    lyraeCache: LyraeCache,
    marketIndex: number,
    market: Market | PerpMarket,
    side: 'buy' | 'sell',
    price: I80F48,
  ): {
    max: I80F48;
    uiDepositVal: I80F48;
    deposits: I80F48;
    uiBorrowVal: I80F48;
    borrows: I80F48;
  } {
    const initHealth = this.getHealth(lyraeGroup, lyraeCache, 'Init');
    const healthDecimals = I80F48.fromNumber(
      Math.pow(10, lyraeGroup.tokens[QUOTE_INDEX].decimals),
    );
    const uiInitHealth = initHealth.div(healthDecimals);

    let uiDepositVal = ZERO_I80F48;
    let uiBorrowVal = ZERO_I80F48;
    let initLiabWeight, initAssetWeight, deposits, borrows;

    if (market instanceof PerpMarket) {
      ({ initLiabWeight, initAssetWeight } =
        lyraeGroup.perpMarkets[marketIndex]);

      const basePos = this.perpAccounts[marketIndex].basePosition;

      if (basePos.gt(ZERO_BN)) {
        deposits = I80F48.fromNumber(market.baseLotsToNumber(basePos));
        uiDepositVal = deposits.mul(price);
      } else {
        borrows = I80F48.fromNumber(market.baseLotsToNumber(basePos)).abs();
        uiBorrowVal = borrows.mul(price);
      }
    } else {
      ({ initLiabWeight, initAssetWeight } =
        lyraeGroup.spotMarkets[marketIndex]);

      deposits = this.getUiDeposit(
        lyraeCache.rootBankCache[marketIndex],
        lyraeGroup,
        marketIndex,
      );
      uiDepositVal = deposits.mul(price);

      borrows = this.getUiBorrow(
        lyraeCache.rootBankCache[marketIndex],
        lyraeGroup,
        marketIndex,
      );
      uiBorrowVal = borrows.mul(price);
    }

    let max;
    if (side === 'buy') {
      const uiHealthAtZero = uiInitHealth.add(
        uiBorrowVal.mul(initLiabWeight.sub(ONE_I80F48)),
      );
      max = uiHealthAtZero
        .div(ONE_I80F48.sub(initAssetWeight))
        .add(uiBorrowVal);
    } else {
      const uiHealthAtZero = uiInitHealth.add(
        uiDepositVal.mul(ONE_I80F48.sub(initAssetWeight)),
      );
      max = uiHealthAtZero
        .div(initLiabWeight.sub(ONE_I80F48))
        .add(uiDepositVal);
    }

    return { max, uiBorrowVal, uiDepositVal, deposits, borrows };
  }

  getMaxWithBorrowForToken(
    lyraeGroup: LyraeGroup,
    lyraeCache: LyraeCache,
    tokenIndex: number,
  ): I80F48 {
    const oldInitHealth = this.getHealth(
      lyraeGroup,
      lyraeCache,
      'Init',
    ).floor();
    const tokenDeposits = this.getNativeDeposit(
      lyraeCache.rootBankCache[tokenIndex],
      tokenIndex,
    ).floor();

    let liabWeight, assetWeight, nativePrice;
    if (tokenIndex === QUOTE_INDEX) {
      liabWeight = assetWeight = nativePrice = ONE_I80F48;
    } else {
      liabWeight = lyraeGroup.spotMarkets[tokenIndex].initLiabWeight;
      assetWeight = lyraeGroup.spotMarkets[tokenIndex].initAssetWeight;
      nativePrice = lyraeCache.priceCache[tokenIndex].price;
    }

    const newInitHealth = oldInitHealth
      .sub(tokenDeposits.mul(nativePrice).mul(assetWeight))
      .floor();
    const price = lyraeGroup.getPrice(tokenIndex, lyraeCache);
    const healthDecimals = I80F48.fromNumber(
      Math.pow(10, lyraeGroup.tokens[QUOTE_INDEX].decimals),
    );

    return newInitHealth.div(healthDecimals).div(price.mul(liabWeight));
  }

  isLiquidatable(lyraeGroup: LyraeGroup, lyraeCache: LyraeCache): boolean {
    return (
      (this.beingLiquidated &&
        this.getHealth(lyraeGroup, lyraeCache, 'Init').isNeg()) ||
      this.getHealth(lyraeGroup, lyraeCache, 'Maint').isNeg()
    );
  }

  toPrettyString(
    groupConfig: GroupConfig,
    lyraeGroup: LyraeGroup,
    cache: LyraeCache,
  ): string {
    const lines: string[] = [];
    lines.push('MangoAccount ' + this.publicKey.toBase58());
    lines.push('Owner: ' + this.owner.toBase58());
    lines.push(
      'Maint Health Ratio: ' +
      this.getHealthRatio(lyraeGroup, cache, 'Maint').toFixed(4),
    );
    lines.push(
      'Maint Health: ' + this.getHealth(lyraeGroup, cache, 'Maint').toFixed(4),
    );
    lines.push(
      'Init Health: ' + this.getHealth(lyraeGroup, cache, 'Init').toFixed(4),
    );
    lines.push('Equity: ' + this.computeValue(lyraeGroup, cache).toFixed(4));
    lines.push('isBankrupt: ' + this.isBankrupt);
    lines.push('beingLiquidated: ' + this.beingLiquidated);

    lines.push('Spot:');
    lines.push('Token: Net Balance / Base In Orders / Quote In Orders');

    const quoteAdj = new BN(10).pow(
      new BN(lyraeGroup.tokens[QUOTE_INDEX].decimals),
    );

    for (let i = 0; i < lyraeGroup.tokens.length; i++) {
      if (lyraeGroup.tokens[i].mint.equals(zeroKey)) {
        continue;
      }
      const token = getTokenByMint(
        groupConfig,
        lyraeGroup.tokens[i].mint,
      ) as TokenConfig;

      let baseInOrders = ZERO_BN;
      let quoteInOrders = ZERO_BN;
      const openOrders =
        i !== QUOTE_INDEX ? this.spotOpenOrdersAccounts[i] : undefined;

      if (openOrders) {
        const baseAdj = new BN(10).pow(new BN(lyraeGroup.tokens[i].decimals));

        baseInOrders = openOrders.baseTokenTotal.div(baseAdj);
        quoteInOrders = openOrders.quoteTokenTotal
          .add(openOrders['referrerRebatesAccrued'])
          .div(quoteAdj);
      }
      const net = nativeI80F48ToUi(
        this.getNet(cache.rootBankCache[i], i),
        lyraeGroup.tokens[i].decimals,
      );

      if (
        net.eq(ZERO_I80F48) &&
        baseInOrders.isZero() &&
        quoteInOrders.isZero()
      ) {
        continue;
      }

      lines.push(
        `${token.symbol}: ${net.toFixed(4)} / ${baseInOrders
          .toNumber()
          .toFixed(4)} / ${quoteInOrders.toNumber().toFixed(4)}`,
      );
    }

    lines.push('Perps:');
    lines.push('Market: Base Pos / Quote Pos / Unsettled Funding / Health');

    for (let i = 0; i < this.perpAccounts.length; i++) {
      if (lyraeGroup.perpMarkets[i].perpMarket.equals(zeroKey)) {
        continue;
      }
      const market = getMarketByPublicKey(
        groupConfig,
        lyraeGroup.perpMarkets[i].perpMarket,
      ) as PerpMarketConfig;
      if (market === undefined) {
        continue;
      }
      const perpAccount = this.perpAccounts[i];
      const perpMarketInfo = lyraeGroup.perpMarkets[i];
      lines.push(
        `${market.name}: ${this.getBasePositionUiWithGroup(
          i,
          lyraeGroup,
        ).toFixed(4)} / ${(
          perpAccount.getQuotePosition(cache.perpMarketCache[i]).toNumber() /
          quoteAdj.toNumber()
        ).toFixed(4)} / ${(
          perpAccount.getUnsettledFunding(cache.perpMarketCache[i]).toNumber() /
          quoteAdj.toNumber()
        ).toFixed(4)} / ${perpAccount
          .getHealth(
            perpMarketInfo,
            cache.priceCache[i].price,
            perpMarketInfo.maintAssetWeight,
            perpMarketInfo.maintLiabWeight,
            cache.perpMarketCache[i].longFunding,
            cache.perpMarketCache[i].shortFunding,
          )
          .toFixed(4)}`,
      );
    }
    return lines.join(EOL);
  }

  getPerpOpenOrders(): { marketIndex: number; price: BN; side: string }[] {
    const perpOpenOrders: { marketIndex: number; price: BN; side: string }[] =
      [];

    for (let i = 0; i < this.orders.length; i++) {
      if (this.orderMarket[i] === FREE_ORDER_SLOT) {
        continue;
      }
      perpOpenOrders.push({
        marketIndex: this.orderMarket[i],
        price: getPriceFromKey(this.orders[i]),
        side: this.orderSide[i],
      });
    }
    return perpOpenOrders;
  }

  getOpenOrdersKeysInBasket(): PublicKey[] {
    return this.spotOpenOrders.map((pk, i) =>
      this.inMarginBasket[i] ? pk : zeroKey,
    );
  }

  getPerpPositionUi(marketIndex: number, perpMarket: PerpMarket): number {
    return this.perpAccounts[marketIndex].getBasePositionUi(perpMarket);
  }

  getBasePositionUiWithGroup(marketIndex: number, group: LyraeGroup): number {
    return (
      this.perpAccounts[marketIndex].basePosition
        .mul(group.perpMarkets[marketIndex].baseLotSize)
        .toNumber() / Math.pow(10, group.tokens[marketIndex].decimals)
    );
  }

  getEquityUi(lyraeGroup: LyraeGroup, lyraeCache: LyraeCache): number {
    return (
      this.computeValue(lyraeGroup, lyraeCache).toNumber() /
      Math.pow(10, lyraeGroup.tokens[QUOTE_INDEX].decimals)
    );
  }

  getCollateralValueUi(lyraeGroup: LyraeGroup, lyraeCache: LyraeCache): number {
    return (
      this.getHealth(lyraeGroup, lyraeCache, 'Init').toNumber() /
      Math.pow(10, lyraeGroup.tokens[QUOTE_INDEX].decimals)
    );
  }
}

export type HealthType = 'Init' | 'Maint';