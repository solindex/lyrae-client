import * as fs from 'fs';
import * as os from 'os';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { Options, PositionalOptions } from 'yargs';
import { Account, Commitment, Connection, PublicKey } from '@solana/web3.js';
import {
    Cluster,
    Config,
    getPerpMarketByBaseSymbol,
    getPerpMarketByIndex,
    getSpotMarketByBaseSymbol,
    getTokenBySymbol,
    GroupConfig,
    PerpMarketConfig,
    SpotMarketConfig,
} from '../config';
import { LyraeClient } from '../client';
import { throwUndefined, uiToNative } from '../utils/utils';
import { QUOTE_INDEX } from '../layout';
import { Coder } from '@project-serum/anchor';
import idl from '../lyrae_logs.json';
import { getMarketIndexBySymbol } from '../config';
import { Market } from '@project-serum/serum';
import initGroup from './initGroup';
import addPerpMarket from './addPerpMarket';
import addSpotMarket from './addSpotMarket';
import addStubOracle from './addStubOracle';
import addPythOracle from './addPythOracle';
import addSwitchboardOracle from './addSwitchboardOracle';
import setStubOracle from './setStubOracle';
import listMarket from './listMarket';
import sanityCheck from './sanityCheck';