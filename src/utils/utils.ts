import BN from 'bn.js';
import {
  Account,
  AccountInfo,
  Commitment,
  Connection,
  PublicKey,
  RpcResponseAndContext,
  SimulatedTransactionResponse,
  SystemProgram,
  Transaction,
  TransactionConfirmationStatus,
  TransactionInstruction,
  TransactionSignature,
} from '@solana/web3.js';
import { OpenOrders, TokenInstructions } from '@project-serum/serum';
import { I80F48, ONE_I80F48 } from './fixednum';
import LyraeGroup from '../LyraeGroup';
import { HealthType } from '../LyraeAccount';

export const ZERO_BN = new BN(0);

export const ONE_BN = new BN(1);

export const U64_MAX_BN = new BN('18446744073709551615');

export const zeroKey = new PublicKey(new Uint8Array(32));

export async function promiseUndef(): Promise<undefined> {
  return undefined;
}

export async function promiseNull(): Promise<null> {
  return null;
}

export function optionalBNFromString(x?: string): BN | undefined {
  return x ? new BN(x) : undefined;
}

export function uiToNative(amount: number, decimals: number): BN {
  return new BN(Math.round(amount * Math.pow(10, decimals)));
}

export function nativeToUi(amount: number, decimals: number): number {
  return amount / Math.pow(10, decimals);
}

export function nativeI80F48ToUi(amount: I80F48, decimals: number): I80F48 {
  return amount.div(I80F48.fromNumber(Math.pow(10, decimals)));
}

export class TimeoutError extends Error {
  message: string;
  txid: string;

  constructor({ txid }) {
    super();
    this.message = `Timed out awaiting confirmation. Please confirm in the explorer: `;
    this.txid = txid;
  }
}

export class LyraeError extends Error {
  message: string;
  txid: string;

  constructor({ txid, message }) {
    super();
    this.message = message;
    this.txid = txid;
  }
}

export function getWeights(
  lyraeGroup: LyraeGroup,
  marketIndex: number,
  healthType?: HealthType,
): {
  spotAssetWeight: I80F48;
  spotLiabWeight: I80F48;
  perpAssetWeight: I80F48;
  perpLiabWeight: I80F48;
} {
  if (healthType === 'Maint') {
    return {
      spotAssetWeight: lyraeGroup.spotMarkets[marketIndex].maintAssetWeight,
      spotLiabWeight: lyraeGroup.spotMarkets[marketIndex].maintLiabWeight,
      perpAssetWeight: lyraeGroup.perpMarkets[marketIndex].maintAssetWeight,
      perpLiabWeight: lyraeGroup.perpMarkets[marketIndex].maintLiabWeight,
    };
  } else if (healthType === 'Init') {
    return {
      spotAssetWeight: lyraeGroup.spotMarkets[marketIndex].initAssetWeight,
      spotLiabWeight: lyraeGroup.spotMarkets[marketIndex].initLiabWeight,
      perpAssetWeight: lyraeGroup.perpMarkets[marketIndex].initAssetWeight,
      perpLiabWeight: lyraeGroup.perpMarkets[marketIndex].initLiabWeight,
    };
  } else {
    return {
      spotAssetWeight: ONE_I80F48,
      spotLiabWeight: ONE_I80F48,
      perpAssetWeight: ONE_I80F48,
      perpLiabWeight: ONE_I80F48,
    };
  }
}

export function splitOpenOrders(openOrders: OpenOrders): {
  quoteFree: I80F48;
  quoteLocked: I80F48;
  baseFree: I80F48;
  baseLocked: I80F48;
} {
  const quoteFree = I80F48.fromU64(
    openOrders.quoteTokenFree.add(openOrders['referrerRebatesAccrued']),
  );
  const quoteLocked = I80F48.fromU64(
    openOrders.quoteTokenTotal.sub(openOrders.quoteTokenFree),
  );
  const baseFree = I80F48.fromU64(openOrders.baseTokenFree);
  const baseLocked = I80F48.fromU64(
    openOrders.baseTokenTotal.sub(openOrders.baseTokenFree),
  );
  return { quoteFree, quoteLocked, baseFree, baseLocked };
}

