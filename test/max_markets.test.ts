/* eslint-disable @typescript-eslint/no-non-null-assertion, no-console */
import { Account, Connection } from '@solana/web3.js';
import { Token } from '@solana/spl-token';
import * as Test from './utils';
import { LyraeClient } from '../src';
import { QUOTE_INDEX } from '../src/layout';

// NOTE: Important that QUOTE_INDEX and quote_index might not be the same number so take caution there

describe('MaxMarkets', async () => {
  let client: LyraeClient;
  let payer: Account;
  const connection: Connection = Test.createDevnetConnection();

  before(async () => {
    client = new LyraeClient(connection, Test.LyraeProgramId);
    payer = await Test.createAccount(connection, 10);
  });

  describe('testOrdersX32', async () => {
    it('should successfully place x32 orders', async () => {
      // Initial conf
      const numMints = 2;
      const quoteIndex = numMints - 1;
      const marketIndex = 0;
      // Create mints
      const mints: Token[] = await Test.createMints(
        connection,
        payer,
        numMints,
      );
      const quoteMint = mints[quoteIndex];
      if (!quoteMint) throw new Error('Failed creating mints');

      // Create lyrae group
      const lyraeGroupPk = await client.initLyraeGroup(
        quoteMint.publicKey,
        Test.MSRMMint,
        Test.DexProgramId,
        Test.FeesVault,
        5,
        Test.OPTIMAL_UTIL,
        Test.OPTIMAL_RATE,
        Test.MAX_RATE,
        payer,
      );
      let lyraeGroup = await client.getLyraeGroup(lyraeGroupPk);

      // Create lyrae account
      const lyraeAccountPk = await client.initLyraeAccount(lyraeGroup, payer);
      let lyraeAccount = await client.getLyraeAccount(
        lyraeAccountPk,
        Test.DexProgramId,
      );

      // List spot markets
      const spotMarketPks = await Test.listMarkets(
        connection,
        payer,
        Test.DexProgramId,
        mints,
        quoteMint.publicKey,
      );

      // Add associated token accounts to user and mint some
      const tokenAccountPks = await Test.createUserTokenAccounts(
        payer,
        mints,
        new Array(mints.length).fill(1_000_000),
      );

      // Add spotMarkets to LyraeGroup
      lyraeGroup = await Test.addSpotMarketsToLyraeGroup(
        client,
        payer,
        lyraeGroupPk,
        mints,
        spotMarketPks,
      );

      // Get root and node banks
      const quoteNodeBank = await Test.getNodeBank(
        client,
        lyraeGroup,
        QUOTE_INDEX,
      );
      const baseNodeBank = await Test.getNodeBank(
        client,
        lyraeGroup,
        marketIndex,
      );

      // Airdrop into base node bank
      await Test.mintToTokenAccount(payer, mints[0], baseNodeBank.vault, 10);

      // Deposit into lyrae account
      await Test.cacheRootBanks(client, payer, lyraeGroup, [
        marketIndex,
        QUOTE_INDEX,
      ]);

      lyraeAccount = await Test.performDeposit(
        client,
        payer,
        lyraeGroup,
        lyraeAccount,
        quoteNodeBank,
        tokenAccountPks[quoteIndex],
        QUOTE_INDEX,
        1_000_000,
      );

      await Test.cachePrices(client, payer, lyraeGroup, [marketIndex]);

      const market = await Test.getMarket(client, lyraeGroup, 0);

      lyraeAccount = await Test.placeSpotOrder(
        client,
        payer,
        lyraeGroup,
        lyraeAccount,
        market,
      );
    });
  });
});
