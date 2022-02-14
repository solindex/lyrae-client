import { Account, Commitment, Connection } from '@solana/web3.js';
import { LyraeClient } from '../client';
import { Cluster, Config } from '../config';
import * as os from 'os';
import * as fs from 'fs';

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

const lyraeProgramId = groupIds.lyraeProgramId;
const lyraeGroupKey = groupIds.publicKey;
const client = new LyraeClient(connection, lyraeProgramId);

// const payer = new Account(
//   JSON.parse(
//     process.env.KEYPAIR ||
//       fs.readFileSync(os.homedir() + '/.config/solana/devnet.json', 'utf-8'),
//   ),
// );

async function check() {
    const group = await client.getLyraeGroup(lyraeGroupKey);
    const lyraeAccounts = await client.getAllLyraeAccounts(
        group,
        undefined,
        true,
    );

    let total = 0;

    for (const lyraeAccount of lyraeAccounts) {
        const oos = lyraeAccount.spotOpenOrdersAccounts;

        const shouldFix = oos.some((oo, i) => {
            if (oo) {
                const freeSlotBitsStr = oo['freeSlotBits'].toString();
                const isEmpty =
                    oo.quoteTokenTotal.isZero() &&
                    oo.baseTokenTotal.isZero() &&
                    oo['referrerRebatesAccrued'].isZero() &&
                    freeSlotBitsStr == '340282366920938463463374607431768211455';

                const inBasketAndEmpty = lyraeAccount.inMarginBasket[i] && isEmpty;
                const notInBasketAndNotEmpty =
                    !lyraeAccount.inMarginBasket[i] && !isEmpty;

                if (inBasketAndEmpty || notInBasketAndNotEmpty) {
                    console.log(
                        lyraeAccount.publicKey.toString(),
                        lyraeAccount.name,
                        inBasketAndEmpty,
                        notInBasketAndNotEmpty,
                        oo.quoteTokenTotal.toString(),
                        oo.baseTokenTotal.toString(),
                        oo['referrerRebatesAccrued'].toString(),
                        freeSlotBitsStr,
                    );
                }

                return inBasketAndEmpty || notInBasketAndNotEmpty;
            }
        });
        if (shouldFix) {
            // await client.updateMarginBasket(group, mangoAccount, payer);
            total++;
        }
    }

    console.log('Total', total);
}

check();