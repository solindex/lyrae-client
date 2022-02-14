import {
  Account,
  AccountInfo,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SimulatedTransactionResponse,
  SystemProgram,
  Transaction,
  TransactionConfirmationStatus,
  TransactionSignature,
} from '@solana/web3.js';
import BN from 'bn.js';
import fetch from 'cross-fetch';
import {
  createAccountInstruction,
  createSignerKeyAndNonce,
  createTokenAccountInstructions,
  getFilteredProgramAccounts,
  getMultipleAccounts,
  nativeToUi,
  promiseNull,
  promiseUndef,
  simulateTransaction,
  sleep,
  uiToNative,
  ZERO_BN,
  zeroKey,
} from './utils/utils';
import {
  AssetType,
  BookSideLayout,
  FREE_ORDER_SLOT,
  LyraeAccountLayout,
  LyraeCache,
  LyraeCacheLayout,
  LyraeGroupLayout,
  NodeBankLayout,
  PerpEventLayout,
  PerpEventQueueHeaderLayout,
  PerpMarketLayout,
  QUOTE_INDEX,
  RootBankLayout,
  StubOracleLayout,
} from './layout';
import LyraeAccount from './LyraeAccount';
import PerpMarket from './PerpMarket';
import RootBank from './RootBank';
import {
  makeAddLyraeAccountInfoInstruction,
  makeAddOracleInstruction,
  makeAddPerpMarketInstruction,
  makeAddPerpTriggerOrderInstruction,
  makeAddSpotMarketInstruction,
  makeCachePerpMarketsInstruction,
  makeCachePricesInstruction,
  makeCacheRootBankInstruction,
  makeCancelAllPerpOrdersInstruction,
  makeCancelPerpOrderInstruction,
  makeCancelPerpOrdersSideInstruction,
  makeCancelSpotOrderInstruction,
  makeChangePerpMarketParams2Instruction,
  makeChangePerpMarketParamsInstruction,
  makeChangeSpotMarketParamsInstruction,
  makeCloseAdvancedOrdersInstruction,
  makeCloseLyraeAccountInstruction,
  makeCloseSpotOpenOrdersInstruction,
  makeConsumeEventsInstruction,
  makeCreateDustAccountInstruction,
  makeCreateLyraeAccountInstruction,
  makeCreatePerpMarketInstruction,
  makeDepositInstruction,
  makeDepositMsrmInstruction,
  makeExecutePerpTriggerOrderInstruction,
  makeForceCancelPerpOrdersInstruction,
  makeForceCancelSpotOrdersInstruction,
  makeInitAdvancedOrdersInstruction,
  makeInitLyraeAccountInstruction,
  makeInitLyraeGroupInstruction,
  makeInitSpotOpenOrdersInstruction,
  makeLiquidatePerpMarketInstruction,
  makeLiquidateTokenAndPerpInstruction,
  makeLiquidateTokenAndTokenInstruction,
  makePlacePerpOrderInstruction,
  makePlaceSpotOrder2Instruction,
  makePlaceSpotOrderInstruction,
  makeRedeemLyrInstruction,
  makeRemoveAdvancedOrderInstruction,
  makeResolveDustInstruction,
  makeResolvePerpBankruptcyInstruction,
  makeResolveTokenBankruptcyInstruction,
  makeSetDelegateInstruction,
  makeSetGroupAdminInstruction,
  makeSetOracleInstruction,
  makeSettleFeesInstruction,
  makeSettleFundsInstruction,
  makeSettlePnlInstruction,
  makeUpdateFundingInstruction,
  makeUpdateMarginBasketInstruction,
  makeUpdateRootBankInstruction,
  makeUpgradeLyraeAccountV0V1Instruction,
  makeWithdrawInstruction,
  makeWithdrawMsrmInstruction,
} from './instruction';
import {
  getFeeRates,
  getFeeTier,
  Market,
  OpenOrders,
} from '@project-serum/serum';
import { I80F48, ONE_I80F48, ZERO_I80F48 } from './utils/fixednum';
import { Order } from '@project-serum/serum/lib/market';

import { PerpOrderType, WalletAdapter } from './utils/types';
import { BookSide, PerpOrder } from './book';
import {
  closeAccount,
  initializeAccount,
  WRAPPED_SOL_MINT,
} from '@project-serum/serum/lib/token-instructions';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Token,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import LyraeGroup from './LyraeGroup';
import {
  makeCreateSpotOpenOrdersInstruction,
  LyraeError,
  TimeoutError,
  U64_MAX_BN,
} from '.';

/**
 * Get the current epoch timestamp in seconds with microsecond precision
 */
export const getUnixTs = () => {
  return new Date().getTime() / 1000;
};

type AccountWithPnl = {
  publicKey: PublicKey;
  pnl: I80F48;
};


export class LyraeClient {
  connection: Connection;
  programId: PublicKey;
  lastSlot: number;
  recentBlockhash: string;
  recentBlockhashTime: number;
  postSendTxCallback?: ({ txid: string }) => void;

  constructor(
    connection: Connection,
    programId: PublicKey,
    opts: { postSendTxCallback?: ({ txid }: { txid: string }) => void } = {},
  ) {
    this.connection = connection;
    this.programId = programId;
    this.lastSlot = 0;
    this.recentBlockhash = '';
    this.recentBlockhashTime = 0;
    if (opts.postSendTxCallback) {
      this.postSendTxCallback = opts.postSendTxCallback;
    }
  }

  async sendTransactions(
    transactions: Transaction[],
    payer: Account | WalletAdapter,
    additionalSigners: Account[],
    timeout = 30000,
    confirmLevel: TransactionConfirmationStatus = 'confirmed',
  ): Promise<TransactionSignature[]> {
    return await Promise.all(
      transactions.map((tx) =>
        this.sendTransaction(
          tx,
          payer,
          additionalSigners,
          timeout,
          confirmLevel,
        ),
      ),
    );
  }

  async signTransaction({ transaction, payer, signers }) {
    const now = getUnixTs();
    // If last requested recentBlockhash is within a second, use that instead of fetching
    if (now > this.recentBlockhashTime + 1) {
      this.recentBlockhash = (
        await this.connection.getRecentBlockhash()
      ).blockhash;
      this.recentBlockhashTime = now;
    }
    transaction.recentBlockhash = this.recentBlockhash;
    transaction.setSigners(payer.publicKey, ...signers.map((s) => s.publicKey));
    if (signers.length > 0) {
      transaction.partialSign(...signers);
    }

    if (payer?.connected) {
      console.log('signing as wallet', payer.publicKey);
      return await payer.signTransaction(transaction);
    } else {
      transaction.sign(...[payer].concat(signers));
    }
  }

  async signTransactions({
    transactionsAndSigners,
    payer,
  }: {
    transactionsAndSigners: {
      transaction: Transaction;
      signers?: Array<Account>;
    }[];
    payer: Account | WalletAdapter;
  }) {
    const blockhash = (await this.connection.getRecentBlockhash('max'))
      .blockhash;
    transactionsAndSigners.forEach(({ transaction, signers = [] }) => {
      transaction.recentBlockhash = blockhash;
      transaction.setSigners(
        payer.publicKey,
        ...signers.map((s) => s.publicKey),
      );
      if (signers?.length > 0) {
        transaction.partialSign(...signers);
      }
    });
    if (!(payer instanceof Account)) {
      return await payer.signAllTransactions(
        transactionsAndSigners.map(({ transaction }) => transaction),
      );
    } else {
      transactionsAndSigners.forEach(({ transaction, signers }) => {
        // @ts-ignore
        transaction.sign(...[payer].concat(signers));
      });
      return transactionsAndSigners.map((t) => t.transaction);
    }
  }

  // TODO - switch Account to Keypair and switch off setSigners due to deprecated
  /**
   * Send a transaction using the Solana Web3.js connection on the lyrae client
   *
   * @param transaction
   * @param payer
   * @param additionalSigners
   * @param timeout Retries sending the transaction and trying to confirm it until the given timeout. Defaults to 30000ms. Passing null will disable the transaction confirmation check and always return success.
   */
  async sendTransaction(
    transaction: Transaction,
    payer: Account | WalletAdapter | Keypair,
    additionalSigners: Account[],
    timeout: number | null = 30000,
    confirmLevel: TransactionConfirmationStatus = 'processed',
  ): Promise<TransactionSignature> {
    await this.signTransaction({
      transaction,
      payer,
      signers: additionalSigners,
    });

    const rawTransaction = transaction.serialize();
    const startTime = getUnixTs();

    const txid: TransactionSignature = await this.connection.sendRawTransaction(
      rawTransaction,
      { skipPreflight: true },
    );

    if (this.postSendTxCallback) {
      try {
        this.postSendTxCallback({ txid });
      } catch (e) {
        console.log(`postSendTxCallback error ${e}`);
      }
    }

    if (!timeout) return txid;

    console.log(
      'Started awaiting confirmation for',
      txid,
      'size:',
      rawTransaction.length,
    );

    let done = false;

    let retrySleep = 15000;
    (async () => {
      // TODO - make sure this works well on mainnet
      while (!done && getUnixTs() - startTime < timeout / 1000) {
        await sleep(retrySleep);
        // console.log(new Date().toUTCString(), ' sending tx ', txid);
        this.connection.sendRawTransaction(rawTransaction, {
          skipPreflight: true,
        });
        if (retrySleep <= 6000) {
          retrySleep = retrySleep * 2;
        }
      }
    })();

    try {
      await this.awaitTransactionSignatureConfirmation(
        txid,
        timeout,
        confirmLevel,
      );
    } catch (err: any) {
      if (err.timeout) {
        throw new TimeoutError({ txid });
      }
      let simulateResult: SimulatedTransactionResponse | null = null;
      try {
        simulateResult = (
          await simulateTransaction(this.connection, transaction, 'processed')
        ).value;
      } catch (e) {
        console.warn('Simulate transaction failed');
      }

      if (simulateResult && simulateResult.err) {
        if (simulateResult.logs) {
          for (let i = simulateResult.logs.length - 1; i >= 0; --i) {
            const line = simulateResult.logs[i];
            if (line.startsWith('Program log: ')) {
              throw new LyraeError({
                message:
                  'Transaction failed: ' + line.slice('Program log: '.length),
                txid,
              });
            }
          }
        }
        throw new LyraeError({
          message: JSON.stringify(simulateResult.err),
          txid,
        });
      }
      throw new LyraeError({ message: 'Transaction failed', txid });
    } finally {
      done = true;
    }

    console.log('Latency', txid, getUnixTs() - startTime);
    return txid;
  }

  async sendSignedTransaction({
    signedTransaction,
    timeout = 30000,
    confirmLevel = 'processed',
  }: {
    signedTransaction: Transaction;
    timeout?: number;
    confirmLevel?: TransactionConfirmationStatus;
  }): Promise<TransactionSignature> {
    const rawTransaction = signedTransaction.serialize();
    const startTime = getUnixTs();

    const txid: TransactionSignature = await this.connection.sendRawTransaction(
      rawTransaction,
      {
        skipPreflight: true,
      },
    );

    if (this.postSendTxCallback) {
      try {
        this.postSendTxCallback({ txid });
      } catch (e) {
        console.log(`postSendTxCallback error ${e}`);
      }
    }

    // console.log('Started awaiting confirmation for', txid);

    let done = false;
    (async () => {
      await sleep(500);
      while (!done && getUnixTs() - startTime < timeout) {
        this.connection.sendRawTransaction(rawTransaction, {
          skipPreflight: true,
        });
        await sleep(1000);
      }
    })();
    try {
      await this.awaitTransactionSignatureConfirmation(
        txid,
        timeout,
        confirmLevel,
      );
    } catch (err: any) {
      if (err.timeout) {
        throw new TimeoutError({ txid });
      }
      let simulateResult: SimulatedTransactionResponse | null = null;
      try {
        simulateResult = (
          await simulateTransaction(
            this.connection,
            signedTransaction,
            'single',
          )
        ).value;
      } catch (e) {
        console.log('Simulate tx failed');
      }
      if (simulateResult && simulateResult.err) {
        if (simulateResult.logs) {
          for (let i = simulateResult.logs.length - 1; i >= 0; --i) {
            const line = simulateResult.logs[i];
            if (line.startsWith('Program log: ')) {
              throw new LyraeError({
                message:
                  'Transaction failed: ' + line.slice('Program log: '.length),
                txid,
              });
            }
          }
        }
        throw new LyraeError({
          message: JSON.stringify(simulateResult.err),
          txid,
        });
      }
      throw new LyraeError({ message: 'Transaction failed', txid });
    } finally {
      done = true;
    }

    // console.log('Latency', txid, getUnixTs() - startTime);
    return txid;
  }

