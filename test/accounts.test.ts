import fs from 'fs';
import os from 'os';
import { Cluster, Config, LyraeClient, sleep } from '../src';
import configFile from '../src/ids.json';
import { Account, Commitment, Connection } from '@solana/web3.js';

async function testAccounts() {
  // Load all the details for lyrae group
  const groupName = process.env.GROUP || 'lyrae_test_v3.nightly';
  const cluster = (process.env.CLUSTER || 'devnet') as Cluster;
  const sleepTime = 250;
  const config = new Config(configFile);
  const groupIds = config.getGroup(cluster, groupName);
  const accounts = 10000;

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
    config.cluster_urls[cluster],
    'processed' as Commitment,
  );

  const client = new LyraeClient(connection, lyraeProgramId);
  const lyraeGroup = await client.getLyraeGroup(lyraeGroupKey);

  for (let i = 0; i < accounts; i++) {
    try {
      await client.initLyraeAccount(lyraeGroup, payer);
      console.log(`Created account ${i}/${accounts}`);
    } catch (err) {
      console.error('Failed to create account');
    } finally {
      await sleep(sleepTime);
    }
  }
}

testAccounts();