export async function awaitTransactionSignatureConfirmation(
  txid: TransactionSignature,
  timeout: number,
  connection: Connection,
  confirmLevel: TransactionConfirmationStatus,
) {
  let done = false;

  const confirmLevels: (TransactionConfirmationStatus | null | undefined)[] = [
    'finalized',
  ];

  if (confirmLevel === 'confirmed') {
    confirmLevels.push('confirmed');
  } else if (confirmLevel === 'processed') {
    confirmLevels.push('confirmed');
    confirmLevels.push('processed');
  }
  const result = await new Promise((resolve, reject) => {
    (async () => {
      setTimeout(() => {
        if (done) {
          return;
        }
        done = true;
        console.log('Timed out for txid', txid);
        reject({ timeout: true });
      }, timeout);
      try {
        connection.onSignature(
          txid,
          (result) => {
            // console.log('WS confirmed', txid, result);
            done = true;
            if (result.err) {
              reject(result.err);
            } else {
              resolve(result);
            }
          },
          'processed',
        );
        // console.log('Set up WS connection', txid);
      } catch (e) {
        done = true;
        console.log('WS error in setup', txid, e);
      }
      while (!done) {
        // eslint-disable-next-line no-loop-func
        (async () => {
          try {
            const signatureStatuses = await connection.getSignatureStatuses([
              txid,
            ]);
            const result = signatureStatuses && signatureStatuses.value[0];
            if (!done) {
              if (!result) {
                // console.log('REST null result for', txid, result);
              } else if (result.err) {
                console.log('REST error for', txid, result);
                done = true;
                reject(result.err);
              } else if (
                !(
                  result.confirmations ||
                  confirmLevels.includes(result.confirmationStatus)
                )
              ) {
                console.log('REST not confirmed', txid, result);
              } else {
                console.log('REST confirmed', txid, result);
                done = true;
                resolve(result);
              }
            }
          } catch (e) {
            if (!done) {
              console.log('REST connection error: txid', txid, e);
            }
          }
        })();
        await sleep(300);
      }
    })();
  });

  done = true;
  return result;
}

export async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function simulateTransaction(
  connection: Connection,
  transaction: Transaction,
  commitment: Commitment,
): Promise<RpcResponseAndContext<SimulatedTransactionResponse>> {
  // @ts-ignore
  transaction.recentBlockhash = await connection._recentBlockhash(
    // @ts-ignore
    connection._disableBlockhashCaching,
  );

  const signData = transaction.serializeMessage();
  // @ts-ignore
  const wireTransaction = transaction._serialize(signData);
  const encodedTransaction = wireTransaction.toString('base64');
  const config: any = { encoding: 'base64', commitment };
  const args = [encodedTransaction, config];

  // @ts-ignore
  const res = await connection._rpcRequest('simulateTransaction', args);
  if (res.error) {
    throw new Error('failed to simulate transaction: ' + res.error.message);
  }
  return res.result;
}

export async function createAccountInstruction(
  connection: Connection,
  payer: PublicKey,
  space: number,
  owner: PublicKey,
  lamports?: number,
): Promise<{ account: Account; instruction: TransactionInstruction }> {
  const account = new Account();
  const instruction = SystemProgram.createAccount({
    fromPubkey: payer,
    newAccountPubkey: account.publicKey,
    lamports: lamports
      ? lamports
      : await connection.getMinimumBalanceForRentExemption(space),
    space,
    programId: owner,
  });

  return { account, instruction };
}

export async function createTokenAccountInstructions(
  connection: Connection,
  payer: PublicKey,
  account: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
): Promise<TransactionInstruction[]> {
  return [
    SystemProgram.createAccount({
      fromPubkey: payer,
      newAccountPubkey: account,
      lamports: await connection.getMinimumBalanceForRentExemption(165),
      space: 165,
      programId: TokenInstructions.TOKEN_PROGRAM_ID,
    }),
    TokenInstructions.initializeAccount({
      account: account,
      mint,
      owner,
    }),
  ];
}

export async function createSignerKeyAndNonce(
  programId: PublicKey,
  accountKey: PublicKey,
): Promise<{ signerKey: PublicKey; signerNonce: number }> {
  // let res = await PublicKey.findProgramAddress([accountKey.toBuffer()], programId);
  // console.log(res);
  // return {
  //   signerKey: res[0],
  //   signerNonce: res[1]
  // };
  for (let nonce = 0; nonce <= Number.MAX_SAFE_INTEGER; nonce++) {
    try {
      const nonceBuffer = Buffer.alloc(8);
      nonceBuffer.writeUInt32LE(nonce, 0);
      const seeds = [accountKey.toBuffer(), nonceBuffer];
      const key = await PublicKey.createProgramAddress(seeds, programId);
      return {
        signerKey: key,
        signerNonce: nonce,
      };
    } catch (e) {
      continue;
    }
  }

  throw new Error('Could not generate signer key');
}

export async function getFilteredProgramAccounts(
  connection: Connection,
  programId: PublicKey,
  filters,
): Promise<{ publicKey: PublicKey; accountInfo: AccountInfo<Buffer> }[]> {
  // @ts-ignore
  const resp = await connection._rpcRequest('getProgramAccounts', [
    programId.toBase58(),
    {
      commitment: connection.commitment,
      filters,
      encoding: 'base64',
    },
  ]);
  if (resp.error) {
    throw new Error(resp.error.message);
  }
  if (resp.result) {
    const nullResults = resp.result.filter((r) => r?.account === null);
    if (nullResults.length > 0)
      throw new Error(
        `gpa returned ${nullResults.length
        } null results. ex: ${nullResults[0]?.pubkey.toString()}`,
      );
  }
  return resp.result.map(
    ({ pubkey, account: { data, executable, owner, lamports } }) => ({
      publicKey: new PublicKey(pubkey),
      accountInfo: {
        data: Buffer.from(data[0], 'base64'),
        executable,
        owner: new PublicKey(owner),
        lamports,
      },
    }),
  );
}

