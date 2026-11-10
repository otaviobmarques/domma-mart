/** Gera um recibo em PDF simples (sem dependências), tela 19.5 "Ver recibo". */
function esc(s: string) {
  // PDF WinAnsi: troca acentos comuns e escapa parênteses
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?').replace(/([()\\])/g, '\\$1');
}
const brl = (c: bigint) => 'R$ ' + (Number(c) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export function receiptPdf(r: { code: string; paidAt: Date; method: string; installments: number; total: bigint; interest: bigint; seller: string; buyer: string; buyerEmail: string; items: { name: string; price: bigint }[] }): Buffer {
  const lines: [number, number, number, string][] = [];
  let y = 780;
  const add = (size: number, text: string, x = 56) => { lines.push([x, y, size, text]); y -= size + 10; };
  add(20, 'Recibo de compra');
  add(10, `Pedido ${r.code}  -  Pago em ${r.paidAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
  y -= 10;
  add(12, `Vendedor: ${r.seller}`);
  add(10, 'Processado por Domma Mart (Domma Tecnologia)');
  y -= 6;
  add(12, `Comprador: ${r.buyer}`);
  add(10, r.buyerEmail);
  y -= 10;
  add(12, 'Itens');
  for (const i of r.items) add(11, `${i.name}  -  ${brl(i.price)}`, 70);
  if (r.interest > 0n) add(11, `Juros do parcelamento  -  ${brl(r.interest)}`, 70);
  y -= 6;
  const method = { pix: 'Pix', card: `Cartao de credito (${r.installments}x)`, boleto: 'Boleto' }[r.method] ?? r.method;
  add(12, `Forma de pagamento: ${method}`);
  add(16, `Total pago: ${brl(r.total)}`);
  y -= 20;
  add(8, 'Este recibo nao substitui a nota fiscal, que e de responsabilidade do vendedor.');
  const content = lines.map(([x, yy, s, t]) => `BT /F1 ${s} Tf ${x} ${yy} Td (${esc(t)}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
