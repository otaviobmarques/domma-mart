'use client';
import { useEffect, useState } from 'react';
import { get, api, post, ApiError } from '@/lib/api';
import { brl, dateTime, shortDate, maskMoney, moneyToCents } from '@/lib/format';
import { useMe } from '@/components/session';
import { Button, Card, Field, Skeleton, Banner, Modal, Pill } from '@/components/ui';

export default function Financeiro() {
  const { me, reload: reloadMe } = useMe();
  const [b, setB] = useState<any>(null);
  const [mv, setMv] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [amount, setAmount] = useState('');
  const [otp, setOtp] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dates, setDates] = useState(false);
  const [totp, setTotp] = useState<any>(null);
  const [totpCode, setTotpCode] = useState('');
  const [keyOpen, setKeyOpen] = useState(false);
  const [pixKey, setPixKey] = useState('');
  const [bank, setBank] = useState({ bank: '', branch: '', account: '', account_digit: '', type: 'checking' as 'checking' | 'savings' });
  const [keyOtp, setKeyOtp] = useState('');
  const [period, setPeriod] = useState({ from: '', to: '' });

  const bankMode = me?.payout_mode === 'bank_account';
  const load = async () => {
    setB(await get('/v1/finance/balance'));
    const q = new URLSearchParams(Object.fromEntries(Object.entries({ from: period.from ? new Date(period.from + 'T00:00:00-03:00').toISOString() : '', to: period.to ? new Date(period.to + 'T23:59:59-03:00').toISOString() : '' }).filter(([, v]) => v)));
    setMv(await get(`/v1/finance/ledger?${q}`));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [period]);
  useEffect(() => { if (b && new URLSearchParams(location.search).get('sacar')) startWithdraw(); /* eslint-disable-next-line */ }, [!!b]);

  function startWithdraw() {
    setErr(null); setOtp('');
    if (b.kyc_status !== 'approved') return;
    if (!me.user.totp_enabled) { setupTotp(); return; }
    setAmount(maskMoney(String(Math.min(b.available_cents, b.daily_limit_cents)))); setStep(1); setOpen(true);
  }
  async function setupTotp() { setTotp(await post('/v1/auth/2fa/setup')); setTotpCode(''); setErr(null); }

  async function confirm() {
    setBusy(true); setErr(null);
    try { await api('POST', '/v1/finance/withdrawals', { amount_cents: moneyToCents(amount) }, { idem: true, otp }); setStep(3); load(); }
    catch (e) { const x = e as ApiError; setErr(x.title); if (['INSUFFICIENT_BALANCE', 'WITHDRAWAL_MIN', 'DAILY_LIMIT_REACHED'].includes(x.code)) setStep(1); }
    setBusy(false);
  }

  if (!b) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-40 w-full" /></div>;
  const cents = moneyToCents(amount);
  return (
    <div className="space-y-4">
      <h1 className="text-[26px] font-extrabold">Financeiro</h1>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-2 border-action/40 lg:col-span-2">
          {b.negative_cents > 0 ? <>
            <p className="font-semibold text-bad">Saldo negativo: −{brl(b.negative_cents)}</p>
            <p className="text-[14.5px] text-ink-soft">Será descontado das próximas vendas.</p>
          </> : <>
            <p className="text-[15px] font-semibold text-ink-mute">Você pode sacar agora</p>
            <p className="num mt-1 text-[36px] font-bold leading-none">{brl(b.available_cents)}</p>
            <p className="mt-2 text-[14px] text-ink-mute">{bankMode ? 'Saque para sua conta bancária. Cai em até 1 dia útil.' : 'Saque grátis por Pix. Cai na sua conta em minutos.'}</p>
          </>}
          <div className="mt-4">
            {b.kyc_status !== 'approved' ? <><Button size="lg" disabled>Sacar para minha conta</Button><p className="mt-2 text-[14px] text-ink-mute">Confirme sua identidade para sacar. <a href="/identidade" className="font-semibold text-action">Confirmar agora</a></p></>
              : !b.payout_account ? <Button size="lg" onClick={() => setKeyOpen(true)}>{bankMode ? 'Cadastrar conta bancária' : 'Cadastrar chave Pix'}</Button>
              : <Button size="lg" disabled={b.available_cents < 1000} onClick={startWithdraw}>Sacar para minha conta</Button>}
          </div>
          {mv?.processing_withdrawals?.map((w: any) => <p key={w.id} className="mt-3 text-[14px]">Saque para sua conta — <b>Processando</b> <span className="num">{brl(w.amount_cents)}</span></p>)}
        </Card>
        <div className="space-y-4">
          <Card><p className="text-[14px] font-semibold text-ink-mute">Chegando</p><p className="num mt-1 text-[22px] font-bold">{brl(b.incoming_cents)}</p><button className="mt-1 text-[14px] font-semibold text-action" onClick={() => setDates(true)}>Ver datas</button></Card>
          <Card><p className="text-[14px] font-semibold text-ink-mute">Em análise</p><p className="num mt-1 text-[22px] font-bold">{brl(b.blocked_cents)}</p><p className="text-[13px] text-ink-mute">{b.blocked_count} {b.blocked_count === 1 ? 'contestação' : 'contestações'}</p></Card>
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-extrabold">Conta de saque</h2>{!b.payout_account && bankMode && b.kyc_status !== 'approved' && <Button size="sm" onClick={() => { if (!me.user.totp_enabled) setupTotp(); else setKeyOpen(true); }}>Cadastrar conta bancária</Button>}{b.payout_account && <Button size="sm" variant="secondary" onClick={() => { if (!me.user.totp_enabled) setupTotp(); else setKeyOpen(true); }}>Alterar conta de saque</Button>}</div>
        {b.payout_account ? <div className="mt-2 text-[14.5px]"><p><span className="num font-semibold">{b.payout_account.pix_key_masked}</span> · {b.payout_account.holder_name} {b.kyc_status === 'approved' && <Pill tone="ok">Identidade verificada</Pill>}</p>
          {b.payout_account.cooling_down && <p className="mt-1 text-[#7A4500]">Sua nova {bankMode ? 'conta' : 'chave Pix'} poderá receber saques a partir de {dateTime(b.payout_account.active_from)}.</p>}
          <p className="mt-1 text-[13px] text-ink-mute">Por segurança, uma {bankMode ? 'conta nova' : 'chave nova'} só recebe saques 24 h depois do cadastro.</p></div> : <p className="mt-2 text-ink-mute">{bankMode ? 'Nenhuma conta cadastrada. Use uma conta bancária no seu CPF/CNPJ — ela é necessária para começar a vender.' : 'Nenhuma chave cadastrada. Use uma chave Pix no seu CPF/CNPJ.'}</p>}
      </Card>

      <Card className="p-0">
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5"><h2 className="font-extrabold">Movimentações</h2>
          <div className="flex flex-wrap items-end gap-2"><Field label="De" type="date" value={period.from} onChange={e => setPeriod({ ...period, from: e.target.value })} /><Field label="Até" type="date" value={period.to} onChange={e => setPeriod({ ...period, to: e.target.value })} /><a href="/v1/finance/ledger.csv" className="inline-flex min-h-[44px] items-center px-2 font-semibold text-action">Exportar CSV</a></div></div>
        {!mv ? <Skeleton className="m-5 h-32" /> : mv.data.length === 0 ? <p className="p-5 text-ink-mute">Nenhuma movimentação ainda.</p> : (
          <table className="mt-3 w-full text-left text-[14.5px]">
            <thead className="border-y border-line bg-canvas/60 text-[13px] text-ink-mute"><tr><th className="px-5 py-2 font-semibold">Quando</th><th className="font-semibold">O que aconteceu</th><th className="text-right font-semibold">Valor</th><th className="hidden px-5 font-semibold sm:table-cell">Pode sacar em</th></tr></thead>
            <tbody className="divide-y divide-line">{mv.data.map((m: any) => (
              <tr key={m.id}><td className="whitespace-nowrap px-5 py-2.5 text-ink-mute">{shortDate(m.at)}</td><td className="pr-2">{m.description}{m.bucket === 'blocked' && <span className="ml-1 text-[12px] text-bad">(em análise)</span>}</td>
                <td className={`num whitespace-nowrap text-right font-semibold ${m.amount_cents >= 0 ? 'text-ok' : 'text-bad'}`}>{m.amount_cents >= 0 ? '+' : '−'}{brl(Math.abs(m.amount_cents))}</td>
                <td className="hidden whitespace-nowrap px-5 text-ink-mute sm:table-cell">{m.bucket === 'balance' && m.amount_cents > 0 ? (new Date(m.available_at) <= new Date() ? 'Disponível' : shortDate(m.available_at)) : '—'}</td></tr>))}</tbody>
          </table>)}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={step === 3 ? 'Saque enviado' : 'Sacar para minha conta'}
        footer={step === 1 ? <Button full onClick={() => { setErr(null); if (cents < 1000) setErr('O saque mínimo é de R$ 10,00.'); else if (cents > b.available_cents) setErr('O valor é maior que o seu saldo disponível.'); else setStep(2); }}>Continuar</Button>
          : step === 2 ? <><Button variant="secondary" onClick={() => setStep(1)}>Voltar</Button><Button loading={busy} disabled={otp.length !== 6} onClick={confirm}>Confirmar saque</Button></>
          : <Button full onClick={() => setOpen(false)}>Fechar</Button>}>
        <ol className="mb-4 flex gap-2 text-[12.5px] font-bold">{['Valor', 'Código', 'Enviado'].map((s, i) => <li key={s} className={`rounded-full px-2.5 py-0.5 ${step > i ? 'bg-action text-white' : 'bg-canvas text-ink-mute'}`}>{i + 1}. {s}</li>)}</ol>
        {step === 1 && <><Field label="Valor" inputMode="numeric" value={amount} onChange={e => setAmount(maskMoney(e.target.value))} mono big right={<span className="text-ink-mute">R$</span>} hint={`Disponível: ${brl(b.available_cents)} · mínimo R$ 10,00`} /><p className="mt-3 text-[14px] text-ink-soft">Para: <span className="num">{b.payout_account?.pix_key_masked}</span></p></>}
        {step === 2 && <Field label="Código do aplicativo autenticador" inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} mono big autoFocus hint="Abra o Google Authenticator (ou similar) e digite os 6 números." />}
        {step === 3 && <p className="text-[16px]">Saque de <b className="num">{brl(cents)}</b> enviado. Você também vai receber a confirmação por e-mail.</p>}
        {err && <Banner tone="bad" className="mt-4">{err}</Banner>}
      </Modal>

      <Modal open={!!totp} onClose={() => setTotp(null)} title="Ative a verificação em duas etapas para sacar"
        footer={<Button full disabled={totpCode.length !== 6} onClick={async () => { try { await post('/v1/auth/2fa/enable', { code: totpCode }); setTotp(null); reloadMe(); setTimeout(() => location.reload(), 300); } catch (e) { setErr((e as ApiError).title); } }}>Ativar</Button>}>
        {totp && <ol className="space-y-3 text-[14.5px]">
          <li>1. Instale um aplicativo autenticador (Google Authenticator, Authy ou 1Password).</li>
          <li>2. Escaneie este QR Code com o aplicativo:<img src={totp.qr} alt="QR Code para o aplicativo autenticador" className="mx-auto mt-2 h-48 w-48" /><p className="num mt-1 break-all text-center text-[12px] text-ink-mute">ou digite: {totp.secret}</p></li>
          <li>3. Digite o código de 6 números que aparece no aplicativo:<Field label="Código" className="mt-2" inputMode="numeric" value={totpCode} onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))} mono big /></li>
          {err && <Banner tone="bad">{err}</Banner>}
        </ol>}
      </Modal>

      <Modal open={keyOpen} onClose={() => setKeyOpen(false)} title="Conta de saque"
        footer={<Button full loading={busy} onClick={async () => { setBusy(true); setErr(null); try { await api('PUT', '/v1/finance/payout-account', bankMode ? { bank: { ...bank, account_digit: bank.account_digit.toUpperCase() } } : { pix_key: pixKey }, { otp: keyOtp }); setKeyOpen(false); load(); reloadMe(); } catch (e) { setErr(Object.values((e as ApiError).fields ?? {})[0] ?? (e as ApiError).title); } setBusy(false); }}>{bankMode ? 'Salvar conta' : 'Salvar chave'}</Button>}>
        {bankMode ? <>
          <p className="text-[14.5px] text-ink-soft">A conta precisa estar no mesmo CPF/CNPJ da sua identidade. Uma conta nova só recebe saques depois de 24 h.</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Banco (código)" inputMode="numeric" value={bank.bank} onChange={e => setBank({ ...bank, bank: e.target.value.replace(/\D/g, '').slice(0, 3) })} placeholder="Ex.: 260" hint="3 números" />
            <Field label="Agência" inputMode="numeric" value={bank.branch} onChange={e => setBank({ ...bank, branch: e.target.value.replace(/\D/g, '').slice(0, 4) })} hint="Sem o dígito" />
            <Field label="Conta" inputMode="numeric" value={bank.account} onChange={e => setBank({ ...bank, account: e.target.value.replace(/\D/g, '').slice(0, 13) })} />
            <Field label="Dígito" value={bank.account_digit} onChange={e => setBank({ ...bank, account_digit: e.target.value.replace(/[^0-9xX]/g, '').slice(0, 2) })} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">{([['checking', 'Conta corrente'], ['savings', 'Poupança']] as const).map(([v, t]) => <button key={v} type="button" onClick={() => setBank({ ...bank, type: v })} className={`min-h-[44px] rounded-ctl border-2 px-3 text-left font-bold ${bank.type === v ? 'border-action bg-action-soft/40' : 'border-line'}`}>{t}</button>)}</div>
        </> : <>
          <p className="text-[14.5px] text-ink-soft">A chave precisa estar no mesmo CPF/CNPJ da sua conta. Uma chave nova só recebe saques depois de 24 h.</p>
          <Field className="mt-4" label="Chave Pix" value={pixKey} onChange={e => setPixKey(e.target.value)} placeholder="CPF, CNPJ, e-mail, celular ou chave aleatória" />
        </>}
        {me.user.totp_enabled ? <Field className="mt-3" label="Código do aplicativo autenticador" inputMode="numeric" value={keyOtp} onChange={e => setKeyOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} mono /> : <Banner tone="warn" className="mt-3" action={<Button size="sm" variant="secondary" onClick={() => { setKeyOpen(false); setupTotp(); }}>Ativar</Button>}>Ative a verificação em duas etapas primeiro.</Banner>}
        {err && <Banner tone="bad" className="mt-3">{err}</Banner>}
      </Modal>

      <Modal open={dates} onClose={() => setDates(false)} title="Quando o dinheiro fica disponível">
        {b.incoming_by_date.length === 0 ? <p className="text-ink-mute">Nada chegando no momento.</p> : <ul className="divide-y divide-line">{b.incoming_by_date.map((d: any) => <li key={d.day} className="flex min-h-[44px] items-center justify-between"><span>{shortDate(d.day)}</span><span className="num font-semibold">{brl(d.amount)}</span></li>)}</ul>}
        <p className="mt-3 text-[13px] text-ink-mute">Pix: 90% no dia seguinte e 10% no fim da garantia. Boleto: 2 dias. Cartão: 30 dias.</p>
      </Modal>
    </div>
  );
}
