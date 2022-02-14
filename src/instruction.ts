import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from '@solana/web3.js';
import { AssetType, encodeLyraeInstruction, INFO_LEN } from './layout';
import BN from 'bn.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Order } from '@project-serum/serum/lib/market';
import { I80F48, ZERO_I80F48 } from './utils/fixednum';
import { PerpOrder, PerpOrderType, ZERO_BN } from '.';

export function makeInitLyraeGroupInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  signerKey: PublicKey,
  payerPk: PublicKey,
  quoteMintPk: PublicKey,
  quoteVaultPk: PublicKey,
  quoteNodeBankPk: PublicKey,
  quoteRootBankPk: PublicKey,
  insuranceVaultPk: PublicKey,
  msrmVaultPk: PublicKey,
  feesVaultPk: PublicKey,
  lyraeCachePk: PublicKey,
  dexProgramPk: PublicKey,

  signerNonce: BN,
  validInterval: BN,
  quoteOptimalUtil: I80F48,
  quoteOptimalRate: I80F48,
  quoteMaxRate: I80F48,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: false, pubkey: signerKey },
    { isSigner: true, isWritable: false, pubkey: payerPk },
    { isSigner: false, isWritable: false, pubkey: quoteMintPk },
    { isSigner: false, isWritable: true, pubkey: quoteVaultPk },
    { isSigner: false, isWritable: true, pubkey: quoteNodeBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteRootBankPk },
    { isSigner: false, isWritable: false, pubkey: insuranceVaultPk },
    { isSigner: false, isWritable: false, pubkey: msrmVaultPk },
    { isSigner: false, isWritable: false, pubkey: feesVaultPk },
    { isSigner: false, isWritable: true, pubkey: lyraeCachePk },
    { isSigner: false, isWritable: false, pubkey: dexProgramPk },
  ];

  const data = encodeLyraeInstruction({
    InitLyraeGroup: {
      signerNonce,
      validInterval,
      quoteOptimalUtil,
      quoteOptimalRate,
      quoteMaxRate,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId: programId,
  });
}

export function makeInitLyraeAccountInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  ownerPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
  ];

  const data = encodeLyraeInstruction({ InitLyraeAccount: {} });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeWithdrawInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  walletPk: PublicKey,
  lyraeCachePk: PublicKey,
  rootBankPk: PublicKey,
  nodeBankPk: PublicKey,
  vaultPk: PublicKey,
  tokenAccPk: PublicKey,
  signerKey: PublicKey,
  openOrders: PublicKey[],

  nativeQuantity: BN,
  allowBorrow: boolean,
): TransactionInstruction {
  const withdrawKeys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: false, pubkey: walletPk },
    { isSigner: false, isWritable: false, pubkey: lyraeCachePk },
    { isSigner: false, isWritable: false, pubkey: rootBankPk },
    { isSigner: false, isWritable: true, pubkey: nodeBankPk },
    { isSigner: false, isWritable: true, pubkey: vaultPk },
    { isSigner: false, isWritable: true, pubkey: tokenAccPk },
    { isSigner: false, isWritable: false, pubkey: signerKey },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    ...openOrders.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];
  const withdrawData = encodeLyraeInstruction({
    Withdraw: { quantity: nativeQuantity, allowBorrow },
  });
  return new TransactionInstruction({
    keys: withdrawKeys,
    data: withdrawData,
    programId,
  });
}

export function makeSettleFundsInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeCachePk: PublicKey,
  ownerPk: PublicKey,
  lyraeAccountPk: PublicKey,
  dexProgramId: PublicKey,
  spotMarketPk: PublicKey,
  openOrdersPk: PublicKey,
  signerKey: PublicKey,
  spotMarketBaseVaultPk: PublicKey,
  spotMarketQuoteVaultPk: PublicKey,
  baseRootBankPk: PublicKey,
  baseNodeBankPk: PublicKey,
  quoteRootBankPk: PublicKey,
  quoteNodeBankPk: PublicKey,
  baseVaultPk: PublicKey,
  quoteVaultPk: PublicKey,
  dexSignerKey: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: false, pubkey: lyraeCachePk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: false, isWritable: false, pubkey: dexProgramId },
    { isSigner: false, isWritable: true, pubkey: spotMarketPk },
    { isSigner: false, isWritable: true, pubkey: openOrdersPk },
    { isSigner: false, isWritable: false, pubkey: signerKey },
    { isSigner: false, isWritable: true, pubkey: spotMarketBaseVaultPk },
    { isSigner: false, isWritable: true, pubkey: spotMarketQuoteVaultPk },
    { isSigner: false, isWritable: false, pubkey: baseRootBankPk },
    { isSigner: false, isWritable: true, pubkey: baseNodeBankPk },
    { isSigner: false, isWritable: false, pubkey: quoteRootBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteNodeBankPk },
    { isSigner: false, isWritable: true, pubkey: baseVaultPk },
    { isSigner: false, isWritable: true, pubkey: quoteVaultPk },
    { isSigner: false, isWritable: false, pubkey: dexSignerKey },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
  ];
  const data = encodeLyraeInstruction({ SettleFunds: {} });

  return new TransactionInstruction({ keys, data, programId });
}

export function makeCancelSpotOrderInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  ownerPk: PublicKey,
  lyraeAccountPk: PublicKey,
  dexProgramId: PublicKey,
  spotMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  openOrdersPk: PublicKey,
  signerKey: PublicKey,
  eventQueuePk: PublicKey,
  order: Order,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: lyraeAccountPk },
    { isSigner: false, isWritable: false, pubkey: dexProgramId },
    { isSigner: false, isWritable: true, pubkey: spotMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
    { isSigner: false, isWritable: true, pubkey: openOrdersPk },
    { isSigner: false, isWritable: false, pubkey: signerKey },
    { isSigner: false, isWritable: true, pubkey: eventQueuePk },
  ];

  const data = encodeLyraeInstruction({
    CancelSpotOrder: {
      side: order.side,
      orderId: order.orderId,
    },
  });
  return new TransactionInstruction({ keys, data, programId });
}

