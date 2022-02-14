import { PublicKey, Transaction } from '@solana/web3.js';

export type Modify<T, R> = Omit<T, keyof R> & R;

export interface WalletAdapter {
    publicKey: PublicKey;
    autoApprove: boolean;
    connected: boolean;
    signTransaction: (transaction: Transaction) => Promise<Transaction>;
    signAllTransactions: (transaction: Transaction[]) => Promise<Transaction[]>;
    connect: () => any;
    disconnect: () => any;
    on(event: string, fn: () => void): this;
}

export type PerpOrderType =
    | 'limit'
    | 'ioc'
    | 'postOnly'
    | 'market'
    | 'postOnlySlide';