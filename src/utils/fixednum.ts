import BN from 'bn.js';
import Big from 'big.js';

export class I80F48 {
    static MAX_SIZE = 128;
    static FRACTIONS = 48;
    static MULTIPLIER_BIG = new Big(2).pow(I80F48.FRACTIONS);
    static MULTIPLIER_BN = new BN(2).pow(new BN(I80F48.FRACTIONS));
    static MULTIPLIER_NUMBER = Math.pow(2, I80F48.FRACTIONS);
    static MAX_BN: BN = new BN(2)
        .pow(new BN(I80F48.MAX_SIZE))
        .div(new BN(2))
        .sub(new BN(1));

    static MIN_BN: BN = new BN(2)
        .pow(new BN(I80F48.MAX_SIZE))
        .div(new BN(2))
        .neg();

    data: BN;

    constructor(data: BN) {
        if (data.lt(I80F48.MIN_BN) || data.gt(I80F48.MAX_BN)) {
            throw new Error('Number out of range');
        }

        this.data = data;
    }

    static fromNumber(x: number): I80F48 {
        let int_part = Math.trunc(x);
        let v = new BN(int_part).iushln(48);
        v.iadd(new BN((x - int_part) * I80F48.MULTIPLIER_NUMBER));
        return new I80F48(v);
    }

    static fromNumberOrUndef(x?: number): I80F48 | undefined {
        return x === undefined ? undefined : I80F48.fromNumber(x);
    }

    static fromOptionalString(x?: string): I80F48 | undefined {
        return x ? I80F48.fromString(x) : undefined;
    }

    static fromString(x: string): I80F48 {
        const initialValue = new Big(x).times(I80F48.MULTIPLIER_BIG);
        const fixedPointValue = new BN(initialValue.round().toFixed());
        return new I80F48(fixedPointValue);
    }

    static fromI64(x: BN): I80F48 {
        return new I80F48(x.ushln(48));
    }

    static fromU64(x: BN): I80F48 {
        return new I80F48(x.ushln(48));
    }

    toTwos(): BN {
        return this.data.toTwos(I80F48.MAX_SIZE);
    }

    toString(): string {
        return this.toBig().toFixed();
    }

    toFixed(decimals?: number): string {
        return this.toBig().round(14).toFixed(decimals);
    }

    toBig(): Big {
        return new Big(this.data.toString()).div(I80F48.MULTIPLIER_BIG);
    }

    static fromBig(x: Big): I80F48 {
        return new I80F48(new BN(x.mul(I80F48.MULTIPLIER_BIG).round().toFixed()));
    }

    toNumber(): number {
        return this.toBig().toNumber();
    }

    static fromArray(src: Uint8Array): I80F48 {
        if (src.length !== 16) {
            throw new Error('Uint8Array must be of length 16');
        }
        return new I80F48(new BN(src, 'le').fromTwos(I80F48.MAX_SIZE));
    }

    toArray(): Uint8Array {
        return new Uint8Array(this.data.toTwos(I80F48.MAX_SIZE).toArray('le', 16));
    }

    toArrayLike(
        ArrayType: typeof Buffer,
        endian?: BN.Endianness,
        length?: number,
    ): Buffer {
        return this.data
            .toTwos(I80F48.MAX_SIZE)
            .toArrayLike(ArrayType, endian, length);
    }

    getData(): BN {
        return this.data;
    }

    getBinaryLayout(): string {
        return this.data
            .toTwos(I80F48.MAX_SIZE)
            .toString(2, I80F48.MAX_SIZE)
            .replace(/-/g, '');
    }

    add(x: I80F48): I80F48 {
        return new I80F48(this.data.add(x.getData()));
    }

    sub(x: I80F48): I80F48 {
        return new I80F48(this.data.sub(x.getData()));
    }

    iadd(x: I80F48): I80F48 {
        this.data.iadd(x.getData());
        return this;
    }

    isub(x: I80F48): I80F48 {
        this.data.isub(x.getData());
        return this;
    }

    floor(): I80F48 {
        return I80F48.fromBig(this.toBig().round(undefined, 0));
    }

    ceil(): I80F48 {
        return I80F48.fromBig(this.toBig().round(undefined, 3));
    }

    frac(): I80F48 {
        return new I80F48(this.data.maskn(I80F48.FRACTIONS));
    }

    mul(x: I80F48): I80F48 {
        return new I80F48(this.data.mul(x.data).iushrn(I80F48.FRACTIONS));
    }

    imul(x: I80F48): I80F48 {
        this.data.imul(x.getData()).iushrn(I80F48.FRACTIONS);
        return this;
    }

    div(x: I80F48): I80F48 {
        return new I80F48(this.data.ushln(I80F48.FRACTIONS).div(x.data));
    }

    idiv(x: I80F48): I80F48 {
        this.data = this.data.iushln(I80F48.FRACTIONS).div(x.data);
        return this;
    }

    gt(x: I80F48): boolean {
        return this.data.gt(x.getData());
    }

    lt(x: I80F48): boolean {
        return this.data.lt(x.getData());
    }

    gte(x: I80F48): boolean {
        return this.data.gte(x.getData());
    }

    lte(x: I80F48): boolean {
        return this.data.lte(x.getData());
    }

    eq(x: I80F48): boolean {
        return this.data.eq(x.getData());
    }

    cmp(x: I80F48): -1 | 0 | 1 {
        return this.data.cmp(x.getData());
    }

    neg(): I80F48 {
        return this.mul(NEG_ONE_I80F48);
    }

    isPos(): boolean {
        return this.gt(ZERO_I80F48);
    }

    isNeg(): boolean {
        return this.data.isNeg();
    }

    isZero(): boolean {
        return this.eq(ZERO_I80F48);
    }

    min(x: I80F48): I80F48 {
        return this.lte(x) ? this : x;
    }

    max(x: I80F48): I80F48 {
        return this.gte(x) ? this : x;
    }

    abs(): I80F48 {
        if (this.isNeg()) {
            return this.neg();
        } else {
            return this;
        }
    }
}

export const ONE_I80F48 = I80F48.fromString('1');

export const ZERO_I80F48 = I80F48.fromString('0');

export const NEG_ONE_I80F48 = I80F48.fromString('-1');