  async awaitTransactionSignatureConfirmation(
    txid: TransactionSignature,
    timeout: number,
    confirmLevel: TransactionConfirmationStatus,
  ) {
    let done = false;

    const confirmLevels: (TransactionConfirmationStatus | null | undefined)[] =
      ['finalized'];

    if (confirmLevel === 'confirmed') {
      confirmLevels.push('confirmed');
    } else if (confirmLevel === 'processed') {
      confirmLevels.push('confirmed');
      confirmLevels.push('processed');
    }
    let subscriptionId;

    const result = await new Promise((resolve, reject) => {
      (async () => {
        setTimeout(() => {
          if (done) {
            return;
          }
          done = true;
          console.log('Timed out for txid: ', txid);
          reject({ timeout: true });
        }, timeout);
        try {
          subscriptionId = this.connection.onSignature(
            txid,
            (result, context) => {
              subscriptionId = undefined;
              done = true;
              if (result.err) {
                reject(result.err);
              } else {
                this.lastSlot = context?.slot;
                resolve(result);
              }
            },
            'processed',
          );
        } catch (e) {
          done = true;
          console.log('WS error in setup', txid, e);
        }
        let retrySleep = 200;
        while (!done) {
          // eslint-disable-next-line no-loop-func
          await sleep(retrySleep);
          (async () => {
            try {
              const response = await this.connection.getSignatureStatuses([
                txid,
              ]);

              const result = response && response.value[0];
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
                  this.lastSlot = response?.context?.slot;
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
          if (retrySleep <= 1600) {
            retrySleep = retrySleep * 2;
          }
        }
      })();
    });

    if (subscriptionId) {
      this.connection.removeSignatureListener(subscriptionId).catch((e) => {
        console.log('WS error in cleanup', e);
      });
    }

    done = true;
    return result;
  }

  /**
   * Create a new Lyrae group
   */
  async initLyraeGroup(
    quoteMint: PublicKey,
    msrmMint: PublicKey,
    dexProgram: PublicKey,
    feesVault: PublicKey, // owned by Lyrae DAO token governance
    validInterval: number,
    quoteOptimalUtil: number,
    quoteOptimalRate: number,
    quoteMaxRate: number,
    payer: Account | WalletAdapter,
  ): Promise<PublicKey> {
    const accountInstruction = await createAccountInstruction(
      this.connection,
      payer.publicKey,
      LyraeGroupLayout.span,
      this.programId,
    );
    const { signerKey, signerNonce } = await createSignerKeyAndNonce(
      this.programId,
      accountInstruction.account.publicKey,
    );
    const quoteVaultAccount = new Account();

    const quoteVaultAccountInstructions = await createTokenAccountInstructions(
      this.connection,
      payer.publicKey,
      quoteVaultAccount.publicKey,
      quoteMint,
      signerKey,
    );

    const insuranceVaultAccount = new Account();
    const insuranceVaultAccountInstructions =
      await createTokenAccountInstructions(
        this.connection,
        payer.publicKey,
        insuranceVaultAccount.publicKey,
        quoteMint,
        signerKey,
      );

    const quoteNodeBankAccountInstruction = await createAccountInstruction(
      this.connection,
      payer.publicKey,
      NodeBankLayout.span,
      this.programId,
    );
    const quoteRootBankAccountInstruction = await createAccountInstruction(
      this.connection,
      payer.publicKey,
      RootBankLayout.span,
      this.programId,
    );
    const cacheAccountInstruction = await createAccountInstruction(
      this.connection,
      payer.publicKey,
      LyraeCacheLayout.span,
      this.programId,
    );

    const createAccountsTransaction = new Transaction();
    createAccountsTransaction.add(accountInstruction.instruction);
    createAccountsTransaction.add(...quoteVaultAccountInstructions);
    createAccountsTransaction.add(quoteNodeBankAccountInstruction.instruction);
    createAccountsTransaction.add(quoteRootBankAccountInstruction.instruction);
    createAccountsTransaction.add(cacheAccountInstruction.instruction);
    createAccountsTransaction.add(...insuranceVaultAccountInstructions);

    const signers = [
      accountInstruction.account,
      quoteVaultAccount,
      quoteNodeBankAccountInstruction.account,
      quoteRootBankAccountInstruction.account,
      cacheAccountInstruction.account,
      insuranceVaultAccount,
    ];
    await this.sendTransaction(createAccountsTransaction, payer, signers);

    // If valid msrmMint passed in, then create new msrmVault
    let msrmVaultPk;
    if (!msrmMint.equals(zeroKey)) {
      const msrmVaultAccount = new Account();
      const msrmVaultAccountInstructions = await createTokenAccountInstructions(
        this.connection,
        payer.publicKey,
        msrmVaultAccount.publicKey,
        msrmMint,
        signerKey,
      );
      const createMsrmVaultTransaction = new Transaction();
      createMsrmVaultTransaction.add(...msrmVaultAccountInstructions);
      msrmVaultPk = msrmVaultAccount.publicKey;
      await this.sendTransaction(createMsrmVaultTransaction, payer, [
        msrmVaultAccount,
      ]);
    } else {
      msrmVaultPk = zeroKey;
    }

    const initLyraeGroupInstruction = makeInitLyraeGroupInstruction(
      this.programId,
      accountInstruction.account.publicKey,
      signerKey,
      payer.publicKey,
      quoteMint,
      quoteVaultAccount.publicKey,
      quoteNodeBankAccountInstruction.account.publicKey,
      quoteRootBankAccountInstruction.account.publicKey,
      insuranceVaultAccount.publicKey,
      msrmVaultPk,
      feesVault,
      cacheAccountInstruction.account.publicKey,
      dexProgram,
      new BN(signerNonce),
      new BN(validInterval),
      I80F48.fromNumber(quoteOptimalUtil),
      I80F48.fromNumber(quoteOptimalRate),
      I80F48.fromNumber(quoteMaxRate),
    );

    const initLyraeGroupTransaction = new Transaction();
    initLyraeGroupTransaction.add(initLyraeGroupInstruction);
    await this.sendTransaction(initLyraeGroupTransaction, payer, []);

    return accountInstruction.account.publicKey;
  }

  /**
   * Retrieve information about a Lyrae Group
   */
  async getLyraeGroup(lyraeGroup: PublicKey): Promise<LyraeGroup> {
    const accountInfo = await this.connection.getAccountInfo(lyraeGroup);
    const decoded = LyraeGroupLayout.decode(
      accountInfo == null ? undefined : accountInfo.data,
    );

    return new LyraeGroup(lyraeGroup, decoded);
  }

  /**
   * DEPRECATED - Create a new Lyrae Account on a given group
   */
  async initLyraeAccount(
    lyraeGroup: LyraeGroup,
    owner: Account | WalletAdapter,
  ): Promise<PublicKey> {
    const accountInstruction = await createAccountInstruction(
      this.connection,
      owner.publicKey,
      LyraeAccountLayout.span,
      this.programId,
    );

    const initLyraeAccountInstruction = makeInitLyraeAccountInstruction(
      this.programId,
      lyraeGroup.publicKey,
      accountInstruction.account.publicKey,
      owner.publicKey,
    );

    // Add all instructions to one atomic transaction
    const transaction = new Transaction();
    transaction.add(accountInstruction.instruction);
    transaction.add(initLyraeAccountInstruction);

    const additionalSigners = [accountInstruction.account];
    await this.sendTransaction(transaction, owner, additionalSigners);

    return accountInstruction.account.publicKey;
  }

  /**
   * Create a new Lyrae Account (PDA) on a given group
   */
  async createLyraeAccount(
    lyraeGroup: LyraeGroup,
    owner: Account | WalletAdapter,
    accountNum: number,
  ): Promise<PublicKey> {
    const accountNumBN = new BN(accountNum);
    const [lyraeAccountPk] = await PublicKey.findProgramAddress(
      [
        lyraeGroup.publicKey.toBytes(),
        owner.publicKey.toBytes(),
        accountNumBN.toBuffer('le', 8),
      ],
      this.programId,
    );

    const createLyraeAccountInstruction = makeCreateLyraeAccountInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccountPk,
      owner.publicKey,
      accountNumBN,
    );

    // Add all instructions to one atomic transaction
    const transaction = new Transaction();
    transaction.add(createLyraeAccountInstruction);

    await this.sendTransaction(transaction, owner, []);

    return lyraeAccountPk;
  }

  /**
   * Upgrade a Lyrae Account from V0 (not deletable) to V1 (deletable)
   */
  async upgradeLyraeAccountV0V1(
    lyraeGroup: LyraeGroup,
    owner: Account | WalletAdapter,
    accountNum: number,
  ): Promise<PublicKey> {
    const accountNumBN = new BN(accountNum);
    const [lyraeAccountPk] = await PublicKey.findProgramAddress(
      [
        lyraeGroup.publicKey.toBytes(),
        owner.publicKey.toBytes(),
        accountNumBN.toBuffer(),
      ],
      this.programId,
    );

    const upgradeLyraeAccountInstruction =
      makeUpgradeLyraeAccountV0V1Instruction(
        this.programId,
        lyraeGroup.publicKey,
        lyraeAccountPk,
        owner.publicKey,
      );

    const transaction = new Transaction();
    transaction.add(upgradeLyraeAccountInstruction);

    await this.sendTransaction(transaction, owner, []);

    return lyraeAccountPk;
  }

  /**
   * Retrieve information about a Lyrae Account
   */
  async getLyraeAccount(
    lyraeAccountPk: PublicKey,
    dexProgramId: PublicKey,
  ): Promise<LyraeAccount> {
    const acc = await this.connection.getAccountInfo(
      lyraeAccountPk,
      'processed',
    );
    const lyraeAccount = new LyraeAccount(
      lyraeAccountPk,
      LyraeAccountLayout.decode(acc == null ? undefined : acc.data),
    );
    await lyraeAccount.loadOpenOrders(this.connection, dexProgramId);
    return lyraeAccount;
  }

  /**
   * Create a new Lyrae Account and deposit some tokens in a single transaction
   *
   * @param rootBank The RootBank for the deposit currency
   * @param nodeBank The NodeBank asociated with the RootBank
   * @param vault The token account asociated with the NodeBank
   * @param tokenAcc The token account to transfer from
   * @param info An optional UI name for the account
   */
  async initLyraeAccountAndDeposit(
    lyraeGroup: LyraeGroup,
    owner: Account | WalletAdapter,
    rootBank: PublicKey,
    nodeBank: PublicKey,
    vault: PublicKey,
    tokenAcc: PublicKey,

    quantity: number,
    info?: string,
  ): Promise<string> {
    const transaction = new Transaction();
    const accountInstruction = await createAccountInstruction(
      this.connection,
      owner.publicKey,
      LyraeAccountLayout.span,
      this.programId,
    );

    const initLyraeAccountInstruction = makeInitLyraeAccountInstruction(
      this.programId,
      lyraeGroup.publicKey,
      accountInstruction.account.publicKey,
      owner.publicKey,
    );

    transaction.add(accountInstruction.instruction);
    transaction.add(initLyraeAccountInstruction);

    const additionalSigners = [accountInstruction.account];

    const tokenIndex = lyraeGroup.getRootBankIndex(rootBank);
    const tokenMint = lyraeGroup.tokens[tokenIndex].mint;

    let wrappedSolAccount: Account | null = null;
    if (
      tokenMint.equals(WRAPPED_SOL_MINT) &&
      tokenAcc.toBase58() === owner.publicKey.toBase58()
    ) {
      wrappedSolAccount = new Account();
      const lamports = Math.round(quantity * LAMPORTS_PER_SOL) + 1e7;
      transaction.add(
        SystemProgram.createAccount({
          fromPubkey: owner.publicKey,
          newAccountPubkey: wrappedSolAccount.publicKey,
          lamports,
          space: 165,
          programId: TOKEN_PROGRAM_ID,
        }),
      );

      transaction.add(
        initializeAccount({
          account: wrappedSolAccount.publicKey,
          mint: WRAPPED_SOL_MINT,
          owner: owner.publicKey,
        }),
      );

      additionalSigners.push(wrappedSolAccount);
    }

    const nativeQuantity = uiToNative(
      quantity,
      lyraeGroup.tokens[tokenIndex].decimals,
    );

    const instruction = makeDepositInstruction(
      this.programId,
      lyraeGroup.publicKey,
      owner.publicKey,
      lyraeGroup.lyraeCache,
      accountInstruction.account.publicKey,
      rootBank,
      nodeBank,
      vault,
      wrappedSolAccount?.publicKey ?? tokenAcc,
      nativeQuantity,
    );
    transaction.add(instruction);

    if (info) {
      const addAccountNameinstruction = makeAddLyraeAccountInfoInstruction(
        this.programId,
        lyraeGroup.publicKey,
        accountInstruction.account.publicKey,
        owner.publicKey,
        info,
      );
      transaction.add(addAccountNameinstruction);
    }

    if (wrappedSolAccount) {
      transaction.add(
        closeAccount({
          source: wrappedSolAccount.publicKey,
          destination: owner.publicKey,
          owner: owner.publicKey,
        }),
      );
    }

    await this.sendTransaction(transaction, owner, additionalSigners);

    return accountInstruction.account.publicKey.toString();
  }

  /**
   * Create a new Lyrae Account (PDA) and deposit some tokens in a single transaction
   *
   * @param rootBank The RootBank for the deposit currency
   * @param nodeBank The NodeBank asociated with the RootBank
   * @param vault The token account asociated with the NodeBank
   * @param tokenAcc The token account to transfer from
   * @param info An optional UI name for the account
   */
  async createLyraeAccountAndDeposit(
    lyraeGroup: LyraeGroup,
    owner: Account | WalletAdapter,
    rootBank: PublicKey,
    nodeBank: PublicKey,
    vault: PublicKey,
    tokenAcc: PublicKey,

    quantity: number,
    accountNum: number,
    info?: string,
  ): Promise<[string, TransactionSignature]> {
    const transaction = new Transaction();

    const accountNumBN = new BN(accountNum);
    const [lyraeAccountPk] = await PublicKey.findProgramAddress(
      [
        lyraeGroup.publicKey.toBytes(),
        owner.publicKey.toBytes(),
        accountNumBN.toArrayLike(Buffer, 'le', 8),
      ],
      this.programId,
    );

    const createLyraeAccountInstruction = makeCreateLyraeAccountInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccountPk,
      owner.publicKey,
      accountNumBN,
    );

    transaction.add(createLyraeAccountInstruction);

    const additionalSigners: Account[] = [];

    const tokenIndex = lyraeGroup.getRootBankIndex(rootBank);
    const tokenMint = lyraeGroup.tokens[tokenIndex].mint;

    let wrappedSolAccount: Account | null = null;
    if (
      tokenMint.equals(WRAPPED_SOL_MINT) &&
      tokenAcc.toBase58() === owner.publicKey.toBase58()
    ) {
      wrappedSolAccount = new Account();
      const lamports = Math.round(quantity * LAMPORTS_PER_SOL) + 1e7;
      transaction.add(
        SystemProgram.createAccount({
          fromPubkey: owner.publicKey,
          newAccountPubkey: wrappedSolAccount.publicKey,
          lamports,
          space: 165,
          programId: TOKEN_PROGRAM_ID,
        }),
      );

      transaction.add(
        initializeAccount({
          account: wrappedSolAccount.publicKey,
          mint: WRAPPED_SOL_MINT,
          owner: owner.publicKey,
        }),
      );

      additionalSigners.push(wrappedSolAccount);
    }

    const nativeQuantity = uiToNative(
      quantity,
      lyraeGroup.tokens[tokenIndex].decimals,
    );

    const instruction = makeDepositInstruction(
      this.programId,
      lyraeGroup.publicKey,
      owner.publicKey,
      lyraeGroup.lyraeCache,
      lyraeAccountPk,
      rootBank,
      nodeBank,
      vault,
      wrappedSolAccount?.publicKey ?? tokenAcc,
      nativeQuantity,
    );
    transaction.add(instruction);

    if (info) {
      const addAccountNameinstruction = makeAddLyraeAccountInfoInstruction(
        this.programId,
        lyraeGroup.publicKey,
        lyraeAccountPk,
        owner.publicKey,
        info,
      );
      transaction.add(addAccountNameinstruction);
    }

    if (wrappedSolAccount) {
      transaction.add(
        closeAccount({
          source: wrappedSolAccount.publicKey,
          destination: owner.publicKey,
          owner: owner.publicKey,
        }),
      );
    }

    const txid = await this.sendTransaction(
      transaction,
      owner,
      additionalSigners,
    );

    return [lyraeAccountPk.toString(), txid];
  }

  /**
   * Deposit tokens in a Lyrae Account
   *
   * @param rootBank The RootBank for the deposit currency
   * @param nodeBank The NodeBank asociated with the RootBank
   * @param vault The token account asociated with the NodeBank
   * @param tokenAcc The token account to transfer from
   */
  async deposit(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    owner: Account | WalletAdapter,
    rootBank: PublicKey,
    nodeBank: PublicKey,
    vault: PublicKey,
    tokenAcc: PublicKey,

    quantity: number,
  ): Promise<TransactionSignature> {
    const transaction = new Transaction();
    const additionalSigners: Array<Account> = [];
    const tokenIndex = lyraeGroup.getRootBankIndex(rootBank);
    const tokenMint = lyraeGroup.tokens[tokenIndex].mint;

    let wrappedSolAccount: Account | null = null;
    if (
      tokenMint.equals(WRAPPED_SOL_MINT) &&
      tokenAcc.toBase58() === owner.publicKey.toBase58()
    ) {
      wrappedSolAccount = new Account();
      const lamports = Math.round(quantity * LAMPORTS_PER_SOL) + 1e7;
      transaction.add(
        SystemProgram.createAccount({
          fromPubkey: owner.publicKey,
          newAccountPubkey: wrappedSolAccount.publicKey,
          lamports,
          space: 165,
          programId: TOKEN_PROGRAM_ID,
        }),
      );

      transaction.add(
        initializeAccount({
          account: wrappedSolAccount.publicKey,
          mint: WRAPPED_SOL_MINT,
          owner: owner.publicKey,
        }),
      );

      additionalSigners.push(wrappedSolAccount);
    }

    const nativeQuantity = uiToNative(
      quantity,
      lyraeGroup.tokens[tokenIndex].decimals,
    );

    const instruction = makeDepositInstruction(
      this.programId,
      lyraeGroup.publicKey,
      owner.publicKey,
      lyraeGroup.lyraeCache,
      lyraeAccount.publicKey,
      rootBank,
      nodeBank,
      vault,
      wrappedSolAccount?.publicKey ?? tokenAcc,
      nativeQuantity,
    );

    transaction.add(instruction);

    if (wrappedSolAccount) {
      transaction.add(
        closeAccount({
          source: wrappedSolAccount.publicKey,
          destination: owner.publicKey,
          owner: owner.publicKey,
        }),
      );
    }

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  /**
   * Withdraw tokens from a Lyrae Account
   *
   * @param rootBank The RootBank for the withdrawn currency
   * @param nodeBank The NodeBank asociated with the RootBank
   * @param vault The token account asociated with the NodeBank
   * @param allowBorrow Whether to borrow tokens if there are not enough deposits for the withdrawal
   */
  async withdraw(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    owner: Account | WalletAdapter,
    rootBank: PublicKey,
    nodeBank: PublicKey,
    vault: PublicKey,

    quantity: number,
    allowBorrow: boolean,
  ): Promise<TransactionSignature> {
    const transaction = new Transaction();
    const additionalSigners: Account[] = [];
    const tokenIndex = lyraeGroup.getRootBankIndex(rootBank);
    const tokenMint = lyraeGroup.tokens[tokenIndex].mint;

    let tokenAcc = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      tokenMint,
      owner.publicKey,
    );

    let wrappedSolAccount: Account | null = null;
    if (tokenMint.equals(WRAPPED_SOL_MINT)) {
      wrappedSolAccount = new Account();
      tokenAcc = wrappedSolAccount.publicKey;
      const space = 165;
      const lamports = await this.connection.getMinimumBalanceForRentExemption(
        space,
        'processed',
      );
      transaction.add(
        SystemProgram.createAccount({
          fromPubkey: owner.publicKey,
          newAccountPubkey: tokenAcc,
          lamports,
          space,
          programId: TOKEN_PROGRAM_ID,
        }),
      );
      transaction.add(
        initializeAccount({
          account: tokenAcc,
          mint: WRAPPED_SOL_MINT,
          owner: owner.publicKey,
        }),
      );
      additionalSigners.push(wrappedSolAccount);
    } else {
      const tokenAccExists = await this.connection.getAccountInfo(tokenAcc);
      if (!tokenAccExists) {
        transaction.add(
          Token.createAssociatedTokenAccountInstruction(
            ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            tokenMint,
            tokenAcc,
            owner.publicKey,
            owner.publicKey,
          ),
        );
      }
    }

    const nativeQuantity = uiToNative(
      quantity,
      lyraeGroup.tokens[tokenIndex].decimals,
    );

    const instruction = makeWithdrawInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccount.publicKey,
      owner.publicKey,
      lyraeGroup.lyraeCache,
      rootBank,
      nodeBank,
      vault,
      tokenAcc,
      lyraeGroup.signerKey,
      lyraeAccount.spotOpenOrders,
      nativeQuantity,
      allowBorrow,
    );
    transaction.add(instruction);

    if (wrappedSolAccount) {
      transaction.add(
        closeAccount({
          source: wrappedSolAccount.publicKey,
          destination: owner.publicKey,
          owner: owner.publicKey,
        }),
      );
    }

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  async withdrawAll(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    owner: Account | WalletAdapter,
  ) {
    const transactionsAndSigners: {
      transaction: Transaction;
      signers: Account[];
    }[] = [];
    for (const rootBank of lyraeGroup.rootBankAccounts) {
      const transactionAndSigners: {
        transaction: Transaction;
        signers: Account[];
      } = {
        transaction: new Transaction(),
        signers: [],
      };
      if (rootBank) {
        const tokenIndex = lyraeGroup.getRootBankIndex(rootBank?.publicKey);
        const tokenMint = lyraeGroup.tokens[tokenIndex].mint;
        // const decimals = lyraeGroup.tokens[tokenIndex].decimals;
        if (lyraeAccount.deposits[tokenIndex].isPos()) {
          let tokenAcc = await Token.getAssociatedTokenAddress(
            ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            tokenMint,
            owner.publicKey,
          );

          let wrappedSolAccount: Account | null = null;
          if (tokenMint.equals(WRAPPED_SOL_MINT)) {
            wrappedSolAccount = new Account();
            tokenAcc = wrappedSolAccount.publicKey;
            const space = 165;
            const lamports =
              await this.connection.getMinimumBalanceForRentExemption(
                space,
                'processed',
              );
            transactionAndSigners.transaction.add(
              SystemProgram.createAccount({
                fromPubkey: owner.publicKey,
                newAccountPubkey: tokenAcc,
                lamports,
                space,
                programId: TOKEN_PROGRAM_ID,
              }),
            );
            transactionAndSigners.transaction.add(
              initializeAccount({
                account: tokenAcc,
                mint: WRAPPED_SOL_MINT,
                owner: owner.publicKey,
              }),
            );
            transactionAndSigners.signers.push(wrappedSolAccount);
          } else {
            const tokenAccExists = await this.connection.getAccountInfo(
              tokenAcc,
              'recent',
            );
            if (!tokenAccExists) {
              transactionAndSigners.transaction.add(
                Token.createAssociatedTokenAccountInstruction(
                  ASSOCIATED_TOKEN_PROGRAM_ID,
                  TOKEN_PROGRAM_ID,
                  tokenMint,
                  tokenAcc,
                  owner.publicKey,
                  owner.publicKey,
                ),
              );
            }
          }

          const instruction = makeWithdrawInstruction(
            this.programId,
            lyraeGroup.publicKey,
            lyraeAccount.publicKey,
            owner.publicKey,
            lyraeGroup.lyraeCache,
            rootBank.publicKey,
            rootBank.nodeBanks[0],
            rootBank.nodeBankAccounts[0].vault,
            tokenAcc,
            lyraeGroup.signerKey,
            lyraeAccount.spotOpenOrders,
            new BN('18446744073709551615'), // u64::MAX to withdraw errything
            false,
          );
          transactionAndSigners.transaction.add(instruction);

          if (wrappedSolAccount) {
            transactionAndSigners.transaction.add(
              closeAccount({
                source: wrappedSolAccount.publicKey,
                destination: owner.publicKey,
                owner: owner.publicKey,
              }),
            );
          }
        }
      }
      transactionsAndSigners.push(transactionAndSigners);
    }

    const signedTransactions = await this.signTransactions({
      transactionsAndSigners,
      payer: owner,
    });

    if (signedTransactions) {
      for (const signedTransaction of signedTransactions) {
        if (signedTransaction.instructions.length == 0) {
          continue;
        }
        const txid = await this.sendSignedTransaction({
          signedTransaction,
        });
        console.log(txid);
      }
    } else {
      throw new Error('Unable to sign Settle All transaction');
    }
  }

  // Keeper functions
  /**
   * Called by the Keeper to cache interest rates from the RootBanks
   */
  async cacheRootBanks(
    lyraeGroup: PublicKey,
    lyraeCache: PublicKey,
    rootBanks: PublicKey[],
    payer: Account | WalletAdapter,
  ): Promise<TransactionSignature> {
    const cacheRootBanksInstruction = makeCacheRootBankInstruction(
      this.programId,
      lyraeGroup,
      lyraeCache,
      rootBanks,
    );

    const transaction = new Transaction();
    transaction.add(cacheRootBanksInstruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  /**
   * Called by the Keeper to cache prices from the Oracles
   */
  async cachePrices(
    lyraeGroup: PublicKey,
    lyraeCache: PublicKey,
    oracles: PublicKey[],
    payer: Account | WalletAdapter,
  ): Promise<TransactionSignature> {
    const cachePricesInstruction = makeCachePricesInstruction(
      this.programId,
      lyraeGroup,
      lyraeCache,
      oracles,
    );

    const transaction = new Transaction();
    transaction.add(cachePricesInstruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  /**
   * Called by the Keeper to cache perp market funding
   */
  async cachePerpMarkets(
    lyraeGroup: PublicKey,
    lyraeCache: PublicKey,
    perpMarkets: PublicKey[],
    payer: Account,
  ): Promise<TransactionSignature> {
    const cachePerpMarketsInstruction = makeCachePerpMarketsInstruction(
      this.programId,
      lyraeGroup,
      lyraeCache,
      perpMarkets,
    );

    const transaction = new Transaction();
    transaction.add(cachePerpMarketsInstruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  /**
   * Called by the Keeper to update interest rates on the RootBanks
   */
  async updateRootBank(
    lyraeGroup: LyraeGroup,
    rootBank: PublicKey,
    nodeBanks: PublicKey[],
    payer: Account | WalletAdapter,
  ): Promise<TransactionSignature> {
    const updateRootBanksInstruction = makeUpdateRootBankInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeGroup.lyraeCache,
      rootBank,
      nodeBanks,
    );

    const transaction = new Transaction();
    transaction.add(updateRootBanksInstruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  /**
   * Called by the Keeper to process events on the Perp order book
   */
  async consumeEvents(
    lyraeGroup: LyraeGroup,
    perpMarket: PerpMarket,
    lyraeAccounts: PublicKey[],
    payer: Account,
    limit: BN,
  ): Promise<TransactionSignature> {
    const consumeEventsInstruction = makeConsumeEventsInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeGroup.lyraeCache,
      perpMarket.publicKey,
      perpMarket.eventQueue,
      lyraeAccounts,
      limit,
    );

    const transaction = new Transaction();
    transaction.add(consumeEventsInstruction);

    return await this.sendTransaction(transaction, payer, [], null);
  }

  /**
   * Called by the Keeper to update funding on the perp markets
   */
  async updateFunding(
    lyraeGroup: PublicKey,
    lyraeCache: PublicKey,
    perpMarket: PublicKey,
    bids: PublicKey,
    asks: PublicKey,
    payer: Account,
  ): Promise<TransactionSignature> {
    const updateFundingInstruction = makeUpdateFundingInstruction(
      this.programId,
      lyraeGroup,
      lyraeCache,
      perpMarket,
      bids,
      asks,
    );

    const transaction = new Transaction();
    transaction.add(updateFundingInstruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  /**
   * Retrieve information about a perp market
   */
  async getPerpMarket(
    perpMarketPk: PublicKey,
    baseDecimal: number,
    quoteDecimal: number,
  ): Promise<PerpMarket> {
    const acc = await this.connection.getAccountInfo(perpMarketPk);
    const perpMarket = new PerpMarket(
      perpMarketPk,
      baseDecimal,
      quoteDecimal,
      PerpMarketLayout.decode(acc?.data),
    );
    return perpMarket;
  }

  /**
   * Place an order on a perp market
   *
   * @param clientOrderId An optional id that can be used to correlate events related to your order
   * @param bookSideInfo Account info for asks if side === bid, bids if side === ask. If this is given, crank instruction is added
   */
  async placePerpOrder(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    lyraeCache: PublicKey, // TODO - remove; already in LyraeGroup
    perpMarket: PerpMarket,
    owner: Account | WalletAdapter,

    side: 'buy' | 'sell',
    price: number,
    quantity: number,
    orderType?: PerpOrderType,
    clientOrderId = 0,
    bookSideInfo?: AccountInfo<Buffer>,
    reduceOnly?: boolean,
  ): Promise<TransactionSignature> {
    const [nativePrice, nativeQuantity] = perpMarket.uiToNativePriceQuantity(
      price,
      quantity,
    );
    const transaction = new Transaction();
    const additionalSigners: Account[] = [];

    const instruction = makePlacePerpOrderInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccount.publicKey,
      owner.publicKey,
      lyraeCache,
      perpMarket.publicKey,
      perpMarket.bids,
      perpMarket.asks,
      perpMarket.eventQueue,
      lyraeAccount.spotOpenOrders,
      nativePrice,
      nativeQuantity,
      new BN(clientOrderId),
      side,
      orderType,
      reduceOnly,
    );
    transaction.add(instruction);

    if (bookSideInfo) {
      const bookSide = bookSideInfo.data
        ? new BookSide(
          side === 'buy' ? perpMarket.asks : perpMarket.bids,
          perpMarket,
          BookSideLayout.decode(bookSideInfo.data),
        )
        : [];
      const accounts: Set<string> = new Set();
      accounts.add(lyraeAccount.publicKey.toBase58());

      for (const order of bookSide) {
        accounts.add(order.owner.toBase58());
        if (accounts.size >= 10) {
          break;
        }
      }

      const consumeInstruction = makeConsumeEventsInstruction(
        this.programId,
        lyraeGroup.publicKey,
        lyraeGroup.lyraeCache,
        perpMarket.publicKey,
        perpMarket.eventQueue,
        Array.from(accounts)
          .map((s) => new PublicKey(s))
          .sort(),
        new BN(4),
      );
      transaction.add(consumeInstruction);
    }

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  /**
   * Cancel an order on a perp market
   *
   * @param invalidIdOk Don't throw error if order is invalid
   */
  async cancelPerpOrder(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    owner: Account | WalletAdapter,
    perpMarket: PerpMarket,
    order: PerpOrder,
    invalidIdOk = false,
  ): Promise<TransactionSignature> {
    const instruction = makeCancelPerpOrderInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccount.publicKey,
      owner.publicKey,
      perpMarket.publicKey,
      perpMarket.bids,
      perpMarket.asks,
      order,
      invalidIdOk,
    );

    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  /**
   * Cancel all perp orders across all markets
   */
  async cancelAllPerpOrders(
    group: LyraeGroup,
    perpMarkets: PerpMarket[],
    lyraeAccount: LyraeAccount,
    owner: Account | WalletAdapter,
  ): Promise<TransactionSignature[]> {
    let tx = new Transaction();
    const transactions: Transaction[] = [];

    // Determine which market indexes have open orders
    const hasOrders = new Array(group.perpMarkets.length).fill(false);
    for (let i = 0; i < lyraeAccount.orderMarket.length; i++) {
      if (lyraeAccount.orderMarket[i] !== FREE_ORDER_SLOT) {
        hasOrders[lyraeAccount.orderMarket[i]] = true;
      }
    }

    for (let i = 0; i < group.perpMarkets.length; i++) {
      if (!hasOrders[i]) continue;

      const pmi = group.perpMarkets[i];
      if (pmi.isEmpty()) continue;
      const perpMarket = perpMarkets.find((pm) =>
        pm.publicKey.equals(pmi.perpMarket),
      );
      if (perpMarket === undefined) continue;

      const cancelAllInstr = makeCancelAllPerpOrdersInstruction(
        this.programId,
        group.publicKey,
        lyraeAccount.publicKey,
        owner.publicKey,
        perpMarket.publicKey,
        perpMarket.bids,
        perpMarket.asks,
        new BN(20),
      );
      tx.add(cancelAllInstr);
      if (tx.instructions.length === 2) {
        transactions.push(tx);
        tx = new Transaction();
      }
    }
    if (tx.instructions.length > 0) {
      transactions.push(tx);
    }

    const transactionsAndSigners = transactions.map((tx) => ({
      transaction: tx,
      signers: [],
    }));

    if (transactionsAndSigners.length === 0) {
      throw new Error('No orders to cancel');
    }

    // Sign multiple transactions at once for better UX
    const signedTransactions = await this.signTransactions({
      transactionsAndSigners,
      payer: owner,
    });
    if (signedTransactions) {
      return await Promise.all(
        signedTransactions.map((signedTransaction) =>
          this.sendSignedTransaction({ signedTransaction }),
        ),
      );
    } else {
      throw new Error('Unable to sign all CancelAllPerpOrders transactions');
    }
  }
  /*
  async loadPerpMarkets(perpMarkets: PublicKey[]): Promise<PerpMarket[]> {
    const accounts = await Promise.all(
      perpMarkets.map((pk) => this.connection.getAccountInfo(pk)),
    );

    const parsedPerpMarkets: PerpMarket[] = [];

    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i];
      if (acc) {
        const decoded = PerpMarketLayout.decode(acc.data);
        parsedPerpMarkets.push(new PerpMarket(perpMarkets[i], decoded));
      }
    }

    return parsedPerpMarkets;
  }
  */

  /**
   * Add a new oracle to a group
   */
  async addOracle(
    lyraeGroup: LyraeGroup,
    oracle: PublicKey,
    admin: Account,
  ): Promise<TransactionSignature> {
    const instruction = makeAddOracleInstruction(
      this.programId,
      lyraeGroup.publicKey,
      oracle,
      admin.publicKey,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    const additionalSigners = [];
    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  /**
   * Set the price of a 'stub' type oracle
   */
  async setOracle(
    lyraeGroup: LyraeGroup,
    oracle: PublicKey,
    admin: Account,
    price: I80F48,
  ): Promise<TransactionSignature> {
    const instruction = makeSetOracleInstruction(
      this.programId,
      lyraeGroup.publicKey,
      oracle,
      admin.publicKey,
      price,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    const additionalSigners = [];
    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  async addSpotMarket(
    lyraeGroup: LyraeGroup,
    oracle: PublicKey,
    spotMarket: PublicKey,
    mint: PublicKey,
    admin: Account,

    maintLeverage: number,
    initLeverage: number,
    liquidationFee: number,
    optimalUtil: number,
    optimalRate: number,
    maxRate: number,
  ): Promise<TransactionSignature> {
    const vaultAccount = new Account();

    const vaultAccountInstructions = await createTokenAccountInstructions(
      this.connection,
      admin.publicKey,
      vaultAccount.publicKey,
      mint,
      lyraeGroup.signerKey,
    );

    const nodeBankAccountInstruction = await createAccountInstruction(
      this.connection,
      admin.publicKey,
      NodeBankLayout.span,
      this.programId,
    );
    const rootBankAccountInstruction = await createAccountInstruction(
      this.connection,
      admin.publicKey,
      RootBankLayout.span,
      this.programId,
    );

    const instruction = makeAddSpotMarketInstruction(
      this.programId,
      lyraeGroup.publicKey,
      oracle,
      spotMarket,
      lyraeGroup.dexProgramId,
      mint,
      nodeBankAccountInstruction.account.publicKey,
      vaultAccount.publicKey,
      rootBankAccountInstruction.account.publicKey,
      admin.publicKey,
      I80F48.fromNumber(maintLeverage),
      I80F48.fromNumber(initLeverage),
      I80F48.fromNumber(liquidationFee),
      I80F48.fromNumber(optimalUtil),
      I80F48.fromNumber(optimalRate),
      I80F48.fromNumber(maxRate),
    );
    const transaction = new Transaction();
    transaction.add(...vaultAccountInstructions);
    transaction.add(nodeBankAccountInstruction.instruction);
    transaction.add(rootBankAccountInstruction.instruction);
    transaction.add(instruction);

    const additionalSigners = [
      vaultAccount,
      nodeBankAccountInstruction.account,
      rootBankAccountInstruction.account,
    ];
    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  /**
   * Make sure lyraeAccount has recent and valid inMarginBasket and spotOpenOrders
   */
  async placeSpotOrder(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    lyraeCache: PublicKey,
    spotMarket: Market,
    owner: Account | WalletAdapter,

    side: 'buy' | 'sell',
    price: number,
    size: number,
    orderType?: 'limit' | 'ioc' | 'postOnly',
    clientId?: BN,
  ): Promise<TransactionSignature> {
    const limitPrice = spotMarket.priceNumberToLots(price);
    const maxBaseQuantity = spotMarket.baseSizeNumberToLots(size);

    // TODO implement srm vault fee discount
    // const feeTier = getFeeTier(0, nativeToUi(lyraeGroup.nativeSrm || 0, SRM_DECIMALS));
    const feeTier = getFeeTier(0, nativeToUi(0, 0));
    const rates = getFeeRates(feeTier);
    const maxQuoteQuantity = new BN(
      spotMarket['_decoded'].quoteLotSize.toNumber() * (1 + rates.taker),
    ).mul(
      spotMarket
        .baseSizeNumberToLots(size)
        .mul(spotMarket.priceNumberToLots(price)),
    );

    if (maxBaseQuantity.lte(ZERO_BN)) {
      throw new Error('size too small');
    }
    if (limitPrice.lte(ZERO_BN)) {
      throw new Error('invalid price');
    }
    const selfTradeBehavior = 'decrementTake';
    clientId = clientId ?? new BN(Date.now());

    const spotMarketIndex = lyraeGroup.getSpotMarketIndex(spotMarket.publicKey);

    if (!lyraeGroup.rootBankAccounts.filter((a) => !!a).length) {
      await lyraeGroup.loadRootBanks(this.connection);
    }

    const baseRootBank = lyraeGroup.rootBankAccounts[spotMarketIndex];
    const baseNodeBank = baseRootBank?.nodeBankAccounts[0];
    const quoteRootBank = lyraeGroup.rootBankAccounts[QUOTE_INDEX];
    const quoteNodeBank = quoteRootBank?.nodeBankAccounts[0];

    if (!baseRootBank || !baseNodeBank || !quoteRootBank || !quoteNodeBank) {
      throw new Error('Invalid or missing banks');
    }

    const transaction = new Transaction();
    const additionalSigners: Account[] = [];
    const openOrdersKeys: { pubkey: PublicKey; isWritable: boolean }[] = [];

    // Only pass in open orders if in margin basket or current market index, and
    // the only writable account should be OpenOrders for current market index
    for (let i = 0; i < lyraeAccount.spotOpenOrders.length; i++) {
      let pubkey = zeroKey;
      let isWritable = false;

      if (i === spotMarketIndex) {
        isWritable = true;

        if (lyraeAccount.spotOpenOrders[spotMarketIndex].equals(zeroKey)) {
          // open orders missing for this market; create a new one now
          const openOrdersSpace = OpenOrders.getLayout(
            lyraeGroup.dexProgramId,
          ).span;

          const openOrdersLamports =
            await this.connection.getMinimumBalanceForRentExemption(
              openOrdersSpace,
              'processed',
            );

          const accInstr = await createAccountInstruction(
            this.connection,
            owner.publicKey,
            openOrdersSpace,
            lyraeGroup.dexProgramId,
            openOrdersLamports,
          );

          const initOpenOrders = makeInitSpotOpenOrdersInstruction(
            this.programId,
            lyraeGroup.publicKey,
            lyraeAccount.publicKey,
            owner.publicKey,
            lyraeGroup.dexProgramId,
            accInstr.account.publicKey,
            spotMarket.publicKey,
            lyraeGroup.signerKey,
          );

          const initTx = new Transaction();

          initTx.add(accInstr.instruction);
          initTx.add(initOpenOrders);

          await this.sendTransaction(initTx, owner, [accInstr.account]);

          pubkey = accInstr.account.publicKey;
        } else {
          pubkey = lyraeAccount.spotOpenOrders[i];
        }
      } else if (lyraeAccount.inMarginBasket[i]) {
        pubkey = lyraeAccount.spotOpenOrders[i];
      }

      openOrdersKeys.push({ pubkey, isWritable });
    }

    const dexSigner = await PublicKey.createProgramAddress(
      [
        spotMarket.publicKey.toBuffer(),
        spotMarket['_decoded'].vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
      ],
      spotMarket.programId,
    );

    const placeOrderInstruction = makePlaceSpotOrderInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccount.publicKey,
      owner.publicKey,
      lyraeCache,
      spotMarket.programId,
      spotMarket.publicKey,
      spotMarket['_decoded'].bids,
      spotMarket['_decoded'].asks,
      spotMarket['_decoded'].requestQueue,
      spotMarket['_decoded'].eventQueue,
      spotMarket['_decoded'].baseVault,
      spotMarket['_decoded'].quoteVault,
      baseRootBank.publicKey,
      baseNodeBank.publicKey,
      baseNodeBank.vault,
      quoteRootBank.publicKey,
      quoteNodeBank.publicKey,
      quoteNodeBank.vault,
      lyraeGroup.signerKey,
      dexSigner,
      lyraeGroup.srmVault, // TODO: choose msrm vault if it has any deposits
      openOrdersKeys,
      side,
      limitPrice,
      maxBaseQuantity,
      maxQuoteQuantity,
      selfTradeBehavior,
      orderType,
      clientId,
    );
    transaction.add(placeOrderInstruction);

    if (spotMarketIndex > 0) {
      console.log(
        spotMarketIndex - 1,
        lyraeAccount.spotOpenOrders[spotMarketIndex - 1].toBase58(),
        openOrdersKeys[spotMarketIndex - 1].pubkey.toBase58(),
      );
    }

    const txid = await this.sendTransaction(
      transaction,
      owner,
      additionalSigners,
    );

    // update LyraeAccount to have new OpenOrders pubkey
    lyraeAccount.spotOpenOrders[spotMarketIndex] =
      openOrdersKeys[spotMarketIndex].pubkey;
    lyraeAccount.inMarginBasket[spotMarketIndex] = true;
    console.log(
      spotMarketIndex,
      lyraeAccount.spotOpenOrders[spotMarketIndex].toBase58(),
      openOrdersKeys[spotMarketIndex].pubkey.toBase58(),
    );

    return txid;
  }

  /**
   * Make sure lyraeAccount has recent and valid inMarginBasket and spotOpenOrders
   */
  async placeSpotOrder2(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    spotMarket: Market,
    owner: Account | WalletAdapter,

    side: 'buy' | 'sell',
    price: number,
    size: number,
    orderType?: 'limit' | 'ioc' | 'postOnly',
    clientOrderId?: BN,
    useMsrmVault?: boolean | undefined,
  ): Promise<TransactionSignature[]> {
    const limitPrice = spotMarket.priceNumberToLots(price);
    const maxBaseQuantity = spotMarket.baseSizeNumberToLots(size);
    const allTransactions: Transaction[] = [];

    // TODO implement srm vault fee discount
    // const feeTier = getFeeTier(0, nativeToUi(lyraeGroup.nativeSrm || 0, SRM_DECIMALS));
    const feeTier = getFeeTier(0, nativeToUi(0, 0));
    const rates = getFeeRates(feeTier);
    const maxQuoteQuantity = new BN(
      spotMarket['_decoded'].quoteLotSize.toNumber() * (1 + rates.taker),
    ).mul(
      spotMarket
        .baseSizeNumberToLots(size)
        .mul(spotMarket.priceNumberToLots(price)),
    );

    if (maxBaseQuantity.lte(ZERO_BN)) {
      throw new Error('size too small');
    }
    if (limitPrice.lte(ZERO_BN)) {
      throw new Error('invalid price');
    }
    const selfTradeBehavior = 'decrementTake';

    const spotMarketIndex = lyraeGroup.getSpotMarketIndex(spotMarket.publicKey);

    if (!lyraeGroup.rootBankAccounts.filter((a) => !!a).length) {
      await lyraeGroup.loadRootBanks(this.connection);
    }
    let feeVault: PublicKey;
    if (useMsrmVault) {
      feeVault = lyraeGroup.msrmVault;
    } else if (useMsrmVault === false) {
      feeVault = lyraeGroup.srmVault;
    } else {
      const totalMsrm = await this.connection.getTokenAccountBalance(
        lyraeGroup.msrmVault,
      );
      feeVault =
        totalMsrm?.value?.uiAmount && totalMsrm.value.uiAmount > 0
          ? lyraeGroup.msrmVault
          : lyraeGroup.srmVault;
    }

    const baseRootBank = lyraeGroup.rootBankAccounts[spotMarketIndex];
    const baseNodeBank = baseRootBank?.nodeBankAccounts[0];
    const quoteRootBank = lyraeGroup.rootBankAccounts[QUOTE_INDEX];
    const quoteNodeBank = quoteRootBank?.nodeBankAccounts[0];

    if (!baseRootBank || !baseNodeBank || !quoteRootBank || !quoteNodeBank) {
      throw new Error('Invalid or missing banks');
    }

    const transaction = new Transaction();
    const openOrdersKeys: { pubkey: PublicKey; isWritable: boolean }[] = [];

    // Only pass in open orders if in margin basket or current market index, and
    // the only writable account should be OpenOrders for current market index
    let marketOpenOrdersKey = zeroKey;
    const initTx = new Transaction();
    for (let i = 0; i < lyraeAccount.spotOpenOrders.length; i++) {
      let pubkey = zeroKey;
      let isWritable = false;

      if (i === spotMarketIndex) {
        isWritable = true;

        if (lyraeAccount.spotOpenOrders[spotMarketIndex].equals(zeroKey)) {
          const spotMarketIndexBN = new BN(spotMarketIndex);
          const [openOrdersPk] = await PublicKey.findProgramAddress(
            [
              lyraeAccount.publicKey.toBytes(),
              spotMarketIndexBN.toArrayLike(Buffer, 'le', 8),
              new Buffer('OpenOrders', 'utf-8'),
            ],
            this.programId,
          );

          const initOpenOrders = makeCreateSpotOpenOrdersInstruction(
            this.programId,
            lyraeGroup.publicKey,
            lyraeAccount.publicKey,
            owner.publicKey,
            lyraeGroup.dexProgramId,
            openOrdersPk,
            spotMarket.publicKey,
            lyraeGroup.signerKey,
          );

          initTx.add(initOpenOrders);
          allTransactions.push(initTx);

          pubkey = openOrdersPk;
        } else {
          pubkey = lyraeAccount.spotOpenOrders[i];
        }
        marketOpenOrdersKey = pubkey;
      } else if (lyraeAccount.inMarginBasket[i]) {
        pubkey = lyraeAccount.spotOpenOrders[i];
      }

      // new design does not require zero keys to be passed in
      if (!pubkey.equals(zeroKey)) {
        openOrdersKeys.push({ pubkey, isWritable });
      }
    }

    const dexSigner = await PublicKey.createProgramAddress(
      [
        spotMarket.publicKey.toBuffer(),
        spotMarket['_decoded'].vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
      ],
      spotMarket.programId,
    );

    const placeOrderInstruction = makePlaceSpotOrder2Instruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccount.publicKey,
      owner.publicKey,
      lyraeGroup.lyraeCache,
      spotMarket.programId,
      spotMarket.publicKey,
      spotMarket['_decoded'].bids,
      spotMarket['_decoded'].asks,
      spotMarket['_decoded'].requestQueue,
      spotMarket['_decoded'].eventQueue,
      spotMarket['_decoded'].baseVault,
      spotMarket['_decoded'].quoteVault,
      baseRootBank.publicKey,
      baseNodeBank.publicKey,
      baseNodeBank.vault,
      quoteRootBank.publicKey,
      quoteNodeBank.publicKey,
      quoteNodeBank.vault,
      lyraeGroup.signerKey,
      dexSigner,
      feeVault,
      openOrdersKeys,
      side,
      limitPrice,
      maxBaseQuantity,
      maxQuoteQuantity,
      selfTradeBehavior,
      orderType,
      clientOrderId ?? new BN(Date.now()),
    );
    transaction.add(placeOrderInstruction);
    allTransactions.push(transaction);

    const signers = [];
    const transactionsAndSigners = allTransactions.map((tx) => ({
      transaction: tx,
      signers,
    }));

    const signedTransactions = await this.signTransactions({
      transactionsAndSigners,
      payer: owner,
    });

    const txids: TransactionSignature[] = [];

    if (signedTransactions) {
      for (const signedTransaction of signedTransactions) {
        if (signedTransaction.instructions.length == 0) {
          continue;
        }
        const txid = await this.sendSignedTransaction({
          signedTransaction,
        });
        txids.push(txid);
      }

      // update LyraeAccount to have new OpenOrders pubkey
      // We know this new key is in margin basket because if it was a full taker trade
      // there is some leftover from fee rebate. If maker trade there's the order.
      // and if it failed then we already exited before this line
      lyraeAccount.spotOpenOrders[spotMarketIndex] = marketOpenOrdersKey;
      lyraeAccount.inMarginBasket[spotMarketIndex] = true;
      console.log(
        spotMarketIndex,
        lyraeAccount.spotOpenOrders[spotMarketIndex].toBase58(),
        marketOpenOrdersKey.toBase58(),
      );
    } else {
      throw new Error('Unable to sign Settle All transaction');
    }

    return txids;
  }

  async cancelSpotOrder(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    owner: Account | WalletAdapter,
    spotMarket: Market,
    order: Order,
  ): Promise<TransactionSignature> {
    const transaction = new Transaction();
    const instruction = makeCancelSpotOrderInstruction(
      this.programId,
      lyraeGroup.publicKey,
      owner.publicKey,
      lyraeAccount.publicKey,
      spotMarket.programId,
      spotMarket.publicKey,
      spotMarket['_decoded'].bids,
      spotMarket['_decoded'].asks,
      order.openOrdersAddress,
      lyraeGroup.signerKey,
      spotMarket['_decoded'].eventQueue,
      order,
    );
    transaction.add(instruction);

    const dexSigner = await PublicKey.createProgramAddress(
      [
        spotMarket.publicKey.toBuffer(),
        spotMarket['_decoded'].vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
      ],
      spotMarket.programId,
    );

    const marketIndex = lyraeGroup.getSpotMarketIndex(spotMarket.publicKey);
    if (!lyraeGroup.rootBankAccounts.length) {
      await lyraeGroup.loadRootBanks(this.connection);
    }
    const baseRootBank = lyraeGroup.rootBankAccounts[marketIndex];
    const quoteRootBank = lyraeGroup.rootBankAccounts[QUOTE_INDEX];
    const baseNodeBank = baseRootBank?.nodeBankAccounts[0];
    const quoteNodeBank = quoteRootBank?.nodeBankAccounts[0];

    if (!baseNodeBank || !quoteNodeBank) {
      throw new Error('Invalid or missing node banks');
    }
    const settleFundsInstruction = makeSettleFundsInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeGroup.lyraeCache,
      owner.publicKey,
      lyraeAccount.publicKey,
      spotMarket.programId,
      spotMarket.publicKey,
      lyraeAccount.spotOpenOrders[marketIndex],
      lyraeGroup.signerKey,
      spotMarket['_decoded'].baseVault,
      spotMarket['_decoded'].quoteVault,
      lyraeGroup.tokens[marketIndex].rootBank,
      baseNodeBank.publicKey,
      lyraeGroup.tokens[QUOTE_INDEX].rootBank,
      quoteNodeBank.publicKey,
      baseNodeBank.vault,
      quoteNodeBank.vault,
      dexSigner,
    );
    transaction.add(settleFundsInstruction);

    const additionalSigners = [];

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  async settleFunds(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    owner: Account | WalletAdapter,
    spotMarket: Market,
  ): Promise<TransactionSignature> {
    const marketIndex = lyraeGroup.getSpotMarketIndex(spotMarket.publicKey);
    const dexSigner = await PublicKey.createProgramAddress(
      [
        spotMarket.publicKey.toBuffer(),
        spotMarket['_decoded'].vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
      ],
      spotMarket.programId,
    );

    if (!lyraeGroup.rootBankAccounts.length) {
      await lyraeGroup.loadRootBanks(this.connection);
    }
    const baseRootBank = lyraeGroup.rootBankAccounts[marketIndex];
    const quoteRootBank = lyraeGroup.rootBankAccounts[QUOTE_INDEX];
    const baseNodeBank = baseRootBank?.nodeBankAccounts[0];
    const quoteNodeBank = quoteRootBank?.nodeBankAccounts[0];

    if (!baseNodeBank || !quoteNodeBank) {
      throw new Error('Invalid or missing node banks');
    }

    const instruction = makeSettleFundsInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeGroup.lyraeCache,
      owner.publicKey,
      lyraeAccount.publicKey,
      spotMarket.programId,
      spotMarket.publicKey,
      lyraeAccount.spotOpenOrders[marketIndex],
      lyraeGroup.signerKey,
      spotMarket['_decoded'].baseVault,
      spotMarket['_decoded'].quoteVault,
      lyraeGroup.tokens[marketIndex].rootBank,
      baseNodeBank.publicKey,
      lyraeGroup.tokens[QUOTE_INDEX].rootBank,
      quoteNodeBank.publicKey,
      baseNodeBank.vault,
      quoteNodeBank.vault,
      dexSigner,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    const additionalSigners = [];
    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  /**
   * Assumes spotMarkets contains all Markets in LyraeGroup in order
   */
  async settleAll(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    spotMarkets: Market[],
    owner: Account | WalletAdapter,
  ): Promise<TransactionSignature[]> {
    const transactions: Transaction[] = [];

    let j = 0;
    for (let i = 0; i < lyraeGroup.spotMarkets.length; i++) {
      if (lyraeGroup.spotMarkets[i].isEmpty()) continue;
      const spotMarket = spotMarkets[j];
      j++;

      const transaction = new Transaction();
      const openOrdersAccount = lyraeAccount.spotOpenOrdersAccounts[i];
      if (openOrdersAccount === undefined) continue;

      if (
        openOrdersAccount.quoteTokenFree.toNumber() +
        openOrdersAccount['referrerRebatesAccrued'].toNumber() ===
        0 &&
        openOrdersAccount.baseTokenFree.toNumber() === 0
      ) {
        continue;
      }

      const dexSigner = await PublicKey.createProgramAddress(
        [
          spotMarket.publicKey.toBuffer(),
          spotMarket['_decoded'].vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
        ],
        spotMarket.programId,
      );

      if (!lyraeGroup.rootBankAccounts.length) {
        await lyraeGroup.loadRootBanks(this.connection);
      }
      const baseRootBank = lyraeGroup.rootBankAccounts[i];
      const quoteRootBank = lyraeGroup.rootBankAccounts[QUOTE_INDEX];
      const baseNodeBank = baseRootBank?.nodeBankAccounts[0];
      const quoteNodeBank = quoteRootBank?.nodeBankAccounts[0];

      if (!baseNodeBank || !quoteNodeBank) {
        throw new Error('Invalid or missing node banks');
      }

      const instruction = makeSettleFundsInstruction(
        this.programId,
        lyraeGroup.publicKey,
        lyraeGroup.lyraeCache,
        owner.publicKey,
        lyraeAccount.publicKey,
        spotMarket.programId,
        spotMarket.publicKey,
        lyraeAccount.spotOpenOrders[i],
        lyraeGroup.signerKey,
        spotMarket['_decoded'].baseVault,
        spotMarket['_decoded'].quoteVault,
        lyraeGroup.tokens[i].rootBank,
        baseNodeBank.publicKey,
        lyraeGroup.tokens[QUOTE_INDEX].rootBank,
        quoteNodeBank.publicKey,
        baseNodeBank.vault,
        quoteNodeBank.vault,
        dexSigner,
      );

      transaction.add(instruction);
      transactions.push(transaction);
    }

    const signers = [];
    const transactionsAndSigners = transactions.map((tx) => ({
      transaction: tx,
      signers,
    }));

    const signedTransactions = await this.signTransactions({
      transactionsAndSigners,
      payer: owner,
    });

    const txids: TransactionSignature[] = [];

    if (signedTransactions) {
      for (const signedTransaction of signedTransactions) {
        if (signedTransaction.instructions.length == 0) {
          continue;
        }
        const txid = await this.sendSignedTransaction({
          signedTransaction,
        });
        txids.push(txid);
      }
    } else {
      throw new Error('Unable to sign Settle All transaction');
    }

    return txids;
  }

  async fetchTopPnlAccountsFromRPC(
    lyraeGroup: LyraeGroup,
    lyraeCache: LyraeCache,
    perpMarket: PerpMarket,
    price: I80F48, // should be the LyraeCache price
    sign: number,
    lyraeAccounts?: LyraeAccount[],
  ): Promise<AccountWithPnl[]> {
    const marketIndex = lyraeGroup.getPerpMarketIndex(perpMarket.publicKey);
    const perpMarketInfo = lyraeGroup.perpMarkets[marketIndex];

    if (lyraeAccounts === undefined) {
      lyraeAccounts = await this.getAllLyraeAccounts(lyraeGroup, [], false);
    }

    return lyraeAccounts
      .map((m) => ({
        publicKey: m.publicKey,
        pnl: m.perpAccounts[marketIndex].getPnl(
          perpMarketInfo,
          lyraeCache.perpMarketCache[marketIndex],
          price,
        ),
      }))
      .sort((a, b) => sign * a.pnl.cmp(b.pnl));
  }

  async fetchTopPnlAccountsFromDB(
    lyraeGroup: LyraeGroup,
    perpMarket: PerpMarket,
    sign: number,
  ): Promise<AccountWithPnl[]> {
    const marketIndex = lyraeGroup.getPerpMarketIndex(perpMarket.publicKey);
    const order = sign === 1 ? 'ASC' : 'DESC';

    const response = await fetch(
      `https://mango-transaction-log.herokuapp.com/v3/stats/ranked-pnl?market-index=${marketIndex}&order=${order}&limit=20`,
    );
    const data = await response.json();

    return data.map((m) => ({
      publicKey: new PublicKey(m.pubkey),
      pnl: I80F48.fromNumber(m.pnl),
    }));
  }

  /**
   * Automatically fetch LyraeAccounts for this PerpMarket
   * Pick enough LyraeAccounts that have opposite sign and send them in to get settled
   */
  async settlePnl(
    lyraeGroup: LyraeGroup,
    lyraeCache: LyraeCache,
    lyraeAccount: LyraeAccount,
    perpMarket: PerpMarket,
    quoteRootBank: RootBank,
    price: I80F48, // should be the LyraeCache price
    owner: Account | WalletAdapter,
    lyraeAccounts?: LyraeAccount[],
  ): Promise<TransactionSignature | null> {
    // fetch all LyraeAccounts filtered for having this perp market in basket
    const marketIndex = lyraeGroup.getPerpMarketIndex(perpMarket.publicKey);
    const perpMarketInfo = lyraeGroup.perpMarkets[marketIndex];
    let pnl = lyraeAccount.perpAccounts[marketIndex].getPnl(
      perpMarketInfo,
      lyraeCache.perpMarketCache[marketIndex],
      price,
    );
    const transaction = new Transaction();
    const additionalSigners: Account[] = [];

    let sign;
    if (pnl.eq(ZERO_I80F48)) {
      // Can't settle pnl if there is no pnl
      return null;
    } else if (pnl.gt(ZERO_I80F48)) {
      sign = 1;
    } else {
      // Can settle fees first against perpmarket

      sign = -1;
      if (!quoteRootBank.nodeBankAccounts) {
        await quoteRootBank.loadNodeBanks(this.connection);
      }
      const settleFeesInstr = makeSettleFeesInstruction(
        this.programId,
        lyraeGroup.publicKey,
        lyraeCache.publicKey,
        perpMarket.publicKey,
        lyraeAccount.publicKey,
        quoteRootBank.publicKey,
        quoteRootBank.nodeBanks[0],
        quoteRootBank.nodeBankAccounts[0].vault,
        lyraeGroup.feesVault,
        lyraeGroup.signerKey,
      );
      transaction.add(settleFeesInstr);
      pnl = pnl.add(perpMarket.feesAccrued).min(I80F48.fromString('-0.000001'));
      const remSign = pnl.gt(ZERO_I80F48) ? 1 : -1;
      if (remSign !== sign) {
        // if pnl has changed sign, then we're done
        return await this.sendTransaction(
          transaction,
          owner,
          additionalSigners,
        );
      }
    }

    // we don't maintain an off chain service for finding accounts for
    // devnet, so use fetchTopPnlAccountsFromDB only for mainnet
    let accountsWithPnl;
    // note: simplistic way of checking if we are on mainnet
    const isMainnet =
      (this.connection as any)['_rpcEndpoint'] &&
      !(this.connection as any)['_rpcEndpoint']
        .toLowerCase()
        // usually devnet rpc endpoints have devnet in them, mainnet ones don't
        .includes('devnet');
    if (isMainnet) {
      try {
        accountsWithPnl = await this.fetchTopPnlAccountsFromDB(
          lyraeGroup,
          perpMarket,
          sign,
        );
      } catch (e) {
        console.error(`fetchTopPnlAccountsFromDB failed, ${e}`);
      }
    }
    // if not set, then always fallback
    if (!accountsWithPnl) {
      accountsWithPnl = await this.fetchTopPnlAccountsFromRPC(
        lyraeGroup,
        lyraeCache,
        perpMarket,
        price,
        sign,
        lyraeAccounts,
      );
    }

    for (const account of accountsWithPnl) {
      // ignore own account explicitly
      if (account.publicKey.equals(lyraeAccount.publicKey)) {
        continue;
      }
      if (
        ((pnl.isPos() && account.pnl.isNeg()) ||
          (pnl.isNeg() && account.pnl.isPos())) &&
        transaction.instructions.length < 10
      ) {
        // Account pnl must have opposite signs
        const instr = makeSettlePnlInstruction(
          this.programId,
          lyraeGroup.publicKey,
          lyraeAccount.publicKey,
          account.publicKey,
          lyraeGroup.lyraeCache,
          quoteRootBank.publicKey,
          quoteRootBank.nodeBanks[0],
          new BN(marketIndex),
        );
        transaction.add(instr);
        pnl = pnl.add(account.pnl);
        // if pnl has changed sign, then we're done
        const remSign = pnl.gt(ZERO_I80F48) ? 1 : -1;
        if (remSign !== sign) {
          break;
        }
      } else {
        // means we ran out of accounts to settle against (shouldn't happen) OR transaction too big
        // TODO - create a multi tx to be signed by user
        continue;
      }
    }

    return await this.sendTransaction(transaction, owner, additionalSigners);

    // Calculate the profit or loss per market
  }

  /**
   * Settle all perp accounts with positive pnl
   */
  async settlePosPnl(
    lyraeGroup: LyraeGroup,
    lyraeCache: LyraeCache,
    lyraeAccount: LyraeAccount,
    perpMarkets: PerpMarket[],
    quoteRootBank: RootBank,
    owner: Account | WalletAdapter,
    lyraeAccounts?: LyraeAccount[],
  ): Promise<(TransactionSignature | null)[]> {
    // fetch all LyraeAccounts filtered for having this perp market in basket
    if (lyraeAccounts === undefined) {
      lyraeAccounts = await this.getAllLyraeAccounts(lyraeGroup, [], false);
    }
    return await Promise.all(
      perpMarkets.map((pm) => {
        const marketIndex = lyraeGroup.getPerpMarketIndex(pm.publicKey);
        const perpMarketInfo = lyraeGroup.perpMarkets[marketIndex];
        const price = lyraeCache.getPrice(marketIndex);
        const pnl = lyraeAccount.perpAccounts[marketIndex].getPnl(
          perpMarketInfo,
          lyraeCache.perpMarketCache[marketIndex],
          price,
        );
        return pnl.isPos()
          ? this.settlePnl(
            lyraeGroup,
            lyraeCache,
            lyraeAccount,
            pm,
            quoteRootBank,
            lyraeCache.getPrice(marketIndex),
            owner,
            lyraeAccounts,
          )
          : promiseNull();
      }),
    );
  }

  /**
   * Settle all perp accounts with any pnl
   */
  async settleAllPerpPnl(
    lyraeGroup: LyraeGroup,
    lyraeCache: LyraeCache,
    lyraeAccount: LyraeAccount,
    perpMarkets: PerpMarket[],
    quoteRootBank: RootBank,
    owner: Account | WalletAdapter,
    lyraeAccounts?: LyraeAccount[],
  ): Promise<(TransactionSignature | null)[]> {
    // fetch all LyraeAccounts filtered for having this perp market in basket
    if (lyraeAccounts === undefined) {
      lyraeAccounts = await this.getAllLyraeAccounts(lyraeGroup, [], false);
    }
    return await Promise.all(
      perpMarkets.map((pm) => {
        const marketIndex = lyraeGroup.getPerpMarketIndex(pm.publicKey);
        const perpMarketInfo = lyraeGroup.perpMarkets[marketIndex];
        const price = lyraeCache.getPrice(marketIndex);
        const pnl = lyraeAccount.perpAccounts[marketIndex].getPnl(
          perpMarketInfo,
          lyraeCache.perpMarketCache[marketIndex],
          price,
        );
        return !pnl.isZero()
          ? this.settlePnl(
            lyraeGroup,
            lyraeCache,
            lyraeAccount,
            pm,
            quoteRootBank,
            lyraeCache.getPrice(marketIndex),
            owner,
            lyraeAccounts,
          )
          : promiseNull();
      }),
    );
  }

  getLyraeAccountsForOwner(
    lyraeGroup: LyraeGroup,
    owner: PublicKey,
    includeOpenOrders = false,
  ): Promise<LyraeAccount[]> {
    const filters = [
      {
        memcmp: {
          offset: LyraeAccountLayout.offsetOf('owner'),
          bytes: owner.toBase58(),
        },
      },
    ];

    return this.getAllLyraeAccounts(lyraeGroup, filters, includeOpenOrders);
  }

  async getAllLyraeAccounts(
    lyraeGroup: LyraeGroup,
    filters?: any[],
    includeOpenOrders = true,
  ): Promise<LyraeAccount[]> {
    const accountFilters = [
      {
        memcmp: {
          offset: LyraeAccountLayout.offsetOf('lyraeGroup'),
          bytes: lyraeGroup.publicKey.toBase58(),
        },
      },
      {
        dataSize: LyraeAccountLayout.span,
      },
    ];

    if (filters && filters.length) {
      accountFilters.push(...filters);
    }

    const lyraeAccounts = await getFilteredProgramAccounts(
      this.connection,
      this.programId,
      accountFilters,
    ).then((accounts) =>
      accounts.map(({ publicKey, accountInfo }) => {
        return new LyraeAccount(
          publicKey,
          LyraeAccountLayout.decode(
            accountInfo == null ? undefined : accountInfo.data,
          ),
        );
      }),
    );

    if (includeOpenOrders) {
      const openOrderPks = lyraeAccounts
        .map((ma) => ma.spotOpenOrders.filter((pk) => !pk.equals(zeroKey)))
        .flat();

      const openOrderAccountInfos = await getMultipleAccounts(
        this.connection,
        openOrderPks,
      );

      const openOrders = openOrderAccountInfos.map(
        ({ publicKey, accountInfo }) =>
          OpenOrders.fromAccountInfo(
            publicKey,
            accountInfo,
            lyraeGroup.dexProgramId,
          ),
      );

      const pkToOpenOrdersAccount = {};
      openOrders.forEach((openOrdersAccount) => {
        pkToOpenOrdersAccount[openOrdersAccount.publicKey.toBase58()] =
          openOrdersAccount;
      });

      for (const ma of lyraeAccounts) {
        for (let i = 0; i < ma.spotOpenOrders.length; i++) {
          if (ma.spotOpenOrders[i].toBase58() in pkToOpenOrdersAccount) {
            ma.spotOpenOrdersAccounts[i] =
              pkToOpenOrdersAccount[ma.spotOpenOrders[i].toBase58()];
          }
        }
      }
    }

    return lyraeAccounts;
  }

  async addStubOracle(lyraeGroupPk: PublicKey, admin: Account) {
    const createOracleAccountInstruction = await createAccountInstruction(
      this.connection,
      admin.publicKey,
      StubOracleLayout.span,
      this.programId,
    );

    const instruction = makeAddOracleInstruction(
      this.programId,
      lyraeGroupPk,
      createOracleAccountInstruction.account.publicKey,
      admin.publicKey,
    );

    const transaction = new Transaction();
    transaction.add(createOracleAccountInstruction.instruction);
    transaction.add(instruction);

    const additionalSigners = [createOracleAccountInstruction.account];
    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  async setStubOracle(
    lyraeGroupPk: PublicKey,
    oraclePk: PublicKey,
    admin: Account,
    price: number,
  ) {
    const instruction = makeSetOracleInstruction(
      this.programId,
      lyraeGroupPk,
      oraclePk,
      admin.publicKey,
      I80F48.fromNumber(price),
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    const additionalSigners = [];
    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  async addPerpMarket(
    lyraeGroup: LyraeGroup,
    oraclePk: PublicKey,
    lyrMintPk: PublicKey,
    admin: Account,
    maintLeverage: number,
    initLeverage: number,
    liquidationFee: number,
    makerFee: number,
    takerFee: number,
    baseLotSize: number,
    quoteLotSize: number,
    maxNumEvents: number,
    rate: number, // liquidity mining params; set rate == 0 if no liq mining
    maxDepthBps: number,
    targetPeriodLength: number,
    lyrPerPeriod: number,
    exp: number,
  ) {
    const makePerpMarketAccountInstruction = await createAccountInstruction(
      this.connection,
      admin.publicKey,
      PerpMarketLayout.span,
      this.programId,
    );

    const makeEventQueueAccountInstruction = await createAccountInstruction(
      this.connection,
      admin.publicKey,
      PerpEventQueueHeaderLayout.span + maxNumEvents * PerpEventLayout.span,
      this.programId,
    );

    const makeBidAccountInstruction = await createAccountInstruction(
      this.connection,
      admin.publicKey,
      BookSideLayout.span,
      this.programId,
    );

    const makeAskAccountInstruction = await createAccountInstruction(
      this.connection,
      admin.publicKey,
      BookSideLayout.span,
      this.programId,
    );

    const lyrVaultAccount = new Account();
    const lyrVaultAccountInstructions = await createTokenAccountInstructions(
      this.connection,
      admin.publicKey,
      lyrVaultAccount.publicKey,
      lyrMintPk,
      lyraeGroup.signerKey,
    );

    const instruction = await makeAddPerpMarketInstruction(
      this.programId,
      lyraeGroup.publicKey,
      oraclePk,
      makePerpMarketAccountInstruction.account.publicKey,
      makeEventQueueAccountInstruction.account.publicKey,
      makeBidAccountInstruction.account.publicKey,
      makeAskAccountInstruction.account.publicKey,
      lyrVaultAccount.publicKey,
      admin.publicKey,
      I80F48.fromNumber(maintLeverage),
      I80F48.fromNumber(initLeverage),
      I80F48.fromNumber(liquidationFee),
      I80F48.fromNumber(makerFee),
      I80F48.fromNumber(takerFee),
      new BN(baseLotSize),
      new BN(quoteLotSize),
      I80F48.fromNumber(rate),
      I80F48.fromNumber(maxDepthBps),
      new BN(targetPeriodLength),
      new BN(lyrPerPeriod),
      new BN(exp),
    );

    const createLyrVaultTransaction = new Transaction();
    createLyrVaultTransaction.add(...lyrVaultAccountInstructions);
    await this.sendTransaction(createLyrVaultTransaction, admin, [
      lyrVaultAccount,
    ]);

    const transaction = new Transaction();
    transaction.add(makePerpMarketAccountInstruction.instruction);
    transaction.add(makeEventQueueAccountInstruction.instruction);
    transaction.add(makeBidAccountInstruction.instruction);
    transaction.add(makeAskAccountInstruction.instruction);
    transaction.add(instruction);

    const additionalSigners = [
      makePerpMarketAccountInstruction.account,
      makeEventQueueAccountInstruction.account,
      makeBidAccountInstruction.account,
      makeAskAccountInstruction.account,
    ];

    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  async createPerpMarket(
    lyraeGroup: LyraeGroup,
    oraclePk: PublicKey,
    lyrMintPk: PublicKey,
    admin: Account | Keypair,
    maintLeverage: number,
    initLeverage: number,
    liquidationFee: number,
    makerFee: number,
    takerFee: number,
    baseLotSize: number,
    quoteLotSize: number,
    maxNumEvents: number,
    rate: number, // liquidity mining params; set rate == 0 if no liq mining
    maxDepthBps: number,
    targetPeriodLength: number,
    lyrPerPeriod: number,
    exp: number,
    version: number,
    lmSizeShift: number,
    baseDecimals: number,
  ) {
    const [perpMarketPk] = await PublicKey.findProgramAddress(
      [
        lyraeGroup.publicKey.toBytes(),
        new Buffer('PerpMarket', 'utf-8'),
        oraclePk.toBytes(),
      ],
      this.programId,
    );
    const makeEventQueueAccountInstruction = await createAccountInstruction(
      this.connection,
      admin.publicKey,
      PerpEventQueueHeaderLayout.span + maxNumEvents * PerpEventLayout.span,
      this.programId,
    );

    const makeBidAccountInstruction = await createAccountInstruction(
      this.connection,
      admin.publicKey,
      BookSideLayout.span,
      this.programId,
    );

    const makeAskAccountInstruction = await createAccountInstruction(
      this.connection,
      admin.publicKey,
      BookSideLayout.span,
      this.programId,
    );

    const [lyrVaultPk] = await PublicKey.findProgramAddress(
      [
        perpMarketPk.toBytes(),
        TOKEN_PROGRAM_ID.toBytes(),
        lyrMintPk.toBytes(),
      ],
      this.programId,
    );
    const instruction = await makeCreatePerpMarketInstruction(
      this.programId,
      lyraeGroup.publicKey,
      oraclePk,
      perpMarketPk,
      makeEventQueueAccountInstruction.account.publicKey,
      makeBidAccountInstruction.account.publicKey,
      makeAskAccountInstruction.account.publicKey,
      lyrMintPk,
      lyrVaultPk,
      admin.publicKey,
      lyraeGroup.signerKey,
      I80F48.fromNumber(maintLeverage),
      I80F48.fromNumber(initLeverage),
      I80F48.fromNumber(liquidationFee),
      I80F48.fromNumber(makerFee),
      I80F48.fromNumber(takerFee),
      new BN(baseLotSize),
      new BN(quoteLotSize),
      I80F48.fromNumber(rate),
      I80F48.fromNumber(maxDepthBps),
      new BN(targetPeriodLength),
      new BN(lyrPerPeriod),
      new BN(exp),
      new BN(version),
      new BN(lmSizeShift),
      new BN(baseDecimals),
    );

    const transaction = new Transaction();
    transaction.add(makeEventQueueAccountInstruction.instruction);
    transaction.add(makeBidAccountInstruction.instruction);
    transaction.add(makeAskAccountInstruction.instruction);
    transaction.add(instruction);

    const additionalSigners = [
      makeEventQueueAccountInstruction.account,
      makeBidAccountInstruction.account,
      makeAskAccountInstruction.account,
    ];

    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  // Liquidator Functions
  async forceCancelSpotOrders(
    lyraeGroup: LyraeGroup,
    liqeeLyraeAccount: LyraeAccount,
    spotMarket: Market,
    baseRootBank: RootBank,
    quoteRootBank: RootBank,
    payer: Account,
    limit: BN,
  ) {
    const baseNodeBanks = await baseRootBank.loadNodeBanks(this.connection);
    const quoteNodeBanks = await quoteRootBank.loadNodeBanks(this.connection);

    const openOrdersKeys: { pubkey: PublicKey; isWritable: boolean }[] = [];
    const spotMarketIndex = lyraeGroup.getSpotMarketIndex(spotMarket.publicKey);
    // Only pass in open orders if in margin basket or current market index, and
    // the only writable account should be OpenOrders for current market index
    for (let i = 0; i < liqeeLyraeAccount.spotOpenOrders.length; i++) {
      let pubkey = zeroKey;
      let isWritable = false;

      if (i === spotMarketIndex) {
        isWritable = true;

        if (liqeeLyraeAccount.spotOpenOrders[spotMarketIndex].equals(zeroKey)) {
          console.log('missing oo for ', spotMarketIndex);
          // open orders missing for this market; create a new one now
          // const openOrdersSpace = OpenOrders.getLayout(
          //   lyraeGroup.dexProgramId,
          // ).span;
          // const openOrdersLamports =
          //   await this.connection.getMinimumBalanceForRentExemption(
          //     openOrdersSpace,
          //     'singleGossip',
          //   );
          // const accInstr = await createAccountInstruction(
          //   this.connection,
          //   owner.publicKey,
          //   openOrdersSpace,
          //   lyraeGroup.dexProgramId,
          //   openOrdersLamports,
          // );

          // transaction.add(accInstr.instruction);
          // additionalSigners.push(accInstr.account);
          // pubkey = accInstr.account.publicKey;
        } else {
          pubkey = liqeeLyraeAccount.spotOpenOrders[i];
        }
      } else if (liqeeLyraeAccount.inMarginBasket[i]) {
        pubkey = liqeeLyraeAccount.spotOpenOrders[i];
      }

      openOrdersKeys.push({ pubkey, isWritable });
    }

    const dexSigner = await PublicKey.createProgramAddress(
      [
        spotMarket.publicKey.toBuffer(),
        spotMarket['_decoded'].vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
      ],
      spotMarket.programId,
    );

    const instruction = makeForceCancelSpotOrdersInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeGroup.lyraeCache,
      liqeeLyraeAccount.publicKey,
      baseRootBank.publicKey,
      baseNodeBanks[0].publicKey,
      baseNodeBanks[0].vault,
      quoteRootBank.publicKey,
      quoteNodeBanks[0].publicKey,
      quoteNodeBanks[0].vault,
      spotMarket.publicKey,
      spotMarket.bidsAddress,
      spotMarket.asksAddress,
      lyraeGroup.signerKey,
      spotMarket['_decoded'].eventQueue,
      spotMarket['_decoded'].baseVault,
      spotMarket['_decoded'].quoteVault,
      dexSigner,
      lyraeGroup.dexProgramId,
      openOrdersKeys,
      limit,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  /**
   * Send multiple instructions to cancel all perp orders in this market
   */
  async forceCancelAllPerpOrdersInMarket(
    lyraeGroup: LyraeGroup,
    liqee: LyraeAccount,
    perpMarket: PerpMarket,
    payer: Account | WalletAdapter,
    limitPerInstruction: number,
  ): Promise<TransactionSignature> {
    const transaction = new Transaction();
    const marketIndex = lyraeGroup.getPerpMarketIndex(perpMarket.publicKey);
    const instruction = makeForceCancelPerpOrdersInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeGroup.lyraeCache,
      perpMarket.publicKey,
      perpMarket.bids,
      perpMarket.asks,
      liqee.publicKey,
      liqee.spotOpenOrders,
      new BN(limitPerInstruction),
    );
    transaction.add(instruction);

    let orderCount = 0;
    for (let i = 0; i < liqee.orderMarket.length; i++) {
      if (liqee.orderMarket[i] !== marketIndex) {
        continue;
      }
      orderCount++;
      if (orderCount === limitPerInstruction) {
        orderCount = 0;
        const instruction = makeForceCancelPerpOrdersInstruction(
          this.programId,
          lyraeGroup.publicKey,
          lyraeGroup.lyraeCache,
          perpMarket.publicKey,
          perpMarket.bids,
          perpMarket.asks,
          liqee.publicKey,
          liqee.spotOpenOrders,
          new BN(limitPerInstruction),
        );
        transaction.add(instruction);

        // TODO - verify how many such instructions can go into one tx
        // right now 10 seems reasonable considering size of 800ish bytes if all spot open orders present
        if (transaction.instructions.length === 10) {
          break;
        }
      }
    }

    return await this.sendTransaction(transaction, payer, []);
  }

  async forceCancelPerpOrders(
    lyraeGroup: LyraeGroup,
    liqeeLyraeAccount: LyraeAccount,
    perpMarket: PerpMarket,
    payer: Account,
    limit: BN,
  ) {
    const instruction = makeForceCancelPerpOrdersInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeGroup.lyraeCache,
      perpMarket.publicKey,
      perpMarket.bids,
      perpMarket.asks,
      liqeeLyraeAccount.publicKey,
      liqeeLyraeAccount.spotOpenOrders,
      limit,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  async liquidateTokenAndToken(
    lyraeGroup: LyraeGroup,
    liqeeLyraeAccount: LyraeAccount,
    liqorLyraeAccount: LyraeAccount,
    assetRootBank: RootBank,
    liabRootBank: RootBank,
    payer: Account,
    maxLiabTransfer: I80F48,
  ) {
    const instruction = makeLiquidateTokenAndTokenInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeGroup.lyraeCache,
      liqeeLyraeAccount.publicKey,
      liqorLyraeAccount.publicKey,
      payer.publicKey,
      assetRootBank.publicKey,
      assetRootBank.nodeBanks[0],
      liabRootBank.publicKey,
      liabRootBank.nodeBanks[0],
      liqeeLyraeAccount.spotOpenOrders,
      liqorLyraeAccount.spotOpenOrders,
      maxLiabTransfer,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  async liquidateTokenAndPerp(
    lyraeGroup: LyraeGroup,
    liqeeLyraeAccount: LyraeAccount,
    liqorLyraeAccount: LyraeAccount,
    rootBank: RootBank,
    payer: Account,
    assetType: AssetType,
    assetIndex: number,
    liabType: AssetType,
    liabIndex: number,
    maxLiabTransfer: I80F48,
  ) {
    const instruction = makeLiquidateTokenAndPerpInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeGroup.lyraeCache,
      liqeeLyraeAccount.publicKey,
      liqorLyraeAccount.publicKey,
      payer.publicKey,
      rootBank.publicKey,
      rootBank.nodeBanks[0],
      liqeeLyraeAccount.spotOpenOrders,
      liqorLyraeAccount.spotOpenOrders,
      assetType,
      new BN(assetIndex),
      liabType,
      new BN(liabIndex),
      maxLiabTransfer,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  async liquidatePerpMarket(
    lyraeGroup: LyraeGroup,
    liqeeLyraeAccount: LyraeAccount,
    liqorLyraeAccount: LyraeAccount,
    perpMarket: PerpMarket,
    payer: Account,
    baseTransferRequest: BN,
  ) {
    const instruction = makeLiquidatePerpMarketInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeGroup.lyraeCache,
      perpMarket.publicKey,
      perpMarket.eventQueue,
      liqeeLyraeAccount.publicKey,
      liqorLyraeAccount.publicKey,
      payer.publicKey,
      liqeeLyraeAccount.spotOpenOrders,
      liqorLyraeAccount.spotOpenOrders,
      baseTransferRequest,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  async settleFees(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    perpMarket: PerpMarket,
    rootBank: RootBank,
    payer: Account,
  ) {
    const nodeBanks = await rootBank.loadNodeBanks(this.connection);

    const instruction = makeSettleFeesInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeGroup.lyraeCache,
      perpMarket.publicKey,
      lyraeAccount.publicKey,
      rootBank.publicKey,
      nodeBanks[0].publicKey,
      nodeBanks[0].vault,
      lyraeGroup.feesVault,
      lyraeGroup.signerKey,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  async resolvePerpBankruptcy(
    lyraeGroup: LyraeGroup,
    liqeeLyraeAccount: LyraeAccount,
    liqorLyraeAccount: LyraeAccount,
    perpMarket: PerpMarket,
    rootBank: RootBank,
    payer: Account,
    liabIndex: number,
    maxLiabTransfer: I80F48,
  ) {
    const nodeBanks = await rootBank.loadNodeBanks(this.connection);
    const instruction = makeResolvePerpBankruptcyInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeGroup.lyraeCache,
      liqeeLyraeAccount.publicKey,
      liqorLyraeAccount.publicKey,
      payer.publicKey,
      rootBank.publicKey,
      nodeBanks[0].publicKey,
      nodeBanks[0].vault,
      lyraeGroup.insuranceVault,
      lyraeGroup.signerKey,
      perpMarket.publicKey,
      liqorLyraeAccount.spotOpenOrders,
      new BN(liabIndex),
      maxLiabTransfer,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  async resolveTokenBankruptcy(
    lyraeGroup: LyraeGroup,
    liqeeLyraeAccount: LyraeAccount,
    liqorLyraeAccount: LyraeAccount,
    quoteRootBank: RootBank,
    liabRootBank: RootBank,
    payer: Account,
    maxLiabTransfer: I80F48,
  ) {
    const quoteNodeBanks = await quoteRootBank.loadNodeBanks(this.connection);
    const instruction = makeResolveTokenBankruptcyInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeGroup.lyraeCache,
      liqeeLyraeAccount.publicKey,
      liqorLyraeAccount.publicKey,
      payer.publicKey,
      quoteRootBank.publicKey,
      quoteRootBank.nodeBanks[0],
      quoteNodeBanks[0].vault,
      lyraeGroup.insuranceVault,
      lyraeGroup.signerKey,
      liabRootBank.publicKey,
      liabRootBank.nodeBanks[0],
      liqorLyraeAccount.spotOpenOrders,
      liabRootBank.nodeBanks,
      maxLiabTransfer,
    );

    const transaction = new Transaction();
    transaction.add(instruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  async redeemLyr(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    perpMarket: PerpMarket,
    payer: Account | WalletAdapter,
    lyrRootBank: PublicKey,
    lyrNodeBank: PublicKey,
    lyrVault: PublicKey,
  ): Promise<TransactionSignature> {
    const instruction = makeRedeemLyrInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeGroup.lyraeCache,
      lyraeAccount.publicKey,
      payer.publicKey,
      perpMarket.publicKey,
      perpMarket.lyrVault,
      lyrRootBank,
      lyrNodeBank,
      lyrVault,
      lyraeGroup.signerKey,
    );
    const transaction = new Transaction();
    transaction.add(instruction);

    return await this.sendTransaction(transaction, payer, []);
  }

  async redeemAllLyr(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    payer: Account | WalletAdapter,
    lyrRootBank: PublicKey,
    lyrNodeBank: PublicKey,
    lyrVault: PublicKey,
  ): Promise<TransactionSignature> {
    const transactions: Transaction[] = [];
    let transaction = new Transaction();

    const perpMarkets = await Promise.all(
      lyraeAccount.perpAccounts.map((perpAccount, i) => {
        if (perpAccount.lyrAccrued.eq(ZERO_BN)) {
          return promiseUndef();
        } else {
          return this.getPerpMarket(
            lyraeGroup.perpMarkets[i].perpMarket,
            lyraeGroup.tokens[i].decimals,
            lyraeGroup.tokens[QUOTE_INDEX].decimals,
          );
        }
      }),
    );

    for (let i = 0; i < lyraeAccount.perpAccounts.length; i++) {
      const perpMarket = perpMarkets[i];
      if (perpMarket === undefined) continue;

      const instruction = makeRedeemLyrInstruction(
        this.programId,
        lyraeGroup.publicKey,
        lyraeGroup.lyraeCache,
        lyraeAccount.publicKey,
        payer.publicKey,
        perpMarket.publicKey,
        perpMarket.lyrVault,
        lyrRootBank,
        lyrNodeBank,
        lyrVault,
        lyraeGroup.signerKey,
      );
      transaction.add(instruction);
      if (transaction.instructions.length === 9) {
        transactions.push(transaction);
        transaction = new Transaction();
      }
    }
    if (transaction.instructions.length > 0) {
      transactions.push(transaction);

      // txProms.push(this.sendTransaction(transaction, payer, []));
    }

    const transactionsAndSigners = transactions.map((tx) => ({
      transaction: tx,
      signers: [],
    }));

    if (transactionsAndSigners.length === 0) {
      throw new Error('No LYR rewards to redeem');
    }

    // Sign multiple transactions at once for better UX
    const signedTransactions = await this.signTransactions({
      transactionsAndSigners,
      payer,
    });

    if (signedTransactions) {
      const txSigs = await Promise.all(
        signedTransactions.map((signedTransaction) =>
          this.sendSignedTransaction({ signedTransaction }),
        ),
      );
      return txSigs[0];
    } else {
      throw new Error('Unable to sign all RedeemLyr transactions');
    }
  }

  async addLyraeAccountInfo(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    owner: Account | WalletAdapter,
    info: string,
  ): Promise<TransactionSignature> {
    const instruction = makeAddLyraeAccountInfoInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccount.publicKey,
      owner.publicKey,
      info,
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  async depositMsrm(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    owner: Account | WalletAdapter,
    msrmAccount: PublicKey,
    quantity: number,
  ): Promise<TransactionSignature> {
    const instruction = makeDepositMsrmInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccount.publicKey,
      owner.publicKey,
      msrmAccount,
      lyraeGroup.msrmVault,
      new BN(Math.floor(quantity)),
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }
  async withdrawMsrm(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    owner: Account | WalletAdapter,
    msrmAccount: PublicKey,
    quantity: number,
  ): Promise<TransactionSignature> {
    const instruction = makeWithdrawMsrmInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccount.publicKey,
      owner.publicKey,
      msrmAccount,
      lyraeGroup.msrmVault,
      lyraeGroup.signerKey,
      new BN(Math.floor(quantity)),
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  async changePerpMarketParams(
    lyraeGroup: LyraeGroup,
    perpMarket: PerpMarket,
    admin: Account | WalletAdapter,

    maintLeverage: number | undefined,
    initLeverage: number | undefined,
    liquidationFee: number | undefined,
    makerFee: number | undefined,
    takerFee: number | undefined,
    rate: number | undefined,
    maxDepthBps: number | undefined,
    targetPeriodLength: number | undefined,
    lyrPerPeriod: number | undefined,
    exp: number | undefined,
  ): Promise<TransactionSignature> {
    const instruction = makeChangePerpMarketParamsInstruction(
      this.programId,
      lyraeGroup.publicKey,
      perpMarket.publicKey,
      admin.publicKey,
      I80F48.fromNumberOrUndef(maintLeverage),
      I80F48.fromNumberOrUndef(initLeverage),
      I80F48.fromNumberOrUndef(liquidationFee),
      I80F48.fromNumberOrUndef(makerFee),
      I80F48.fromNumberOrUndef(takerFee),
      I80F48.fromNumberOrUndef(rate),
      I80F48.fromNumberOrUndef(maxDepthBps),
      targetPeriodLength !== undefined ? new BN(targetPeriodLength) : undefined,
      lyrPerPeriod !== undefined ? new BN(lyrPerPeriod) : undefined,
      exp !== undefined ? new BN(exp) : undefined,
    );

    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];

    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  async changePerpMarketParams2(
    lyraeGroup: LyraeGroup,
    perpMarket: PerpMarket,
    admin: Account | WalletAdapter,

    maintLeverage: number | undefined,
    initLeverage: number | undefined,
    liquidationFee: number | undefined,
    makerFee: number | undefined,
    takerFee: number | undefined,
    rate: number | undefined,
    maxDepthBps: number | undefined,
    targetPeriodLength: number | undefined,
    lyrPerPeriod: number | undefined,
    exp: number | undefined,
    version: number | undefined,
    lmSizeShift: number | undefined,
  ): Promise<TransactionSignature> {
    const instruction = makeChangePerpMarketParams2Instruction(
      this.programId,
      lyraeGroup.publicKey,
      perpMarket.publicKey,
      admin.publicKey,
      I80F48.fromNumberOrUndef(maintLeverage),
      I80F48.fromNumberOrUndef(initLeverage),
      I80F48.fromNumberOrUndef(liquidationFee),
      I80F48.fromNumberOrUndef(makerFee),
      I80F48.fromNumberOrUndef(takerFee),
      I80F48.fromNumberOrUndef(rate),
      I80F48.fromNumberOrUndef(maxDepthBps),
      targetPeriodLength !== undefined ? new BN(targetPeriodLength) : undefined,
      lyrPerPeriod !== undefined ? new BN(lyrPerPeriod) : undefined,
      exp !== undefined ? new BN(exp) : undefined,
      version !== undefined ? new BN(version) : undefined,
      lmSizeShift !== undefined ? new BN(lmSizeShift) : undefined,
    );

    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];

    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  async setGroupAdmin(
    lyraeGroup: LyraeGroup,
    newAdmin: PublicKey,
    admin: Account | WalletAdapter,
  ): Promise<TransactionSignature> {
    const instruction = makeSetGroupAdminInstruction(
      this.programId,
      lyraeGroup.publicKey,
      newAdmin,
      admin.publicKey,
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, admin, additionalSigners);
  }

  /**
   * Add allowance for orders to be cancelled and replaced in a single transaction
   */
  async modifySpotOrder(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    lyraeCache: PublicKey,
    spotMarket: Market,
    owner: Account | WalletAdapter,
    order: Order,

    side: 'buy' | 'sell',
    price: number,
    size: number,
    orderType?: 'limit' | 'ioc' | 'postOnly',
  ): Promise<TransactionSignature> {
    const transaction = new Transaction();

    const instruction = makeCancelSpotOrderInstruction(
      this.programId,
      lyraeGroup.publicKey,
      owner.publicKey,
      lyraeAccount.publicKey,
      spotMarket.programId,
      spotMarket.publicKey,
      spotMarket['_decoded'].bids,
      spotMarket['_decoded'].asks,
      order.openOrdersAddress,
      lyraeGroup.signerKey,
      spotMarket['_decoded'].eventQueue,
      order,
    );
    transaction.add(instruction);

    const dexSigner = await PublicKey.createProgramAddress(
      [
        spotMarket.publicKey.toBuffer(),
        spotMarket['_decoded'].vaultSignerNonce.toArrayLike(Buffer, 'le', 8),
      ],
      spotMarket.programId,
    );

    const spotMarketIndex = lyraeGroup.getSpotMarketIndex(spotMarket.publicKey);
    if (!lyraeGroup.rootBankAccounts.length) {
      await lyraeGroup.loadRootBanks(this.connection);
    }
    const baseRootBank = lyraeGroup.rootBankAccounts[spotMarketIndex];
    const baseNodeBank = baseRootBank?.nodeBankAccounts[0];
    const quoteRootBank = lyraeGroup.rootBankAccounts[QUOTE_INDEX];
    const quoteNodeBank = quoteRootBank?.nodeBankAccounts[0];

    if (!baseNodeBank || !quoteNodeBank) {
      throw new Error('Invalid or missing node banks');
    }
    const settleFundsInstruction = makeSettleFundsInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeGroup.lyraeCache,
      owner.publicKey,
      lyraeAccount.publicKey,
      spotMarket.programId,
      spotMarket.publicKey,
      lyraeAccount.spotOpenOrders[spotMarketIndex],
      lyraeGroup.signerKey,
      spotMarket['_decoded'].baseVault,
      spotMarket['_decoded'].quoteVault,
      lyraeGroup.tokens[spotMarketIndex].rootBank,
      baseNodeBank.publicKey,
      lyraeGroup.tokens[QUOTE_INDEX].rootBank,
      quoteNodeBank.publicKey,
      baseNodeBank.vault,
      quoteNodeBank.vault,
      dexSigner,
    );
    transaction.add(settleFundsInstruction);

    const additionalSigners: Account[] = [];

    const limitPrice = spotMarket.priceNumberToLots(price);
    const maxBaseQuantity = spotMarket.baseSizeNumberToLots(size);

    // TODO implement srm vault fee discount
    // const feeTier = getFeeTier(0, nativeToUi(lyraeGroup.nativeSrm || 0, SRM_DECIMALS));
    const feeTier = getFeeTier(0, nativeToUi(0, 0));
    const rates = getFeeRates(feeTier);
    const maxQuoteQuantity = new BN(
      spotMarket['_decoded'].quoteLotSize.toNumber() * (1 + rates.taker),
    ).mul(
      spotMarket
        .baseSizeNumberToLots(size)
        .mul(spotMarket.priceNumberToLots(price)),
    );

    // Checks already completed as only price modified
    if (maxBaseQuantity.lte(ZERO_BN)) {
      throw new Error('size too small');
    }
    if (limitPrice.lte(ZERO_BN)) {
      throw new Error('invalid price');
    }
    const selfTradeBehavior = 'decrementTake';

    if (!baseRootBank || !baseNodeBank || !quoteRootBank || !quoteNodeBank) {
      throw new Error('Invalid or missing banks');
    }

    const openOrdersKeys: { pubkey: PublicKey; isWritable: boolean }[] = [];

    // Only pass in open orders if in margin basket or current market index, and
    // the only writable account should be OpenOrders for current market index
    for (let i = 0; i < lyraeAccount.spotOpenOrders.length; i++) {
      let pubkey = zeroKey;
      let isWritable = false;

      if (i === spotMarketIndex) {
        isWritable = true;

        if (lyraeAccount.spotOpenOrders[spotMarketIndex].equals(zeroKey)) {
          // open orders missing for this market; create a new one now
          const openOrdersSpace = OpenOrders.getLayout(
            lyraeGroup.dexProgramId,
          ).span;

          const openOrdersLamports =
            await this.connection.getMinimumBalanceForRentExemption(
              openOrdersSpace,
              'processed',
            );

          const accInstr = await createAccountInstruction(
            this.connection,
            owner.publicKey,
            openOrdersSpace,
            lyraeGroup.dexProgramId,
            openOrdersLamports,
          );

          const initOpenOrders = makeInitSpotOpenOrdersInstruction(
            this.programId,
            lyraeGroup.publicKey,
            lyraeAccount.publicKey,
            owner.publicKey,
            lyraeGroup.dexProgramId,
            accInstr.account.publicKey,
            spotMarket.publicKey,
            lyraeGroup.signerKey,
          );

          const initTx = new Transaction();

          initTx.add(accInstr.instruction);
          initTx.add(initOpenOrders);

          await this.sendTransaction(initTx, owner, [accInstr.account]);

          pubkey = accInstr.account.publicKey;
        } else {
          pubkey = lyraeAccount.spotOpenOrders[i];
        }
      } else if (lyraeAccount.inMarginBasket[i]) {
        pubkey = lyraeAccount.spotOpenOrders[i];
      }

      openOrdersKeys.push({ pubkey, isWritable });
    }

    const placeOrderInstruction = makePlaceSpotOrderInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccount.publicKey,
      owner.publicKey,
      lyraeCache,
      spotMarket.programId,
      spotMarket.publicKey,
      spotMarket['_decoded'].bids,
      spotMarket['_decoded'].asks,
      spotMarket['_decoded'].requestQueue,
      spotMarket['_decoded'].eventQueue,
      spotMarket['_decoded'].baseVault,
      spotMarket['_decoded'].quoteVault,
      baseRootBank.publicKey,
      baseNodeBank.publicKey,
      baseNodeBank.vault,
      quoteRootBank.publicKey,
      quoteNodeBank.publicKey,
      quoteNodeBank.vault,
      lyraeGroup.signerKey,
      dexSigner,
      lyraeGroup.srmVault, // TODO: choose msrm vault if it has any deposits
      openOrdersKeys,
      side,
      limitPrice,
      maxBaseQuantity,
      maxQuoteQuantity,
      selfTradeBehavior,
      orderType,
      order.clientId,
    );
    transaction.add(placeOrderInstruction);

    if (spotMarketIndex > 0) {
      console.log(
        spotMarketIndex - 1,
        lyraeAccount.spotOpenOrders[spotMarketIndex - 1].toBase58(),
        openOrdersKeys[spotMarketIndex - 1].pubkey.toBase58(),
      );
    }
    const txid = await this.sendTransaction(
      transaction,
      owner,
      additionalSigners,
    );

    // update LyraeAccount to have new OpenOrders pubkey
    lyraeAccount.spotOpenOrders[spotMarketIndex] =
      openOrdersKeys[spotMarketIndex].pubkey;
    lyraeAccount.inMarginBasket[spotMarketIndex] = true;
    console.log(
      spotMarketIndex,
      lyraeAccount.spotOpenOrders[spotMarketIndex].toBase58(),
      openOrdersKeys[spotMarketIndex].pubkey.toBase58(),
    );

    return txid;
  }

  async modifyPerpOrder(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    lyraeCache: PublicKey,
    perpMarket: PerpMarket,
    owner: Account | WalletAdapter,
    order: PerpOrder,

    side: 'buy' | 'sell',
    price: number,
    quantity: number,
    orderType?: PerpOrderType,
    clientOrderId?: number,
    bookSideInfo?: AccountInfo<Buffer>, // ask if side === bid, bids if side === ask; if this is given; crank instruction is added
    invalidIdOk = false, // Don't throw error if order is invalid
  ): Promise<TransactionSignature> {
    const transaction = new Transaction();
    const additionalSigners: Account[] = [];

    const cancelInstruction = makeCancelPerpOrderInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccount.publicKey,
      owner.publicKey,
      perpMarket.publicKey,
      perpMarket.bids,
      perpMarket.asks,
      order,
      invalidIdOk,
    );

    transaction.add(cancelInstruction);

    const [nativePrice, nativeQuantity] = perpMarket.uiToNativePriceQuantity(
      price,
      quantity,
    );

    const placeInstruction = makePlacePerpOrderInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccount.publicKey,
      owner.publicKey,
      lyraeCache,
      perpMarket.publicKey,
      perpMarket.bids,
      perpMarket.asks,
      perpMarket.eventQueue,
      lyraeAccount.spotOpenOrders,
      nativePrice,
      nativeQuantity,
      clientOrderId
        ? new BN(clientOrderId)
        : order.clientId ?? new BN(Date.now()),
      side,
      orderType,
    );
    transaction.add(placeInstruction);

    if (bookSideInfo) {
      const bookSide = bookSideInfo.data
        ? new BookSide(
          side === 'buy' ? perpMarket.asks : perpMarket.bids,
          perpMarket,
          BookSideLayout.decode(bookSideInfo.data),
        )
        : [];
      const accounts: Set<string> = new Set();
      accounts.add(lyraeAccount.publicKey.toBase58());

      for (const order of bookSide) {
        accounts.add(order.owner.toBase58());
        if (accounts.size >= 10) {
          break;
        }
      }

      const consumeInstruction = makeConsumeEventsInstruction(
        this.programId,
        lyraeGroup.publicKey,
        lyraeGroup.lyraeCache,
        perpMarket.publicKey,
        perpMarket.eventQueue,
        Array.from(accounts)
          .map((s) => new PublicKey(s))
          .sort(),
        new BN(4),
      );
      transaction.add(consumeInstruction);
    }

    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  async addPerpTriggerOrder(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    perpMarket: PerpMarket,
    owner: Account | WalletAdapter,
    orderType: PerpOrderType,
    side: 'buy' | 'sell',
    price: number,
    quantity: number,
    triggerCondition: 'above' | 'below',
    triggerPrice: number,
    reduceOnly: boolean,
    clientOrderId?: number,
  ): Promise<TransactionSignature> {
    const transaction = new Transaction();
    const additionalSigners: Account[] = [];

    let advancedOrders: PublicKey = lyraeAccount.advancedOrdersKey;
    if (lyraeAccount.advancedOrdersKey.equals(zeroKey)) {
      [advancedOrders] = await PublicKey.findProgramAddress(
        [lyraeAccount.publicKey.toBytes()],
        this.programId,
      );

      console.log('AdvancedOrders PDA:', advancedOrders.toBase58());

      transaction.add(
        makeInitAdvancedOrdersInstruction(
          this.programId,
          lyraeGroup.publicKey,
          lyraeAccount.publicKey,
          owner.publicKey,
          advancedOrders,
        ),
      );
    }

    const marketIndex = lyraeGroup.getPerpMarketIndex(perpMarket.publicKey);

    const baseTokenInfo = lyraeGroup.tokens[marketIndex];
    const quoteTokenInfo = lyraeGroup.tokens[QUOTE_INDEX];
    const baseUnit = Math.pow(10, baseTokenInfo.decimals);
    const quoteUnit = Math.pow(10, quoteTokenInfo.decimals);

    const nativePrice = new BN(price * quoteUnit)
      .mul(perpMarket.baseLotSize)
      .div(perpMarket.quoteLotSize.mul(new BN(baseUnit)));
    const nativeQuantity = new BN(quantity * baseUnit).div(
      perpMarket.baseLotSize,
    );

    const nativeTriggerPrice = I80F48.fromNumber(
      triggerPrice *
      Math.pow(10, perpMarket.quoteDecimals - perpMarket.baseDecimals),
    );
    const openOrders = lyraeAccount.spotOpenOrders.filter(
      (pk, i) => lyraeAccount.inMarginBasket[i],
    );

    transaction.add(
      makeAddPerpTriggerOrderInstruction(
        this.programId,
        lyraeGroup.publicKey,
        lyraeAccount.publicKey,
        owner.publicKey,
        advancedOrders,
        lyraeGroup.lyraeCache,
        perpMarket.publicKey,
        openOrders,
        orderType,
        side,
        nativePrice,
        nativeQuantity,
        triggerCondition,
        nativeTriggerPrice,
        reduceOnly,
        new BN(clientOrderId ?? Date.now()),
      ),
    );
    const txid = await this.sendTransaction(
      transaction,
      owner,
      additionalSigners,
    );
    lyraeAccount.advancedOrdersKey = advancedOrders;
    return txid;
  }

  async removeAdvancedOrder(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    owner: Account | WalletAdapter,
    orderIndex: number,
  ): Promise<TransactionSignature> {
    const instruction = makeRemoveAdvancedOrderInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccount.publicKey,
      owner.publicKey,
      lyraeAccount.advancedOrdersKey,
      orderIndex,
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, owner, additionalSigners);
  }

  async executePerpTriggerOrder(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    lyraeCache: LyraeCache,
    perpMarket: PerpMarket,
    payer: Account | WalletAdapter,
    orderIndex: number,
  ): Promise<TransactionSignature> {
    const openOrders = lyraeAccount.spotOpenOrders.filter(
      (pk, i) => lyraeAccount.inMarginBasket[i],
    );

    const instruction = makeExecutePerpTriggerOrderInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccount.publicKey,
      lyraeAccount.advancedOrdersKey,
      payer.publicKey,
      lyraeCache.publicKey,
      perpMarket.publicKey,
      perpMarket.bids,
      perpMarket.asks,
      perpMarket.eventQueue,
      openOrders,
      new BN(orderIndex),
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, payer, additionalSigners);
  }

  async closeAdvancedOrders(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    payer: Account | WalletAdapter,
  ): Promise<TransactionSignature> {
    const instruction = makeCloseAdvancedOrdersInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccount.publicKey,
      payer.publicKey,
      lyraeAccount.advancedOrdersKey,
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, payer, additionalSigners);
  }

  async closeSpotOpenOrders(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    payer: Account | WalletAdapter,
    marketIndex: number,
  ): Promise<TransactionSignature> {
    const instruction = makeCloseSpotOpenOrdersInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccount.publicKey,
      payer.publicKey,
      lyraeGroup.dexProgramId,
      lyraeAccount.spotOpenOrders[marketIndex],
      lyraeGroup.spotMarkets[marketIndex].spotMarket,
      lyraeGroup.signerKey,
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, payer, additionalSigners);
  }

  async closeLyraeAccount(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    payer: Account | WalletAdapter,
  ): Promise<TransactionSignature> {
    const instruction = makeCloseLyraeAccountInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccount.publicKey,
      payer.publicKey,
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, payer, additionalSigners);
  }

  async createDustAccount(
    lyraeGroup: LyraeGroup,
    payer: Account | WalletAdapter,
  ): Promise<TransactionSignature> {
    const [lyraeAccountPk] = await PublicKey.findProgramAddress(
      [lyraeGroup.publicKey.toBytes(), new Buffer('DustAccount', 'utf-8')],
      this.programId,
    );
    const instruction = makeCreateDustAccountInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccountPk,
      payer.publicKey,
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, payer, additionalSigners);
  }

  async resolveDust(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    rootBank: RootBank,
    lyraeCache: LyraeCache,
    payer: Account | WalletAdapter,
  ): Promise<TransactionSignature> {
    const [dustAccountPk] = await PublicKey.findProgramAddress(
      [lyraeGroup.publicKey.toBytes(), new Buffer('DustAccount', 'utf-8')],
      this.programId,
    );
    const instruction = makeResolveDustInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccount.publicKey,
      payer.publicKey,
      dustAccountPk,
      rootBank.publicKey,
      rootBank.nodeBanks[0],
      lyraeCache.publicKey,
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, payer, additionalSigners);
  }

  async updateMarginBasket(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    payer: Account | WalletAdapter,
  ) {
    const instruction = makeUpdateMarginBasketInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccount.publicKey,
      lyraeAccount.spotOpenOrders,
    );
    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, payer, additionalSigners);
  }

  async resolveAllDust(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    lyraeCache: LyraeCache,
    payer: Account | WalletAdapter,
  ) {
    const transactionsAndSigners: {
      transaction: Transaction;
      signers: Account[];
    }[] = [];
    const [dustAccountPk] = await PublicKey.findProgramAddress(
      [lyraeGroup.publicKey.toBytes(), new Buffer('DustAccount', 'utf-8')],
      this.programId,
    );
    for (const rootBank of lyraeGroup.rootBankAccounts) {
      const transactionAndSigners: {
        transaction: Transaction;
        signers: Account[];
      } = {
        transaction: new Transaction(),
        signers: [],
      };
      if (rootBank) {
        const tokenIndex = lyraeGroup.getRootBankIndex(rootBank?.publicKey);
        const nativeDeposit = lyraeAccount.getNativeDeposit(
          rootBank,
          tokenIndex,
        );
        const nativeBorrow = lyraeAccount.getNativeBorrow(rootBank, tokenIndex);
        console.log('nativeDeposit', nativeDeposit.toString());
        console.log('nativeBorrow', nativeBorrow.toString());
        console.log('tokenIndex', tokenIndex.toString());

        if (
          (nativeDeposit.gt(ZERO_I80F48) && nativeDeposit.lt(ONE_I80F48)) ||
          (nativeBorrow.gt(ZERO_I80F48) && nativeBorrow.lt(ONE_I80F48))
        ) {
          const instruction = makeResolveDustInstruction(
            this.programId,
            lyraeGroup.publicKey,
            lyraeAccount.publicKey,
            payer.publicKey,
            dustAccountPk,
            rootBank.publicKey,
            rootBank.nodeBanks[0],
            lyraeCache.publicKey,
          );
          transactionAndSigners.transaction.add(instruction);
        }
      }
      transactionsAndSigners.push(transactionAndSigners);
    }

    const signedTransactions = await this.signTransactions({
      transactionsAndSigners,
      payer: payer,
    });

    if (signedTransactions) {
      for (const signedTransaction of signedTransactions) {
        if (signedTransaction.instructions.length == 0) {
          continue;
        }
        const txid = await this.sendSignedTransaction({
          signedTransaction,
        });
        console.log(txid);
      }
    } else {
      throw new Error('Unable to sign ResolveDust transactions');
    }
  }

  async emptyAndCloseLyraeAccount(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    lyraeCache: LyraeCache,
    lyrIndex: number,
    payer: Account | WalletAdapter,
  ): Promise<TransactionSignature[]> {
    const transactionsAndSigners: {
      transaction: Transaction;
      signers: Account[];
    }[] = [];

    const redeemLyrTransaction = {
      transaction: new Transaction(),
      signers: [],
    };
    const lyrRootBank = lyraeGroup.rootBankAccounts[lyrIndex] as RootBank;
    const perpMarkets = await Promise.all(
      lyraeAccount.perpAccounts.map((perpAccount, i) => {
        if (perpAccount.lyrAccrued.eq(ZERO_BN)) {
          return promiseUndef();
        } else {
          return this.getPerpMarket(
            lyraeGroup.perpMarkets[i].perpMarket,
            lyraeGroup.tokens[i].decimals,
            lyraeGroup.tokens[QUOTE_INDEX].decimals,
          );
        }
      }),
    );

    let redeemedLyr = false;
    for (let i = 0; i < lyraeAccount.perpAccounts.length; i++) {
      const perpAccount = lyraeAccount.perpAccounts[i];
      if (perpAccount.lyrAccrued.eq(ZERO_BN)) {
        continue;
      }
      redeemedLyr = true;
      const perpMarket = perpMarkets[i];
      // this is actually an error state; Means there is lyr accrued but PerpMarket doesn't exist
      if (perpMarket === undefined) continue;

      const instruction = makeRedeemLyrInstruction(
        this.programId,
        lyraeGroup.publicKey,
        lyraeGroup.lyraeCache,
        lyraeAccount.publicKey,
        payer.publicKey,
        perpMarket.publicKey,
        perpMarket.lyrVault,
        lyrRootBank.publicKey,
        lyrRootBank.nodeBanks[0],
        lyrRootBank.nodeBankAccounts[0].vault,
        lyraeGroup.signerKey,
      );
      redeemLyrTransaction.transaction.add(instruction);
    }
    transactionsAndSigners.push(redeemLyrTransaction);

    const resolveAllDustTransaction = {
      transaction: new Transaction(),
      signers: [],
    };
    const [dustAccountPk] = await PublicKey.findProgramAddress(
      [lyraeGroup.publicKey.toBytes(), new Buffer('DustAccount', 'utf-8')],
      this.programId,
    );

    for (const rootBank of lyraeGroup.rootBankAccounts) {
      if (rootBank) {
        const tokenIndex = lyraeGroup.getRootBankIndex(rootBank?.publicKey);
        const tokenMint = lyraeGroup.tokens[tokenIndex].mint;
        const shouldWithdrawLyr = redeemedLyr && tokenIndex === lyrIndex;

        if (lyraeAccount.deposits[tokenIndex].isPos() || shouldWithdrawLyr) {
          const withdrawTransaction: {
            transaction: Transaction;
            signers: Account[];
          } = {
            transaction: new Transaction(),
            signers: [],
          };
          let tokenAcc = await Token.getAssociatedTokenAddress(
            ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            tokenMint,
            payer.publicKey,
          );

          let wrappedSolAccount: Account | null = null;
          if (tokenMint.equals(WRAPPED_SOL_MINT)) {
            wrappedSolAccount = new Account();
            tokenAcc = wrappedSolAccount.publicKey;
            const space = 165;
            const lamports =
              await this.connection.getMinimumBalanceForRentExemption(
                space,
                'processed',
              );
            withdrawTransaction.transaction.add(
              SystemProgram.createAccount({
                fromPubkey: payer.publicKey,
                newAccountPubkey: tokenAcc,
                lamports,
                space,
                programId: TOKEN_PROGRAM_ID,
              }),
            );
            withdrawTransaction.transaction.add(
              initializeAccount({
                account: tokenAcc,
                mint: WRAPPED_SOL_MINT,
                owner: payer.publicKey,
              }),
            );
            withdrawTransaction.signers.push(wrappedSolAccount);
          } else {
            const tokenAccExists = await this.connection.getAccountInfo(
              tokenAcc,
              'processed',
            );
            if (!tokenAccExists) {
              withdrawTransaction.transaction.add(
                Token.createAssociatedTokenAccountInstruction(
                  ASSOCIATED_TOKEN_PROGRAM_ID,
                  TOKEN_PROGRAM_ID,
                  tokenMint,
                  tokenAcc,
                  payer.publicKey,
                  payer.publicKey,
                ),
              );
            }
          }

          const instruction = makeWithdrawInstruction(
            this.programId,
            lyraeGroup.publicKey,
            lyraeAccount.publicKey,
            payer.publicKey,
            lyraeGroup.lyraeCache,
            rootBank.publicKey,
            rootBank.nodeBanks[0],
            rootBank.nodeBankAccounts[0].vault,
            tokenAcc,
            lyraeGroup.signerKey,
            lyraeAccount.spotOpenOrders,
            U64_MAX_BN,
            false,
          );
          withdrawTransaction.transaction.add(instruction);

          if (wrappedSolAccount) {
            withdrawTransaction.transaction.add(
              closeAccount({
                source: wrappedSolAccount.publicKey,
                destination: payer.publicKey,
                owner: payer.publicKey,
              }),
            );
          }
          transactionsAndSigners.push(withdrawTransaction);
        }

        const nativeBorrow = lyraeAccount.getNativeBorrow(
          lyraeCache.rootBankCache[tokenIndex],
          tokenIndex,
        );

        if (
          shouldWithdrawLyr ||
          lyraeAccount.deposits[tokenIndex].isPos() ||
          (nativeBorrow.gt(ZERO_I80F48) && nativeBorrow.lt(ONE_I80F48))
        ) {
          const instruction = makeResolveDustInstruction(
            this.programId,
            lyraeGroup.publicKey,
            lyraeAccount.publicKey,
            payer.publicKey,
            dustAccountPk,
            rootBank.publicKey,
            rootBank.nodeBanks[0],
            lyraeCache.publicKey,
          );
          resolveAllDustTransaction.transaction.add(instruction);
        }
      }
    }

    transactionsAndSigners.push(resolveAllDustTransaction);

    const closeAccountsTransaction = {
      transaction: new Transaction(),
      signers: [],
    };
    for (let i = 0; i < lyraeAccount.spotOpenOrders.length; i++) {
      const openOrders = lyraeAccount.spotOpenOrders[i];
      const spotMarket = lyraeGroup.spotMarkets[i].spotMarket;
      if (!openOrders.equals(zeroKey)) {
        closeAccountsTransaction.transaction.add(
          makeCloseSpotOpenOrdersInstruction(
            this.programId,
            lyraeGroup.publicKey,
            lyraeAccount.publicKey,
            payer.publicKey,
            lyraeGroup.dexProgramId,
            openOrders,
            spotMarket,
            lyraeGroup.signerKey,
          ),
        );
      }
    }
    if (!lyraeAccount.advancedOrdersKey.equals(zeroKey)) {
      closeAccountsTransaction.transaction.add(
        makeCloseAdvancedOrdersInstruction(
          this.programId,
          lyraeGroup.publicKey,
          lyraeAccount.publicKey,
          payer.publicKey,
          lyraeAccount.advancedOrdersKey,
        ),
      );
    }

    if (lyraeAccount.metaData.version == 0) {
      closeAccountsTransaction.transaction.add(
        makeUpgradeLyraeAccountV0V1Instruction(
          this.programId,
          lyraeGroup.publicKey,
          lyraeAccount.publicKey,
          payer.publicKey,
        ),
      );
    }

    closeAccountsTransaction.transaction.add(
      makeCloseLyraeAccountInstruction(
        this.programId,
        lyraeGroup.publicKey,
        lyraeAccount.publicKey,
        payer.publicKey,
      ),
    );
    transactionsAndSigners.push(closeAccountsTransaction);

    const signedTransactions = await this.signTransactions({
      transactionsAndSigners,
      payer: payer,
    });

    const txids: TransactionSignature[] = [];
    if (signedTransactions) {
      for (const signedTransaction of signedTransactions) {
        if (signedTransaction.instructions.length == 0) {
          continue;
        }
        const txid = await this.sendSignedTransaction({
          signedTransaction,
        });
        txids.push(txid);
        console.log(txid);
      }
    } else {
      throw new Error('Unable to sign emptyAndCloseLyraeAccount transactions');
    }

    return txids;
  }

  async cancelPerpOrderSide(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    perpMarket: PerpMarket,
    payer: Account | WalletAdapter,
    side: 'buy' | 'sell',
    limit: number,
  ) {
    const instruction = makeCancelPerpOrdersSideInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccount.publicKey,
      payer.publicKey,
      perpMarket.publicKey,
      perpMarket.bids,
      perpMarket.asks,
      side,
      new BN(limit),
    );

    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, payer, additionalSigners);
  }

  async setDelegate(
    lyraeGroup: LyraeGroup,
    lyraeAccount: LyraeAccount,
    payer: Account | WalletAdapter,
    delegate: PublicKey,
  ) {
    const instruction = makeSetDelegateInstruction(
      this.programId,
      lyraeGroup.publicKey,
      lyraeAccount.publicKey,
      payer.publicKey,
      delegate,
    );

    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];
    return await this.sendTransaction(transaction, payer, additionalSigners);
  }

  async changeSpotMarketParams(
    lyraeGroup: LyraeGroup,
    spotMarket: Market,
    rootBank: RootBank,
    admin: Account | WalletAdapter,

    maintLeverage: number | undefined,
    initLeverage: number | undefined,
    liquidationFee: number | undefined,
    optimalUtil: number | undefined,
    optimalRate: number | undefined,
    maxRate: number | undefined,
    version: number | undefined,
  ): Promise<TransactionSignature> {
    const instruction = makeChangeSpotMarketParamsInstruction(
      this.programId,
      lyraeGroup.publicKey,
      spotMarket.publicKey,
      rootBank.publicKey,
      admin.publicKey,
      I80F48.fromNumberOrUndef(maintLeverage),
      I80F48.fromNumberOrUndef(initLeverage),
      I80F48.fromNumberOrUndef(liquidationFee),
      I80F48.fromNumberOrUndef(optimalUtil),
      I80F48.fromNumberOrUndef(optimalRate),
      I80F48.fromNumberOrUndef(maxRate),
      version !== undefined ? new BN(version) : undefined,
    );

    const transaction = new Transaction();
    transaction.add(instruction);
    const additionalSigners = [];

    return await this.sendTransaction(transaction, admin, additionalSigners);
  }
}