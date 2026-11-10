/** Gera um BR Code Pix (EMV) estático-like com CRC16-CCITT — usado só no sandbox. */
function tlv(id: string, v: string) { return id + String(v.length).padStart(2, '0') + v; }
function crc16(s: string): string {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    crc &= 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
export function brCode(opts: { txid: string; amountCents: bigint; merchant: string; city: string }): string {
  const mai = tlv('00', 'br.gov.bcb.pix') + tlv('25', `pix.sandbox.dommamart.com/qr/v2/${opts.txid}`);
  const amount = (Number(opts.amountCents) / 100).toFixed(2);
  const payload = tlv('00', '01') + tlv('01', '12') + tlv('26', mai) + tlv('52', '0000') + tlv('53', '986') + tlv('54', amount) +
    tlv('58', 'BR') + tlv('59', opts.merchant.slice(0, 25).normalize('NFD').replace(/[^\x20-\x7e]/g, '')) +
    tlv('60', opts.city.slice(0, 15)) + tlv('62', tlv('05', '***')) + '6304';
  return payload + crc16(payload);
}
