import { Cluster, Config, GroupConfig } from '../config';
import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import os from 'os';
import { IDS, LyraeClient, QUOTE_INDEX, RootBank } from '../index';

async function main() {
    const payer = new Account(
        JSON.parse(
            fs.readFileSync(
                process.env.KEYPAIR || os.homedir() + '/.config/solana/id.json',
                'utf-8',
            ),
        ),
    );

    const config = new Config(IDS);

    const groupIds = config.getGroupWithName('mainnet.1') as GroupConfig;
    if (!groupIds) {
        throw new Error(`Group ${'mainnet.1'} not found`);
    }
    const cluster = groupIds.cluster as Cluster;
    const lyraeProgramId = groupIds.lyraeProgramId;
    const lyraeGroupKey = groupIds.publicKey;
    const connection = new Connection(
        process.env.ENDPOINT_URL || config.cluster_urls[cluster],
        'processed' as Commitment,
    );
    const client = new LyraeClient(connection, lyraeProgramId);
    const lyraeGroup = await client.getLyraeGroup(lyraeGroupKey);

    const lyraeAccount = await client.getLyraeAccount(
        new PublicKey(''),
        lyraeGroup.dexProgramId,
    );
    const rootBanks = await lyraeGroup.loadRootBanks(connection);
    const quoteRootBank = rootBanks[QUOTE_INDEX] as RootBank;
    const lyraeCache = await lyraeGroup.loadCache(connection);
    const perpMarkets = await Promise.all(
        groupIds.perpMarkets.map((pmc) =>
            client.getPerpMarket(pmc.publicKey, pmc.baseDecimals, pmc.quoteDecimals),
        ),
    );

    const x = lyraeAccount.calcTotalPerpPosUnsettledPnl(lyraeGroup, lyraeCache);
    console.log(x.toNumber() / Math.pow(10, 6));
    const txids = await client.settlePosPnl(
        lyraeGroup,
        lyraeCache,
        lyraeAccount,
        perpMarkets,
        quoteRootBank,
        payer,
    );
    console.log(txids);
}

main();