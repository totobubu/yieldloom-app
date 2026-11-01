// Exact rational arithmetic for financial decimal strings; no floating point intermediates.
const gcd = (a, b) => {
    a = a < 0n ? -a : a;
    while (b) [a, b] = [b, a % b];
    return a || 1n;
};
export class ExactAmount {
    constructor(n, d = 1n) {
        if (!d) throw Error('division_by_zero');
        if (d < 0n) {
            n = -n;
            d = -d;
        }
        const g = gcd(n, d);
        this.n = n / g;
        this.d = d / g;
    }
    add(v) {
        v = exact(v);
        return new ExactAmount(this.n * v.d + v.n * this.d, this.d * v.d);
    }
    sub(v) {
        v = exact(v);
        return new ExactAmount(this.n * v.d - v.n * this.d, this.d * v.d);
    }
    mul(v) {
        v = exact(v);
        return new ExactAmount(this.n * v.n, this.d * v.d);
    }
    div(v) {
        v = exact(v);
        return new ExactAmount(this.n * v.d, this.d * v.n);
    }
    cmp(v) {
        v = exact(v);
        const n = this.n * v.d - v.n * this.d;
        return n < 0n ? -1 : n > 0n ? 1 : 0;
    }
    text(places) {
        if (places === undefined) {
            let d = this.d,
                twos = 0,
                fives = 0;
            while (d % 2n === 0n) {
                d /= 2n;
                twos++;
            }
            while (d % 5n === 0n) {
                d /= 5n;
                fives++;
            }
            places = d === 1n ? Math.max(twos, fives) : 18;
        }
        const p = 10n ** BigInt(places),
            negative = this.n < 0n,
            n = negative ? -this.n : this.n;
        const rounded = (n * p * 2n + this.d) / (2n * this.d);
        const raw = rounded.toString().padStart(places + 1, '0');
        const tail = places ? raw.slice(-places).replace(/0+$/, '') : '';
        return (
            (negative && rounded ? '-' : '') +
            (places ? raw.slice(0, -places) : raw) +
            (tail ? '.' + tail : '')
        );
    }
}
export function exact(v) {
    if (v instanceof ExactAmount) return v;
    if (typeof v !== 'string' || !/^-?\d{1,40}(?:\.\d{1,30})?$/.test(v))
        throw Error('invalid_decimal');
    const [a, b = ''] = v.split('.');
    return new ExactAmount(BigInt(a + b), 10n ** BigInt(b.length));
}
export const optionalExact = (v) => (v == null ? null : exact(v));
export const exactSum = (values) =>
    values.reduce((n, v) => n.add(v), exact('0'));
