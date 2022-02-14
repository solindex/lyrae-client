/* eslint-disable @typescript-eslint/no-non-null-assertion, no-console */
import { Account, PublicKey, Connection } from '@solana/web3.js';
import { Token } from '@solana/spl-token';
import * as Test from './utils';
import { LyraeClient } from '../src';
import { QUOTE_INDEX } from '../src/layout';

describe('Oracles', async () => {
  let client: LyraeClient;
  let payer: Account;
  const connection: Connection = Test.createDevnetConnection();

  before(async () => {
    client = new LyraeClient(connection, Test.LyraeProgramId);
    payer = await Test.createAccount(connection, 10);
  });

  describe('LYR', async () => {
    it('should read correct LYR price', async () => {
      const lyraeGroup = await client.getLyraeGroup(new PublicKey('By6uwEKG88t8Mi1N478AP9CpiLsawyZNLRgyNwpHA6ua'));
      await client.cachePrices(
        lyraeGroup.publicKey,
        lyraeGroup.lyraeCache,
        lyraeGroup.oracles,
        payer,
      );
      const cache = await lyraeGroup.loadCache(connection);
      for (let price of cache.priceCache) {
        console.log(price.price.toString());
      }
    });
  });
});
