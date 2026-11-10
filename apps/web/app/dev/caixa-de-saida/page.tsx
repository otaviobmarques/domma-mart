'use client';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Card, Pill, Logo } from '@/components/ui';
/** Só em desenvolvimento: mensagens que seriam enviadas por e-mail/WhatsApp. */
export default function Outbox() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { const l = () => get('/v1/dev/outbox').then(setRows).catch(() => {}); l(); const t = setInterval(l, 3000); return () => clearInterval(t); }, []);
  const linkify = (s: string) => s.split(/(https?:\/\/\S+)/g).map((p, i) => /^https?:/.test(p) ? <a key={i} href={p.replace(/[.,]$/, '')} className="break-all font-semibold text-action underline">{p}</a> : p);
  return (
    <main className="mx-auto max-w-3xl px-4 py-8"><Logo /><h1 className="mt-4 text-[22px] font-extrabold">Caixa de saída (desenvolvimento)</h1><p className="text-ink-mute">E-mails e WhatsApp que seriam enviados. Configure RESEND_API_KEY e DOMMA_CHAT_URL para envio real.</p>
      <div className="mt-5 space-y-3">{rows.map((r, i) => <Card key={i} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2 text-[13px]"><span><Pill tone={r.channel === 'email' ? 'action' : r.channel === 'whatsapp' ? 'ok' : 'neutral'}>{r.channel}</Pill> <b>{r.to}</b> · {r.template}</span><span className="text-ink-mute">{dateTime(r.at)}</span></div>{r.subject && <p className="mt-1 font-bold">{r.subject}</p>}<p className="mt-1 whitespace-pre-wrap text-[14.5px]">{linkify(r.body)}</p></Card>)}</div>
    </main>
  );
}
