import { Account, Connection } from '@solana/web3.js';
import { uiToNative } from '..';
import { LyraeClient } from '../client';
import {
    getOracleBySymbol,
    getPerpMarketByBaseSymbol,
    getTokenBySymbol,
    GroupConfig,
    lyrMints,
    OracleConfig,
} from '../config';

export default async function addPerpMarket(
    connection: Connection,
    payer: Account,
    groupConfig: GroupConfig,
    symbol: string,
    maintLeverage: number,
    initLeverage: number,
    liquidationFee: number,
    makerFee: number,
    takerFee: number,
    baseLotSize: number,
    quoteLotSize: number,
    maxNumEvents: number,
    rate: number,
    maxDepthBps: number,
    targetPeriodLength: number,
    lyrPerPeriod: number,
    exp: number,
): Promise<GroupConfig> {
    console.log({
        connection,
        payer,
        groupConfig,
        symbol,
    });

    const client = new LyraeClient(connection, groupConfig.lyraeProgramId);

    let group = await client.getLyraeGroup(groupConfig.publicKey);
    const oracleDesc = getOracleBySymbol(groupConfig, symbol) as OracleConfig;
    const marketIndex = group.getOracleIndex(oracleDesc.publicKey);

    let nativeLyrPerPeriod = 0;
    if (rate !== 0) {
        const token = getTokenBySymbol(groupConfig, 'LYR');
        if (token === undefined) {
            throw new Error('LYR not found in group config');
        } else {
            nativeLyrPerPeriod = uiToNative(
                lyrPerPeriod,
                token.decimals,
            ).toNumber();
        }
    }

    await client.addPerpMarket(
        group,
        oracleDesc.publicKey,
        lyrMints[groupConfig.cluster],
        payer,
        maintLeverage,
        initLeverage,
        liquidationFee,
        makerFee,
        takerFee,
        baseLotSize,
        quoteLotSize,
        maxNumEvents,
        rate,
        maxDepthBps,
        targetPeriodLength,
        nativeLyrPerPeriod,
        exp,
    );

    group = await client.getLyraeGroup(groupConfig.publicKey);
    const marketPk = group.perpMarkets[marketIndex].perpMarket;
    const baseDecimals = getTokenBySymbol(groupConfig, symbol)
        ?.decimals as number;
    const quoteDecimals = getTokenBySymbol(groupConfig, groupConfig.quoteSymbol)
        ?.decimals as number;
    const market = await client.getPerpMarket(
        marketPk,
        baseDecimals,
        quoteDecimals,
    );

    const marketDesc = {
        name: `${symbol}-PERP`,
        publicKey: marketPk,
        baseSymbol: symbol,
        baseDecimals,
        quoteDecimals,
        marketIndex,
        bidsKey: market.bids,
        asksKey: market.asks,
        eventsKey: market.eventQueue,
    };

    const marketConfig = getPerpMarketByBaseSymbol(groupConfig, symbol);
    if (marketConfig) {
        Object.assign(marketConfig, marketDesc);
    } else {
        groupConfig.perpMarkets.push(marketDesc);
    }

    return groupConfig;
}