export function makeCancelPerpOrderInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  ownerPk: PublicKey,
  perpMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  order: PerpOrder,
  invalidIdOk: boolean,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
  ];

  const data = encodeLyraeInstruction({
    CancelPerpOrder: {
      orderId: order.orderId,
      invalidIdOk,
    },
  });

  return new TransactionInstruction({ keys, data, programId });
}

export function makeCancelPerpOrderByClientIdInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  ownerPk: PublicKey,
  perpMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  clientOrderId: BN,
  invalidIdOk: boolean,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
  ];

  const data = encodeLyraeInstruction({
    CancelPerpOrderByClientId: {
      clientOrderId,
      invalidIdOk,
    },
  });
  return new TransactionInstruction({ keys, data, programId });
}

export function makeCancelAllPerpOrdersInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  ownerPk: PublicKey,
  perpMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  limit: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
  ];

  const data = encodeLyraeInstruction({
    CancelAllPerpOrders: {
      limit,
    },
  });
  return new TransactionInstruction({ keys, data, programId });
}

export function makeDepositInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  ownerPk: PublicKey,
  merpsCachePk: PublicKey,
  lyraeAccountPk: PublicKey,
  rootBankPk: PublicKey,
  nodeBankPk: PublicKey,
  vaultPk: PublicKey,
  tokenAccPk: PublicKey,

  nativeQuantity: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: merpsCachePk },
    { isSigner: false, isWritable: false, pubkey: rootBankPk },
    { isSigner: false, isWritable: true, pubkey: nodeBankPk },
    { isSigner: false, isWritable: true, pubkey: vaultPk },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    { isSigner: false, isWritable: true, pubkey: tokenAccPk },
  ];
  const data = encodeLyraeInstruction({
    Deposit: { quantity: nativeQuantity },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCacheRootBankInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeCachePk: PublicKey,
  rootBanks: PublicKey[],
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeCachePk },
    ...rootBanks.map((pubkey) => ({
      isSigner: false,
      isWritable: true,
      pubkey,
    })),
  ];

  const data = encodeLyraeInstruction({
    CacheRootBanks: {},
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCachePricesInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeCachePk: PublicKey,
  oracles: PublicKey[],
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeCachePk },
    ...oracles.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];

  const data = encodeLyraeInstruction({
    CachePrices: {},
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCachePerpMarketInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeCachePk: PublicKey,
  perpMarketPks: PublicKey[],
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeCachePk },
    ...perpMarketPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];

  const data = encodeLyraeInstruction({
    CachePerpMarkets: {},
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeAddSpotMarketInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  oraclePk: PublicKey,
  spotMarketPk: PublicKey,
  serumDexPk: PublicKey,
  mintPk: PublicKey,
  nodeBankPk: PublicKey,
  vaultPk: PublicKey,
  rootBankPk: PublicKey,
  adminPk: PublicKey,

  maintLeverage: I80F48,
  initLeverage: I80F48,
  liquidationFee: I80F48,
  optimalUtil: I80F48,
  optimalRate: I80F48,
  maxRate: I80F48,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: false, pubkey: oraclePk },
    { isSigner: false, isWritable: false, pubkey: spotMarketPk },
    { isSigner: false, isWritable: false, pubkey: serumDexPk },
    { isSigner: false, isWritable: false, pubkey: mintPk },
    { isSigner: false, isWritable: true, pubkey: nodeBankPk },
    { isSigner: false, isWritable: false, pubkey: vaultPk },
    { isSigner: false, isWritable: true, pubkey: rootBankPk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];

  const data = encodeLyraeInstruction({
    AddSpotMarket: {
      maintLeverage,
      initLeverage,
      liquidationFee,
      optimalUtil,
      optimalRate,
      maxRate,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeInitSpotOpenOrdersInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  ownerPk: PublicKey,
  serumDexPk: PublicKey,
  openOrdersPk: PublicKey,
  spotMarketPk: PublicKey,
  signerPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: serumDexPk },
    { isSigner: false, isWritable: true, pubkey: openOrdersPk },
    { isSigner: false, isWritable: false, pubkey: spotMarketPk },
    { isSigner: false, isWritable: false, pubkey: signerPk },
    { isSigner: false, isWritable: false, pubkey: SYSVAR_RENT_PUBKEY },
  ];

  const data = encodeLyraeInstruction({
    InitSpotOpenOrders: {},
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCreateSpotOpenOrdersInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  ownerPk: PublicKey,
  serumDexPk: PublicKey,
  openOrdersPk: PublicKey,
  spotMarketPk: PublicKey,
  signerPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: true, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: serumDexPk },
    { isSigner: false, isWritable: true, pubkey: openOrdersPk },
    { isSigner: false, isWritable: false, pubkey: spotMarketPk },
    { isSigner: false, isWritable: false, pubkey: signerPk },
    { isSigner: false, isWritable: false, pubkey: SystemProgram.programId },
  ];

  const data = encodeLyraeInstruction({
    CreateSpotOpenOrders: {},
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makePlaceSpotOrderInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  ownerPk: PublicKey,
  lyraeCachePk: PublicKey,
  serumDexPk: PublicKey,
  spotMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  requestQueuePk: PublicKey,
  eventQueuePk: PublicKey,
  spotMktBaseVaultPk: PublicKey,
  spotMktQuoteVaultPk: PublicKey,
  baseRootBankPk: PublicKey,
  baseNodeBankPk: PublicKey,
  baseVaultPk: PublicKey,
  quoteRootBankPk: PublicKey,
  quoteNodeBankPk: PublicKey,
  quoteVaultPk: PublicKey,
  signerPk: PublicKey,
  dexSignerPk: PublicKey,
  msrmOrSrmVaultPk: PublicKey,
  // pass in only openOrders in margin basket, and only the market index one should be writable
  openOrders: { pubkey: PublicKey; isWritable: boolean }[],

  side: 'buy' | 'sell',
  limitPrice: BN,
  maxBaseQuantity: BN,
  maxQuoteQuantity: BN,
  selfTradeBehavior: string,
  orderType?: 'limit' | 'ioc' | 'postOnly',
  clientId?: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: lyraeCachePk },
    { isSigner: false, isWritable: false, pubkey: serumDexPk },
    { isSigner: false, isWritable: true, pubkey: spotMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
    { isSigner: false, isWritable: true, pubkey: requestQueuePk },
    { isSigner: false, isWritable: true, pubkey: eventQueuePk },
    { isSigner: false, isWritable: true, pubkey: spotMktBaseVaultPk },
    { isSigner: false, isWritable: true, pubkey: spotMktQuoteVaultPk },
    { isSigner: false, isWritable: false, pubkey: baseRootBankPk },
    { isSigner: false, isWritable: true, pubkey: baseNodeBankPk },
    { isSigner: false, isWritable: true, pubkey: baseVaultPk },
    { isSigner: false, isWritable: false, pubkey: quoteRootBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteNodeBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteVaultPk },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    { isSigner: false, isWritable: false, pubkey: signerPk },
    { isSigner: false, isWritable: false, pubkey: SYSVAR_RENT_PUBKEY },
    { isSigner: false, isWritable: false, pubkey: dexSignerPk },
    { isSigner: false, isWritable: false, pubkey: msrmOrSrmVaultPk },
    ...openOrders.map(({ pubkey, isWritable }) => ({
      isSigner: false,
      isWritable,
      pubkey,
    })),
  ];

  const data = encodeLyraeInstruction({
    PlaceSpotOrder: {
      side,
      limitPrice,
      maxBaseQuantity,
      maxQuoteQuantity,
      selfTradeBehavior,
      orderType,
      clientId,
      limit: 65535,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makePlaceSpotOrder2Instruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  ownerPk: PublicKey,
  lyraeCachePk: PublicKey,
  serumDexPk: PublicKey,
  spotMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  requestQueuePk: PublicKey,
  eventQueuePk: PublicKey,
  spotMktBaseVaultPk: PublicKey,
  spotMktQuoteVaultPk: PublicKey,
  baseRootBankPk: PublicKey,
  baseNodeBankPk: PublicKey,
  baseVaultPk: PublicKey,
  quoteRootBankPk: PublicKey,
  quoteNodeBankPk: PublicKey,
  quoteVaultPk: PublicKey,
  signerPk: PublicKey,
  dexSignerPk: PublicKey,
  msrmOrSrmVaultPk: PublicKey,
  // pass in only openOrders in margin basket, and only the market index one should be writable
  openOrders: { pubkey: PublicKey; isWritable: boolean }[],

  side: 'buy' | 'sell',
  limitPrice: BN,
  maxBaseQuantity: BN,
  maxQuoteQuantity: BN,
  selfTradeBehavior: string,
  orderType?: 'limit' | 'ioc' | 'postOnly',
  clientOrderId?: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: lyraeCachePk },
    { isSigner: false, isWritable: false, pubkey: serumDexPk },
    { isSigner: false, isWritable: true, pubkey: spotMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
    { isSigner: false, isWritable: true, pubkey: requestQueuePk },
    { isSigner: false, isWritable: true, pubkey: eventQueuePk },
    { isSigner: false, isWritable: true, pubkey: spotMktBaseVaultPk },
    { isSigner: false, isWritable: true, pubkey: spotMktQuoteVaultPk },
    { isSigner: false, isWritable: false, pubkey: baseRootBankPk },
    { isSigner: false, isWritable: true, pubkey: baseNodeBankPk },
    { isSigner: false, isWritable: true, pubkey: baseVaultPk },
    { isSigner: false, isWritable: false, pubkey: quoteRootBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteNodeBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteVaultPk },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    { isSigner: false, isWritable: false, pubkey: signerPk },
    { isSigner: false, isWritable: false, pubkey: dexSignerPk },
    { isSigner: false, isWritable: false, pubkey: msrmOrSrmVaultPk },
    ...openOrders.map(({ pubkey, isWritable }) => ({
      isSigner: false,
      isWritable,
      pubkey,
    })),
  ];

  const data = encodeLyraeInstruction({
    PlaceSpotOrder2: {
      side,
      limitPrice,
      maxBaseQuantity,
      maxQuoteQuantity,
      selfTradeBehavior,
      orderType,
      clientOrderId,
      limit: 65535,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeUpdateRootBankInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeCachePk: PublicKey,
  rootBankPk: PublicKey,
  nodeBanks: PublicKey[],
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeCachePk },
    { isSigner: false, isWritable: true, pubkey: rootBankPk },
    ...nodeBanks.map((pubkey) => ({
      isSigner: false,
      isWritable: true,
      pubkey,
    })),
  ];

  const data = encodeLyraeInstruction({
    UpdateRootBank: {},
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeAddOracleInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  oraclePk: PublicKey,
  adminPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: oraclePk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];
  const data = encodeLyraeInstruction({ AddOracle: {} });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeSetOracleInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  oraclePk: PublicKey,
  adminPk: PublicKey,
  price: I80F48,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: oraclePk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];
  const data = encodeLyraeInstruction({
    SetOracle: { price },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeAddPerpMarketInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  oraclePk: PublicKey,
  perpMarketPk: PublicKey,
  eventQueuePk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  lyrVaultPk: PublicKey,
  adminPk: PublicKey,
  maintLeverage: I80F48,
  initLeverage: I80F48,
  liquidationFee: I80F48,
  makerFee: I80F48,
  takerFee: I80F48,
  baseLotSize: BN,
  quoteLotSize: BN,
  rate: I80F48,
  maxDepthBps: I80F48,
  targetPeriodLength: BN,
  lyrPerPeriod: BN,
  exp: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: false, pubkey: oraclePk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: eventQueuePk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
    { isSigner: false, isWritable: false, pubkey: lyrVaultPk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];
  const data = encodeLyraeInstruction({
    AddPerpMarket: {
      maintLeverage,
      initLeverage,
      liquidationFee,
      makerFee,
      takerFee,
      baseLotSize,
      quoteLotSize,
      rate,
      maxDepthBps,
      targetPeriodLength,
      lyrPerPeriod,
      exp,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCreatePerpMarketInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  oraclePk: PublicKey,
  perpMarketPk: PublicKey,
  eventQueuePk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  lyrMintPk: PublicKey,
  lyrVaultPk: PublicKey,
  adminPk: PublicKey,
  signerPk: PublicKey,
  maintLeverage: I80F48,
  initLeverage: I80F48,
  liquidationFee: I80F48,
  makerFee: I80F48,
  takerFee: I80F48,
  baseLotSize: BN,
  quoteLotSize: BN,
  rate: I80F48,
  maxDepthBps: I80F48,
  targetPeriodLength: BN,
  lyrPerPeriod: BN,
  exp: BN,
  version: BN,
  lmSizeShift: BN,
  baseDecimals: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: false, pubkey: oraclePk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: eventQueuePk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
    { isSigner: false, isWritable: false, pubkey: lyrMintPk },
    { isSigner: false, isWritable: true, pubkey: lyrVaultPk },
    { isSigner: true, isWritable: true, pubkey: adminPk },
    { isSigner: false, isWritable: true, pubkey: signerPk }, // TODO: does this need to be signer?
    { isSigner: false, isWritable: false, pubkey: SystemProgram.programId },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    { isSigner: false, isWritable: false, pubkey: SYSVAR_RENT_PUBKEY },
  ];

  const data = encodeLyraeInstruction({
    CreatePerpMarket: {
      maintLeverage,
      initLeverage,
      liquidationFee,
      makerFee,
      takerFee,
      baseLotSize,
      quoteLotSize,
      rate,
      maxDepthBps,
      targetPeriodLength,
      lyrPerPeriod,
      exp,
      version,
      lmSizeShift,
      baseDecimals,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCachePerpMarketsInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeCachePk: PublicKey,
  perpMarkets: PublicKey[],
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeCachePk },
    ...perpMarkets.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];

  const data = encodeLyraeInstruction({
    CachePerpMarkets: {},
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeSettlePnlInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountAPk: PublicKey,
  lyraeAccountBPk: PublicKey,
  lyraeCachePk: PublicKey,
  rootBankPk: PublicKey,
  nodeBankPk: PublicKey,
  marketIndex: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountAPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountBPk },
    { isSigner: false, isWritable: false, pubkey: lyraeCachePk },
    { isSigner: false, isWritable: false, pubkey: rootBankPk },
    { isSigner: false, isWritable: true, pubkey: nodeBankPk },
  ];
  const data = encodeLyraeInstruction({
    SettlePnl: {
      marketIndex,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeConsumeEventsInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeCachePk: PublicKey,
  perpMarketPk: PublicKey,
  eventQueuePk: PublicKey,
  lyraeAccountPks: PublicKey[],
  limit: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: false, pubkey: lyraeCachePk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: eventQueuePk },
    ...lyraeAccountPks.sort().map((pubkey) => ({
      isSigner: false,
      isWritable: true,
      pubkey,
    })),
  ];

  const data = encodeLyraeInstruction({
    ConsumeEvents: { limit },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makePlacePerpOrderInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  ownerPk: PublicKey,
  lyraeCachePk: PublicKey,
  perpMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  eventQueuePk: PublicKey,
  openOrders: PublicKey[],
  price: BN,
  quantity: BN,
  clientOrderId: BN,
  side: 'buy' | 'sell',
  orderType?: PerpOrderType,
  reduceOnly?: boolean,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: lyraeCachePk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
    { isSigner: false, isWritable: true, pubkey: eventQueuePk },
    ...openOrders.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];
  const data = encodeLyraeInstruction({
    PlacePerpOrder: {
      price,
      quantity,
      clientOrderId,
      side,
      orderType,
      reduceOnly: reduceOnly ? reduceOnly : false,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeUpdateFundingInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeCachePk: PublicKey,
  perpMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeCachePk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: false, pubkey: bidsPk },
    { isSigner: false, isWritable: false, pubkey: asksPk },
  ];

  const data = encodeLyraeInstruction({
    UpdateFunding: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeForceCancelSpotOrdersInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeCachePk: PublicKey,
  liqeeLyraeAccountPk: PublicKey,
  baseRootBankPk: PublicKey,
  baseNodeBankPk: PublicKey,
  baseVaultPk: PublicKey,
  quoteRootBankPk: PublicKey,
  quoteNodeBankPk: PublicKey,
  quoteVaultPk: PublicKey,
  spotMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  signerPk: PublicKey,
  dexEventQueuePk: PublicKey,
  dexBasePk: PublicKey,
  dexQuotePk: PublicKey,
  dexSignerPk: PublicKey,
  dexProgramPk: PublicKey,
  liqeeOpenOrdersKeys: { pubkey: PublicKey; isWritable: boolean }[],
  limit: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: false, pubkey: lyraeCachePk },
    { isSigner: false, isWritable: true, pubkey: liqeeLyraeAccountPk },
    { isSigner: false, isWritable: false, pubkey: baseRootBankPk },
    { isSigner: false, isWritable: true, pubkey: baseNodeBankPk },
    { isSigner: false, isWritable: true, pubkey: baseVaultPk },
    { isSigner: false, isWritable: false, pubkey: quoteRootBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteNodeBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteVaultPk },
    { isSigner: false, isWritable: true, pubkey: spotMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
    { isSigner: false, isWritable: false, pubkey: signerPk },
    { isSigner: false, isWritable: true, pubkey: dexEventQueuePk },
    { isSigner: false, isWritable: true, pubkey: dexBasePk },
    { isSigner: false, isWritable: true, pubkey: dexQuotePk },
    { isSigner: false, isWritable: false, pubkey: dexSignerPk },
    { isSigner: false, isWritable: false, pubkey: dexProgramPk },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    ...liqeeOpenOrdersKeys.map(({ pubkey, isWritable }) => ({
      isSigner: false,
      isWritable,
      pubkey,
    })),
  ];

  const data = encodeLyraeInstruction({
    ForceCancelSpotOrders: {
      limit,
    },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeForceCancelPerpOrdersInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeCachePk: PublicKey,
  perpMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  liqeeLyraeAccountPk: PublicKey,
  liqorOpenOrdersPks: PublicKey[],
  limit: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: false, pubkey: lyraeCachePk },
    { isSigner: false, isWritable: false, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
    { isSigner: false, isWritable: true, pubkey: liqeeLyraeAccountPk },
    ...liqorOpenOrdersPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];

  const data = encodeLyraeInstruction({
    ForceCancelPerpOrders: {
      limit,
    },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeLiquidateTokenAndTokenInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeCachePk: PublicKey,
  liqeeLyraeAccountPk: PublicKey,
  liqorLyraeAccountPk: PublicKey,
  liqorAccountPk: PublicKey,
  assetRootBankPk: PublicKey,
  assetNodeBankPk: PublicKey,
  liabRootBankPk: PublicKey,
  liabNodeBankPk: PublicKey,
  liqeeOpenOrdersPks: PublicKey[],
  liqorOpenOrdersPks: PublicKey[],
  maxLiabTransfer: I80F48,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: false, pubkey: lyraeCachePk },
    { isSigner: false, isWritable: true, pubkey: liqeeLyraeAccountPk },
    { isSigner: false, isWritable: true, pubkey: liqorLyraeAccountPk },
    { isSigner: true, isWritable: false, pubkey: liqorAccountPk },
    { isSigner: false, isWritable: false, pubkey: assetRootBankPk },
    { isSigner: false, isWritable: true, pubkey: assetNodeBankPk },
    { isSigner: false, isWritable: false, pubkey: liabRootBankPk },
    { isSigner: false, isWritable: true, pubkey: liabNodeBankPk },
    ...liqeeOpenOrdersPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
    ...liqorOpenOrdersPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];

  const data = encodeLyraeInstruction({
    LiquidateTokenAndToken: {
      maxLiabTransfer,
    },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeLiquidateTokenAndPerpInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeCachePk: PublicKey,
  liqeeLyraeAccountPk: PublicKey,
  liqorLyraeAccountPk: PublicKey,
  liqorAccountPk: PublicKey,
  rootBankPk: PublicKey,
  nodeBankPk: PublicKey,
  liqeeOpenOrdersPks: PublicKey[],
  liqorOpenOrdersPks: PublicKey[],
  assetType: AssetType,
  assetIndex: BN,
  liabType: AssetType,
  liabIndex: BN,
  maxLiabTransfer: I80F48,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: false, pubkey: lyraeCachePk },
    { isSigner: false, isWritable: true, pubkey: liqeeLyraeAccountPk },
    { isSigner: false, isWritable: true, pubkey: liqorLyraeAccountPk },
    { isSigner: true, isWritable: false, pubkey: liqorAccountPk },
    { isSigner: false, isWritable: false, pubkey: rootBankPk },
    { isSigner: false, isWritable: true, pubkey: nodeBankPk },
    ...liqeeOpenOrdersPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
    ...liqorOpenOrdersPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];

  const data = encodeLyraeInstruction({
    LiquidateTokenAndPerp: {
      assetType,
      assetIndex,
      liabType,
      liabIndex,
      maxLiabTransfer,
    },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeLiquidatePerpMarketInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeCachePk: PublicKey,
  perpMarketPk: PublicKey,
  eventQueuePk: PublicKey,
  liqeeLyraeAccountPk: PublicKey,
  liqorLyraeAccountPk: PublicKey,
  liqorAccountPk: PublicKey,
  liqeeOpenOrdersPks: PublicKey[],
  liqorOpenOrdersPks: PublicKey[],
  baseTransferRequest: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: false, pubkey: lyraeCachePk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: eventQueuePk },
    { isSigner: false, isWritable: true, pubkey: liqeeLyraeAccountPk },
    { isSigner: false, isWritable: true, pubkey: liqorLyraeAccountPk },
    { isSigner: true, isWritable: false, pubkey: liqorAccountPk },
    ...liqeeOpenOrdersPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
    ...liqorOpenOrdersPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];

  const data = encodeLyraeInstruction({
    LiquidatePerpMarket: {
      baseTransferRequest,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeSettleFeesInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeCachePk: PublicKey,
  perpMarketPk: PublicKey,
  lyraeAccountPk: PublicKey,
  rootBankPk: PublicKey,
  nodeBankPk: PublicKey,
  bankVaultPk: PublicKey,
  feesVaultPk: PublicKey,
  signerPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: false, pubkey: lyraeCachePk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: false, isWritable: false, pubkey: rootBankPk },
    { isSigner: false, isWritable: true, pubkey: nodeBankPk },
    { isSigner: false, isWritable: true, pubkey: bankVaultPk },
    { isSigner: false, isWritable: true, pubkey: feesVaultPk },
    { isSigner: false, isWritable: false, pubkey: signerPk },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
  ];

  const data = encodeLyraeInstruction({
    SettleFees: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeResolvePerpBankruptcyInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeCachePk: PublicKey,
  liqeeLyraeAccountPk: PublicKey,
  liqorLyraeAccountPk: PublicKey,
  liqorPk: PublicKey,
  rootBankPk: PublicKey,
  nodeBankPk: PublicKey,
  vaultPk: PublicKey,
  insuranceVaultPk: PublicKey,
  signerPk: PublicKey,
  perpMarketPk: PublicKey,
  liqorOpenOrdersPks: PublicKey[],
  liabIndex: BN,
  maxLiabTransfer: I80F48,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeCachePk },
    { isSigner: false, isWritable: true, pubkey: liqeeLyraeAccountPk },
    { isSigner: false, isWritable: true, pubkey: liqorLyraeAccountPk },
    { isSigner: true, isWritable: false, pubkey: liqorPk },
    { isSigner: false, isWritable: false, pubkey: rootBankPk },
    { isSigner: false, isWritable: true, pubkey: nodeBankPk },
    { isSigner: false, isWritable: true, pubkey: vaultPk },
    { isSigner: false, isWritable: true, pubkey: insuranceVaultPk },
    { isSigner: false, isWritable: false, pubkey: signerPk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    ...liqorOpenOrdersPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];

  const data = encodeLyraeInstruction({
    ResolvePerpBankruptcy: {
      liabIndex,
      maxLiabTransfer,
    },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeResolveTokenBankruptcyInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeCachePk: PublicKey,
  liqeeLyraeAccountPk: PublicKey,
  liqorLyraeAccountPk: PublicKey,
  liqorPk: PublicKey,
  quoteRootBankPk: PublicKey,
  quoteNodeBankPk: PublicKey,
  quoteVaultPk: PublicKey,
  insuranceVaultPk: PublicKey,
  signerPk: PublicKey,
  liabRootBankPk: PublicKey,
  liabNodeBankPk: PublicKey,
  liqorOpenOrdersPks: PublicKey[],
  liabNodeBankPks: PublicKey[],
  maxLiabTransfer: I80F48,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeCachePk },
    { isSigner: false, isWritable: true, pubkey: liqeeLyraeAccountPk },
    { isSigner: false, isWritable: true, pubkey: liqorLyraeAccountPk },
    { isSigner: true, isWritable: false, pubkey: liqorPk },
    { isSigner: false, isWritable: false, pubkey: quoteRootBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteNodeBankPk },
    { isSigner: false, isWritable: true, pubkey: quoteVaultPk },
    { isSigner: false, isWritable: true, pubkey: insuranceVaultPk },
    { isSigner: false, isWritable: false, pubkey: signerPk },
    { isSigner: false, isWritable: true, pubkey: liabRootBankPk },
    { isSigner: false, isWritable: true, pubkey: liabNodeBankPk },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
    ...liqorOpenOrdersPks.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
    ...liabNodeBankPks.map((pubkey) => ({
      isSigner: false,
      isWritable: true,
      pubkey,
    })),
  ];

  const data = encodeLyraeInstruction({
    ResolveTokenBankruptcy: {
      maxLiabTransfer,
    },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeRedeemLyrInstruction(
  programId: PublicKey,
  lyraeGroup: PublicKey,
  lyraeCache: PublicKey,
  lyraeAccount: PublicKey,
  owner: PublicKey,
  perpMarket: PublicKey,
  lyrPerpVault: PublicKey,
  lyrRootBank: PublicKey,
  lyrNodeBank: PublicKey,
  lyrBankVault: PublicKey,
  signer: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroup },
    { isSigner: false, isWritable: false, pubkey: lyraeCache },
    { isSigner: false, isWritable: true, pubkey: lyraeAccount },
    { isSigner: true, isWritable: false, pubkey: owner },
    { isSigner: false, isWritable: false, pubkey: perpMarket },
    { isSigner: false, isWritable: true, pubkey: lyrPerpVault },
    { isSigner: false, isWritable: false, pubkey: lyrRootBank },
    { isSigner: false, isWritable: true, pubkey: lyrNodeBank },
    { isSigner: false, isWritable: true, pubkey: lyrBankVault },
    { isSigner: false, isWritable: false, pubkey: signer },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
  ];

  const data = encodeLyraeInstruction({ RedeemLyr: {} });
  return new TransactionInstruction({ keys, data, programId });
}

export function makeAddLyraeAccountInfoInstruction(
  programId: PublicKey,
  lyraeGroup: PublicKey,
  lyraeAccount: PublicKey,
  owner: PublicKey,
  info: string,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroup },
    { isSigner: false, isWritable: true, pubkey: lyraeAccount },
    { isSigner: true, isWritable: false, pubkey: owner },
  ];
  // TODO convert info into a 32 byte utf encoded byte array
  const encoded = Buffer.from(info);
  if (encoded.length > INFO_LEN) {
    throw new Error(
      'info string too long. Must be less than or equal to 32 bytes',
    );
  }
  const infoArray = new Uint8Array(encoded, 0, INFO_LEN);
  const data = encodeLyraeInstruction({
    AddLyraeAccountInfo: { info: infoArray },
  });

  return new TransactionInstruction({ keys, data, programId });
}

export function makeDepositMsrmInstruction(
  programId: PublicKey,
  lyraeGroup: PublicKey,
  lyraeAccount: PublicKey,
  owner: PublicKey,
  msrmAccount: PublicKey,
  msrmVault: PublicKey,
  quantity: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroup },
    { isSigner: false, isWritable: true, pubkey: lyraeAccount },
    { isSigner: true, isWritable: false, pubkey: owner },
    { isSigner: false, isWritable: true, pubkey: msrmAccount },
    { isSigner: false, isWritable: true, pubkey: msrmVault },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
  ];

  const data = encodeLyraeInstruction({ DepositMsrm: { quantity } });
  return new TransactionInstruction({ keys, data, programId });
}

export function makeWithdrawMsrmInstruction(
  programId: PublicKey,
  lyraeGroup: PublicKey,
  lyraeAccount: PublicKey,
  owner: PublicKey,
  msrmAccount: PublicKey,
  msrmVault: PublicKey,
  signer: PublicKey,
  quantity: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroup },
    { isSigner: false, isWritable: true, pubkey: lyraeAccount },
    { isSigner: true, isWritable: false, pubkey: owner },
    { isSigner: false, isWritable: true, pubkey: msrmAccount },
    { isSigner: false, isWritable: true, pubkey: msrmVault },
    { isSigner: false, isWritable: false, pubkey: signer },
    { isSigner: false, isWritable: false, pubkey: TOKEN_PROGRAM_ID },
  ];

  const data = encodeLyraeInstruction({ WithdrawMsrm: { quantity } });
  return new TransactionInstruction({ keys, data, programId });
}

export function makeChangePerpMarketParamsInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  perpMarketPk: PublicKey,
  adminPk: PublicKey,
  maintLeverage: I80F48 | undefined,
  initLeverage: I80F48 | undefined,
  liquidationFee: I80F48 | undefined,
  makerFee: I80F48 | undefined,
  takerFee: I80F48 | undefined,
  rate: I80F48 | undefined,
  maxDepthBps: I80F48 | undefined,
  targetPeriodLength: BN | undefined,
  lyrPerPeriod: BN | undefined,
  exp: BN | undefined,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];
  const data = encodeLyraeInstruction({
    ChangePerpMarketParams: {
      maintLeverageOption: maintLeverage !== undefined,
      maintLeverage: maintLeverage !== undefined ? maintLeverage : ZERO_I80F48,
      initLeverageOption: initLeverage !== undefined,
      initLeverage: initLeverage !== undefined ? initLeverage : ZERO_I80F48,
      liquidationFeeOption: liquidationFee !== undefined,
      liquidationFee:
        liquidationFee !== undefined ? liquidationFee : ZERO_I80F48,
      makerFeeOption: makerFee !== undefined,
      makerFee: makerFee !== undefined ? makerFee : ZERO_I80F48,
      takerFeeOption: takerFee !== undefined,
      takerFee: takerFee !== undefined ? takerFee : ZERO_I80F48,
      rateOption: rate !== undefined,
      rate: rate !== undefined ? rate : ZERO_I80F48,
      maxDepthBpsOption: maxDepthBps !== undefined,
      maxDepthBps: maxDepthBps !== undefined ? maxDepthBps : ZERO_I80F48,
      targetPeriodLengthOption: targetPeriodLength !== undefined,
      targetPeriodLength:
        targetPeriodLength !== undefined ? targetPeriodLength : ZERO_BN,
      lyrPerPeriodOption: lyrPerPeriod !== undefined,
      lyrPerPeriod: lyrPerPeriod !== undefined ? lyrPerPeriod : ZERO_BN,
      expOption: exp !== undefined,
      exp: exp !== undefined ? exp : ZERO_BN,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeChangePerpMarketParams2Instruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  perpMarketPk: PublicKey,
  adminPk: PublicKey,
  maintLeverage: I80F48 | undefined,
  initLeverage: I80F48 | undefined,
  liquidationFee: I80F48 | undefined,
  makerFee: I80F48 | undefined,
  takerFee: I80F48 | undefined,
  rate: I80F48 | undefined,
  maxDepthBps: I80F48 | undefined,
  targetPeriodLength: BN | undefined,
  lyrPerPeriod: BN | undefined,
  exp: BN | undefined,
  version: BN | undefined,
  lmSizeShift: BN | undefined,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];
  const data = encodeLyraeInstruction({
    ChangePerpMarketParams2: {
      maintLeverageOption: maintLeverage !== undefined,
      maintLeverage: maintLeverage !== undefined ? maintLeverage : ZERO_I80F48,
      initLeverageOption: initLeverage !== undefined,
      initLeverage: initLeverage !== undefined ? initLeverage : ZERO_I80F48,
      liquidationFeeOption: liquidationFee !== undefined,
      liquidationFee:
        liquidationFee !== undefined ? liquidationFee : ZERO_I80F48,
      makerFeeOption: makerFee !== undefined,
      makerFee: makerFee !== undefined ? makerFee : ZERO_I80F48,
      takerFeeOption: takerFee !== undefined,
      takerFee: takerFee !== undefined ? takerFee : ZERO_I80F48,
      rateOption: rate !== undefined,
      rate: rate !== undefined ? rate : ZERO_I80F48,
      maxDepthBpsOption: maxDepthBps !== undefined,
      maxDepthBps: maxDepthBps !== undefined ? maxDepthBps : ZERO_I80F48,
      targetPeriodLengthOption: targetPeriodLength !== undefined,
      targetPeriodLength:
        targetPeriodLength !== undefined ? targetPeriodLength : ZERO_BN,
      lyrPerPeriodOption: lyrPerPeriod !== undefined,
      lyrPerPeriod: lyrPerPeriod !== undefined ? lyrPerPeriod : ZERO_BN,
      expOption: exp !== undefined,
      exp: exp !== undefined ? exp : ZERO_BN,
      versionOption: version !== undefined,
      version: version !== undefined ? version : ZERO_BN,
      lmSizeShiftOption: lmSizeShift !== undefined,
      lmSizeShift: lmSizeShift !== undefined ? lmSizeShift : ZERO_BN,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeSetGroupAdminInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  newAdminPk: PublicKey,
  adminPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: newAdminPk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];
  const data = encodeLyraeInstruction({
    SetGroupAdmin: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeRemoveAdvancedOrderInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  ownerPk: PublicKey,
  advancedOrdersPk: PublicKey,
  orderIndex: number,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: false, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: true, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: advancedOrdersPk },
    { isSigner: false, isWritable: false, pubkey: SystemProgram.programId },
  ];

  const data = encodeLyraeInstruction({
    RemoveAdvancedOrder: { orderIndex },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeInitAdvancedOrdersInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  ownerPk: PublicKey,
  advancedOrdersPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: advancedOrdersPk },
    { isSigner: false, isWritable: false, pubkey: SystemProgram.programId },
  ];

  const data = encodeLyraeInstruction({
    InitAdvancedOrders: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeAddPerpTriggerOrderInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  ownerPk: PublicKey,
  advancedOrdersPk: PublicKey,
  lyraeCachePk: PublicKey,
  perpMarketPk: PublicKey,
  openOrders: PublicKey[],
  orderType: PerpOrderType,
  side: 'buy' | 'sell',
  price: BN,
  quantity: BN,
  triggerCondition: 'above' | 'below',
  triggerPrice: I80F48,
  reduceOnly?: boolean,
  clientOrderId?: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: false, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: true, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: advancedOrdersPk },
    { isSigner: false, isWritable: false, pubkey: lyraeCachePk },
    { isSigner: false, isWritable: false, pubkey: perpMarketPk },
    { isSigner: false, isWritable: false, pubkey: SystemProgram.programId },
    ...openOrders.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];
  const data = encodeLyraeInstruction({
    AddPerpTriggerOrder: {
      price,
      quantity,
      clientOrderId,
      side,
      orderType,
      triggerCondition,
      triggerPrice,
      reduceOnly,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeExecutePerpTriggerOrderInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  advancedOrdersPk: PublicKey,
  agentPk: PublicKey,
  lyraeCachePk: PublicKey,
  perpMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  eventQueuePk: PublicKey,
  openOrders: PublicKey[],
  orderIndex: BN,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: false, isWritable: true, pubkey: advancedOrdersPk },
    { isSigner: true, isWritable: true, pubkey: agentPk },
    { isSigner: false, isWritable: false, pubkey: lyraeCachePk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
    { isSigner: false, isWritable: true, pubkey: eventQueuePk },
    ...openOrders.map((pubkey) => ({
      isSigner: false,
      isWritable: false,
      pubkey,
    })),
  ];
  const data = encodeLyraeInstruction({
    ExecutePerpTriggerOrder: {
      orderIndex,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCloseLyraeAccountInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  ownerPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: true, pubkey: ownerPk },
  ];

  const data = encodeLyraeInstruction({
    CloseLyraeAccount: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCloseSpotOpenOrdersInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  ownerPk: PublicKey,
  dexProgramPk: PublicKey,
  openOrdersPk: PublicKey,
  spotMarketPk: PublicKey,
  signerPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: true, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: dexProgramPk },
    { isSigner: false, isWritable: true, pubkey: openOrdersPk },
    { isSigner: false, isWritable: false, pubkey: spotMarketPk },
    { isSigner: false, isWritable: false, pubkey: signerPk },
  ];

  const data = encodeLyraeInstruction({
    CloseSpotOpenOrders: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCloseAdvancedOrdersInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  ownerPk: PublicKey,
  advancedOrdersPk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: true, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: advancedOrdersPk },
  ];

  const data = encodeLyraeInstruction({
    CloseAdvancedOrders: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCreateDustAccountInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  payerPK: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: true, pubkey: payerPK },
    { isSigner: false, isWritable: false, pubkey: SystemProgram.programId },
  ];

  const data = encodeLyraeInstruction({
    CreateDustAccount: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeResolveDustInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  ownerPk: PublicKey,
  dustAccountPk: PublicKey,
  rootBankPk: PublicKey,
  nodeBankPk: PublicKey,
  lyraeCachePk: PublicKey,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: dustAccountPk },
    { isSigner: false, isWritable: false, pubkey: rootBankPk },
    { isSigner: false, isWritable: true, pubkey: nodeBankPk },
    { isSigner: false, isWritable: false, pubkey: lyraeCachePk },
  ];

  const data = encodeLyraeInstruction({
    ResolveDust: {},
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeUpdateMarginBasketInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  openOrdersPks: PublicKey[],
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    ...openOrdersPks.map((pubkey) => ({
      isSigner: false,
      isWritable: true,
      pubkey,
    })),
  ];
  const data = encodeLyraeInstruction({
    UpdateMarginBasket: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCreateLyraeAccountInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  ownerPk: PublicKey,
  accountNum: BN,
) {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: SystemProgram.programId },
  ];
  const data = encodeLyraeInstruction({
    CreateLyraeAccount: {
      accountNum,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeUpgradeLyraeAccountV0V1Instruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  ownerPk: PublicKey,
) {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
  ];
  const data = encodeLyraeInstruction({
    UpgradeLyraeAccountV0V1: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeChangeMaxLyraeAccountsInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  adminPk: PublicKey,
  maxLyraeAccounts: BN,
) {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: lyraeGroupPk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];

  const data = encodeLyraeInstruction({
    ChangeMaxLyraeAccounts: {
      maxLyraeAccounts,
    },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeCancelPerpOrdersSideInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  ownerPk: PublicKey,
  perpMarketPk: PublicKey,
  bidsPk: PublicKey,
  asksPk: PublicKey,
  side: 'buy' | 'sell',
  limit: BN,
) {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: true, pubkey: perpMarketPk },
    { isSigner: false, isWritable: true, pubkey: bidsPk },
    { isSigner: false, isWritable: true, pubkey: asksPk },
  ];

  const data = encodeLyraeInstruction({
    CancelPerpOrdersSide: {
      side,
      limit,
    },
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeSetDelegateInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  lyraeAccountPk: PublicKey,
  ownerPk: PublicKey,
  delegatePk: PublicKey,
) {
  const keys = [
    { isSigner: false, isWritable: false, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: lyraeAccountPk },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: delegatePk },
  ];

  const data = encodeLyraeInstruction({
    SetDelegate: {},
  });
  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}

export function makeChangeSpotMarketParamsInstruction(
  programId: PublicKey,
  lyraeGroupPk: PublicKey,
  spotMarketPk: PublicKey,
  rootBankPk: PublicKey,
  adminPk: PublicKey,
  maintLeverage: I80F48 | undefined,
  initLeverage: I80F48 | undefined,
  liquidationFee: I80F48 | undefined,
  optimalUtil: I80F48 | undefined,
  optimalRate: I80F48 | undefined,
  maxRate: I80F48 | undefined,
  version,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: lyraeGroupPk },
    { isSigner: false, isWritable: true, pubkey: spotMarketPk },
    { isSigner: false, isWritable: true, pubkey: rootBankPk },
    { isSigner: true, isWritable: false, pubkey: adminPk },
  ];

  const data = encodeLyraeInstruction({
    ChangeSpotMarketParams: {
      maintLeverageOption: maintLeverage !== undefined,
      maintLeverage: maintLeverage != undefined ? maintLeverage : ZERO_I80F48,
      initLeverageOption: initLeverage !== undefined,
      initLeverage: initLeverage != undefined ? initLeverage : ZERO_I80F48,
      liquidationFeeOption: liquidationFee !== undefined,
      liquidationFee:
        liquidationFee != undefined ? liquidationFee : ZERO_I80F48,
      optimalUtilOption: optimalUtil !== undefined,
      optimalUtil: optimalUtil != undefined ? optimalUtil : ZERO_I80F48,
      optimalRateOption: optimalRate !== undefined,
      optimalRate: optimalRate != undefined ? optimalRate : ZERO_I80F48,
      maxRateOption: maxRate !== undefined,
      maxRate: maxRate != undefined ? maxRate : ZERO_I80F48,
      versionOption: version !== undefined,
      version: version != undefined ? version : ZERO_BN,
    },
  });

  return new TransactionInstruction({
    keys,
    data,
    programId,
  });
}