const parse = (value) => {
  const text = String(value ?? '0').trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) throw new Error(`Invalid decimal: ${text}`);
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  return { negative, whole, fraction };
};

/** Exact decimal subtraction for UI-only derived values; source amounts remain strings. */
export function subtractDecimal(left, right) {
  const a = parse(left); const b = parse(right);
  const scale = Math.max(a.fraction.length, b.fraction.length);
  const toInteger = ({ negative, whole, fraction }) => {
    const value = BigInt(`${whole}${fraction.padEnd(scale, '0')}`);
    return negative ? -value : value;
  };
  const result = toInteger(a) - toInteger(b);
  const negative = result < 0n;
  const digits = (negative ? -result : result).toString().padStart(scale + 1, '0');
  const whole = scale ? digits.slice(0, -scale) : digits;
  const fraction = scale ? digits.slice(-scale) : '';
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}
