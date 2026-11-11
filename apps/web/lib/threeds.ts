'use client';
/**
 * 3-D Secure 2.x da Stone/Pagar.me (biblioteca 3ds-nx-js). Roda só no navegador: o número do cartão
 * vai direto para o servidor 3DS; a API da Domma recebe apenas o id da transação autenticada.
 * Fluxos: sem atrito (o banco aprova sozinho) ou desafio (o banco pede código/app num iframe).
 */
declare global { interface Window { TDS?: { init: (cfg: any, order: any) => Promise<{ tds_server_trans_id: string; trans_status: string; challenge_canceled?: boolean }[]> } } }

const loaded = new Map<string, Promise<void>>();
function loadScript(src: string) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { loaded.delete(src); reject(new Error('3ds')); };
      document.head.appendChild(s);
    }));
  }
  return loaded.get(src)!;
}

/** Só Visa e Mastercard têm 3DS na Stone. */
export const needs3DS = (brand: string | null) => brand === 'visa' || brand === 'mastercard';

export type BillingAddress = { zip: string; street: string; number: string; complement?: string; district: string; city: string; state: string };

export async function run3DS(p: {
  scriptUrl: string; token: string; amountCents: number;
  card: { number: string; name: string; mm: number; yy: number };
  customer: { name: string; email: string; phone: string; document: string };
  billing: BillingAddress;
}): Promise<{ transaction_id: string; status: string }> {
  try { await loadScript(p.scriptUrl); } catch { throw new Error('Não conseguimos falar com o seu banco. Tente de novo.'); }
  if (!window.TDS) throw new Error('Não conseguimos falar com o seu banco. Tente de novo.');
  const phone = p.customer.phone.replace(/\D/g, '');
  const address = { country: 'BR', state: p.billing.state.toUpperCase(), city: p.billing.city, zip_code: p.billing.zip.replace(/\D/g, ''), line_1: `${p.billing.number}, ${p.billing.street}, ${p.billing.district}`, line_2: p.billing.complement || '-' };
  const order = {
    customer: { name: p.customer.name, email: p.customer.email, document: p.customer.document.replace(/\D/g, ''), phones: { mobile_phone: { country_code: '55', area_code: phone.slice(0, 2), number: phone.slice(2) } } },
    payments: [{ payment_method: 'credit_card', amount: p.amountCents, credit_card: { card: { number: p.card.number.replace(/\D/g, ''), holder_name: p.card.name.trim().slice(0, 64), exp_month: p.card.mm, exp_year: 2000 + p.card.yy, billing_address: address } } }],
    shipping: { recipient_name: p.customer.name, electronic_delivery: true },
    requestor_url: location.origin,
  };
  const small = window.matchMedia('(max-width: 480px)').matches;
  let res;
  try {
    res = await window.TDS.init({
      token: p.token,
      tds_method_container_element: document.getElementById('tdsMethodContainer'),
      challenge_container_element: document.getElementById('challengeContainer'),
      use_default_challenge_iframe_style: true,
      challenge_window_size: small ? '01' : '03',
    }, order);
  } catch { throw new Error('O banco não respondeu à confirmação. Tente de novo ou pague com Pix.'); }
  const r = res?.[0];
  if (!r?.tds_server_trans_id) throw new Error('O banco não respondeu à confirmação. Tente de novo ou pague com Pix.');
  if (r.challenge_canceled) throw new Error('Você cancelou a confirmação do banco. Tente de novo para concluir a compra.');
  if (r.trans_status === 'N' || r.trans_status === 'R') throw new Error('O banco não confirmou a compra. Tente outro cartão ou pague com Pix.');
  return { transaction_id: r.tds_server_trans_id, status: r.trans_status };
}