export function clamp(x: number, min: number, max: number): number {
  if (x < min) {
    return min;
  } else if (x > max) {
    return max;
  } else {
    return x;
  }
}

export async function getMultipleAccounts(
  connection: Connection,
  publicKeys: PublicKey[],
  commitment?: Commitment,
): Promise<
  {
    publicKey: PublicKey;
    context: { slot: number };
    accountInfo: AccountInfo<Buffer>;
  }[]
> {
  const len = publicKeys.length;
  if (len === 0) {
    return [];
  }
  if (len > 100) {
    const mid = Math.floor(publicKeys.length / 2);
    return Promise.all([
      getMultipleAccounts(connection, publicKeys.slice(0, mid), commitment),
      getMultipleAccounts(connection, publicKeys.slice(mid, len), commitment),
    ]).then((a) => a[0].concat(a[1]));
  }
  const publicKeyStrs = publicKeys.map((pk) => pk.toBase58());
  // load connection commitment as a default
  commitment ||= connection.commitment;

  const args = commitment ? [publicKeyStrs, { commitment }] : [publicKeyStrs];
  // @ts-ignore
  const resp = await connection._rpcRequest('getMultipleAccounts', args);
  if (resp.error) {
    throw new Error(resp.error.message);
  }
  if (resp.result) {
    const nullResults = resp.result.value.filter((r) => r?.account === null);
    if (nullResults.length > 0)
      throw new Error(
        `gma returned ${nullResults.length
        } null results. ex: ${nullResults[0]?.pubkey.toString()}`,
      );
  }
  return resp.result.value.map(
    ({ data, executable, lamports, owner }, i: number) => ({
      publicKey: publicKeys[i],
      context: resp.result.context,
      accountInfo: {
        data: Buffer.from(data[0], 'base64'),
        executable,
        owner: new PublicKey(owner),
        lamports,
      },
    }),
  );
}

export function throwUndefined<T>(x: T | undefined): T {
  if (x === undefined) {
    throw new Error('Undefined');
  }
  return x;
}

export function calculateLotSizes(
  baseDecimals: number,
  quoteDecimals: number,
  minTick: number,
  minSize: number,
): { baseLotSize: BN; quoteLotSize: BN } {
  const baseLotSize = minSize * Math.pow(10, baseDecimals);
  const quoteLotSize =
    (minTick * baseLotSize) / Math.pow(10, baseDecimals - quoteDecimals);
  return {
    baseLotSize: new BN(baseLotSize),
    quoteLotSize: new BN(quoteLotSize),
  };
}

export function findPerpMarketParams(
  nativeBaseDecimals: number,
  quoteDecimals: number,
  oraclePrice: number,

  leverage: number,
  lyrPerHour: number,
) {
  // wormhole wrapped tokens on solana will have a max of 8 decimals
  const baseDecimals = Math.min(nativeBaseDecimals, 8);

  // min tick targets around 1 basis point or 0.01% of price
  const minTick = Math.pow(10, Math.round(Math.log10(oraclePrice)) - 4);

  // minSize is targeted to be between 0.1 - 1 assuming USDC quote currency
  const minSize = Math.pow(10, -Math.round(Math.log10(oraclePrice)));

  const LIQUIDITY_PER_LYR = 500; // implies 1000 LYR per $500k top of book
  const contractVal = minSize * oraclePrice;
  const maxDepthBps = Math.floor(
    (lyrPerHour * LIQUIDITY_PER_LYR) / contractVal,
  );
  const lmSizeShift = Math.floor(Math.log2(maxDepthBps) - 3);

  const { baseLotSize, quoteLotSize } = calculateLotSizes(
    baseDecimals,
    quoteDecimals,
    minTick,
    minSize,
  );

  return {
    maintLeverage: leverage * 2,
    initLeverage: leverage,
    liquidationFee: 1 / (leverage * 4),
    makerFee: -0.0004,
    takerFee: 0.0005,
    baseLotSize: baseLotSize.toNumber(),
    quoteLotSize: quoteLotSize.toNumber(),
    rate: 0.03,
    maxDepthBps,
    exp: 2,
    maxNumEvents: 256,
    targetPeriodLength: 3600,
    lyrPerPeriod: lyrPerHour,
    version: 1,
    lmSizeShift,
    decimals: baseDecimals,
    minTick,
    minSize,
    baseDecimals,
  };
}