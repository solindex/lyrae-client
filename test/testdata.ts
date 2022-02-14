import { OpenOrders } from '@project-serum/serum';
import { PublicKey } from '@solana/web3.js';
import { LyraeGroup, RootBank } from '../src';
import { LyraeAccountLayout, LyraeCache, LyraeCacheLayout, LyraeGroupLayout, NodeBank, NodeBankLayout, RootBankLayout } from '../src/layout';
import LyraeAccount from '../src/LyraeAccount';

export function loadTestLyraeGroup(filename: string): LyraeGroup {
  const accountJson: { [key: string]: any } = require(filename);
  const data = Buffer.from(accountJson.data[0], 'base64');
  const layout = LyraeGroupLayout.decode(data)
  return new LyraeGroup(new PublicKey(accountJson.address), layout)
}

export function loadTestLyraeAccount(filename: string): LyraeAccount {
  const accountJson: { [key: string]: any } = require(filename);
  const data = Buffer.from(accountJson.data[0], 'base64');
  const layout = LyraeAccountLayout.decode(data)
  return new LyraeAccount(new PublicKey(accountJson.address), layout)
}

export function loadTestOpenOrders(filename: string): OpenOrders {
  const openOrdersJson: { [key: string]: any } = require(filename);
  const data = Buffer.from(openOrdersJson.data[0], 'base64');
  const layout = OpenOrders.getLayout(new PublicKey(0)).decode(data)
  return new OpenOrders(new PublicKey(openOrdersJson.address), layout, new PublicKey(0))
}

export function loadTestLyraeCache(filename: string): LyraeCache {
  const accountJson: { [key: string]: any } = require(filename);
  const data = Buffer.from(accountJson.data[0], 'base64');
  const layout = LyraeCacheLayout.decode(data)
  return new LyraeCache(new PublicKey(accountJson.address), layout)
}

export function loadTestMangoRootBank(filename: string): RootBank {
  const accountJson: { [key: string]: any } = require(filename);
  const data = Buffer.from(accountJson.data[0], 'base64');
  const layout = RootBankLayout.decode(data)
  return new RootBank(new PublicKey(accountJson.address), layout)
}

export function loadTestMangoNodeBank(filename: string): NodeBank {
  const accountJson: { [key: string]: any } = require(filename);
  const data = Buffer.from(accountJson.data[0], 'base64');
  const layout = NodeBankLayout.decode(data)
  return new NodeBank(new PublicKey(accountJson.address), layout)
}
