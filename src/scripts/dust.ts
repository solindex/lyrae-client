import * as os from 'os';
import * as fs from 'fs';
import { LyraeClient } from '../client';
import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js';
import configFile from '../ids.json';
import { Cluster, Config } from '../config';
import { QUOTE_INDEX } from '..';

const config = new Config(configFile);

const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
const groupName = process.env.GROUP || 'devnet.2';
const groupIds = config.getGroup(cluster, groupName);

if (!groupIds) {
  throw new Error(`Group ${groupName} not found`);
}
const lyraeProgramId = groupIds.lyraeProgramId;
const lyraeGroupKey = groupIds.publicKey;

const payer = new Account(
  JSON.parse(
    process.env.KEYPAIR ||
      fs.readFileSync(os.homedir() + '/.config/solana/devnet.json', 'utf-8'),
  ),
);

const connection = new Connection(
  process.env.ENDPOINT_URL || config.cluster_urls[cluster],
  'processed' as Commitment,
);
const client = new LyraeClient(connection, lyraeProgramId);


async function run() {
    if (!groupIds) {
      throw new Error(`Group ${groupName} not found`);
    }
  
    const lyraeGroup = await client.getLyraeGroup(lyraeGroupKey);
    const rootBanks = await lyraeGroup.loadRootBanks(connection);
    const cache = await lyraeGroup.loadCache(connection);
    const quoteRootBank = rootBanks[QUOTE_INDEX];
    if (!quoteRootBank) {
      throw new Error('Quote Rootbank Not Found');
    }
    const lyraeAccount = await client.getLyraeAccount(
      new PublicKey('8m3Lh1Exh5WaG76aFRWFGgMU5yWXLxifbgVfCnFjv15p'),
      lyraeGroup.dexProgramId,
    );
    //    console.log('Creating group dust account');
    //    await client.createDustAccount(lyraeGroup, payer);
    console.log('Resolving account dust');
    await client.resolveDust(
        lyraeGroup,
        lyraeAccount,
      quoteRootBank,
      cache,
      payer,
    );
  }
  
  run();