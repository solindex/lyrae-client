import { Account, Connection } from '@solana/web3.js';
import { LyraeClient } from '../client';
import { getOracleBySymbol, GroupConfig, OracleConfig } from '../config';

export default async function setStubOracle(
    connection: Connection,
    payer: Account,
    groupConfig: GroupConfig,
    symbol: string,
    value: number,
) {
    const client = new LyraeClient(connection, groupConfig.lyraeProgramId);
    const oracle = getOracleBySymbol(groupConfig, symbol) as OracleConfig;
    await client.setStubOracle(
        groupConfig.publicKey,
        oracle.publicKey,
        payer,
        value,
    );
}