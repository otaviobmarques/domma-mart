/** Serializa bigint como número (centavos cabem em Number com folga) e mascara nada sensível. */
export function toJSON<T>(v: T): any {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x)));
}
