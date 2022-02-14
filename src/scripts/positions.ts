import { Commitment, Connection, PublicKey } from '@solana/web3.js';
import { LyraeClient } from '../client';
import { Cluster, Config } from '../config';

const config = Config.ids();
const cluster = (process.env.CLUSTER || 'mainnet') as Cluster;
const connection = new Connection(
    config.cluster_urls[cluster],
    'processed' as Commitment,
);

const groupName = process.env.GROUP || 'mainnet.1';
const groupIds = config.getGroup(cluster, groupName);
if (!groupIds) {
    throw new Error(`Group ${groupName} not found`);
}

const dexProgramId = groupIds.serumProgramId;
const lyraeProgramId = groupIds.lyraeProgramId;
const lyraeGroupKey = groupIds.publicKey;
const client = new LyraeClient(connection, lyraeProgramId);

async function watchAccount(pk: PublicKey) {
    const group = await client.getLyraeGroup(lyraeGroupKey);
    const account = await client.getLyraeAccount(pk, dexProgramId);
    const cache = await group.loadCache(connection);
    console.log(account.toPrettyString(groupIds!, group, cache));
    console.log('Assets:', account.getAssetsVal(group, cache).toString());
    console.log('Liabs:', account.getLiabsVal(group, cache).toString());
}

async function watchHighestLiabilities(n: number) {
    console.log('getLyraeGroup');
    const group = await client.getLyraeGroup(lyraeGroupKey);
    console.log('getAllLyraeAccounts');
    const lyraeAccounts = await client.getAllLyraeAccounts(group);
    console.log('loadCache');
    const cache = await group.loadCache(connection);

    lyraeAccounts.sort((a, b) => {
        const aLiabs = a.getLiabsVal(group, cache, 'Maint');
        const bLiabs = b.getLiabsVal(group, cache, 'Maint');
        return bLiabs.sub(aLiabs).toNumber();
    });

    for (let i = 0; i < Math.min(n, lyraeAccounts.length); i++) {
        console.log(i);
        console.log(lyraeAccounts[i].toPrettyString(groupIds!, group, cache));
    }
}

if (process.env.ACC) {
    watchAccount(new PublicKey(process.env.ACC));
} else {
    watchHighestLiabilities(30);
}
