'use client';
import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import { brl } from '@/lib/format';

export function cx(...c: (string | false | null | undefined)[]) { return c.filter(Boolean).join(' '); }

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'ok'; size?: 'md' | 'lg' | 'xl' | 'sm'; loading?: boolean; full?: boolean };
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = 'primary', size = 'md', loading, full, className, children, disabled, ...p }, ref) {
  const v = {
    primary: 'bg-action text-white hover:bg-action-hover disabled:bg-action/50',
    secondary: 'bg-white text-ink border border-line hover:border-action/50 hover:bg-action-soft/40 disabled:opacity-60',
    ghost: 'bg-transparent text-action hover:bg-action-soft disabled:opacity-50',
    danger: 'bg-bad text-white hover:bg-bad/90 disabled:opacity-60',
    ok: 'bg-ok text-white hover:bg-ok/90 disabled:opacity-60',
  }[variant];
  const s = { sm: 'min-h-[36px] px-3 text-sm', md: 'min-h-[44px] px-4', lg: 'min-h-[52px] px-5 text-[16px]', xl: 'min-h-[60px] px-6 text-[17px]' }[size];
  return (
    <button ref={ref} disabled={disabled || loading} aria-busy={loading || undefined} className={cx('inline-flex items-center justify-center gap-2 rounded-ctl font-bold transition-colors disabled:cursor-not-allowed', v, s, full && 'w-full', className)} {...p}>
      {loading ? <><Spinner /> Processando…</> : children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return <svg className={cx('h-4 w-4 animate-spin', className)} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity=".25" /><path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" fill="none" /></svg>;
}

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: React.ReactNode; error?: string | null; right?: React.ReactNode; big?: boolean; mono?: boolean };
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field({ label, hint, error, right, big, mono, className, id, ...p }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={className}>
      <label htmlFor={fid} className="mb-1.5 block text-[14px] font-semibold text-ink">{label}</label>
      <div className="relative">
        <input ref={ref} id={fid} aria-invalid={!!error || undefined} aria-describedby={error ? `${fid}-e` : hint ? `${fid}-h` : undefined}
          className={cx('w-full rounded-ctl border bg-white px-3.5 text-[16px] text-ink placeholder:text-ink-mute/70 focus:outline-none focus:ring-2 focus:ring-action', big ? 'min-h-[52px]' : 'min-h-[44px]', error ? 'border-bad' : 'border-line', !!right && 'pr-12', mono && 'num')} {...p} />
        {right && <div className="absolute inset-y-0 right-3 flex items-center">{right}</div>}
      </div>
      {error ? <p id={`${fid}-e`} role="alert" className="mt-1.5 text-[13.5px] font-medium text-bad">{error}</p> : hint ? <p id={`${fid}-h`} className="mt-1.5 text-[13.5px] text-ink-mute">{hint}</p> : null}
    </div>
  );
});

export function Select({ label, children, className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[14px] font-semibold">{label}</label>
      <select id={id} className="min-h-[44px] w-full rounded-ctl border border-line bg-white px-3 text-[16px] focus:outline-none focus:ring-2 focus:ring-action" {...p}>{children}</select>
    </div>
  );
}

export function Textarea({ label, className, hint, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[14px] font-semibold">{label}</label>
      <textarea id={id} className="min-h-[96px] w-full rounded-ctl border border-line bg-white px-3.5 py-2.5 text-[15px] focus:outline-none focus:ring-2 focus:ring-action" {...p} />
      {hint && <p className="mt-1.5 text-[13.5px] text-ink-mute">{hint}</p>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-start gap-3 py-1">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={cx('relative mt-0.5 h-6 w-11 flex-none rounded-full transition-colors', checked ? 'bg-action' : 'bg-line')}>
        <span className={cx('absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </button>
      <span><span className="block font-semibold">{label}</span>{hint && <span className="block text-[13.5px] text-ink-mute">{hint}</span>}</span>
    </label>
  );
}

export function Card({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('rounded-card border border-line bg-white p-5 shadow-card', className)} {...p}>{children}</div>;
}

export function Skeleton({ className }: { className?: string }) { return <div className={cx('skeleton', className)} aria-hidden="true" />; }

export function Banner({ tone = 'info', children, action, className }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  const t = { info: 'bg-action-soft border-action/20 text-action-ink', warn: 'bg-warn-soft border-warn-line text-[#6B3D00]', bad: 'bg-bad-soft border-bad/30 text-bad', ok: 'bg-ok-soft border-ok/30 text-ok' }[tone];
  return <div role={tone === 'bad' ? 'alert' : 'status'} className={cx('flex flex-wrap items-center justify-between gap-3 rounded-ctl border px-4 py-3 text-[14.5px] font-medium', t, className)}><div className="min-w-0 flex-1">{children}</div>{action}</div>;
}

const STATUS_TONE: Record<string, string> = {
  paid: 'bg-ok-soft text-ok', chargeback_won: 'bg-ok-soft text-ok', pending: 'bg-warn-soft text-[#7A4500]', created: 'bg-warn-soft text-[#7A4500]',
  refunded: 'bg-[#EEEDF3] text-ink-soft', refund_requested: 'bg-[#EEEDF3] text-ink-soft', chargeback: 'bg-bad-soft text-bad', chargeback_lost: 'bg-bad-soft text-bad',
  expired: 'bg-[#EEEDF3] text-ink-mute', failed: 'bg-bad-soft text-bad', abandoned: 'bg-[#EEEDF3] text-ink-mute',
};
export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-[12.5px] font-bold', STATUS_TONE[status] ?? 'bg-[#EEEDF3] text-ink-soft')}>{label}</span>;
}
export function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'action' }) {
  const t = { neutral: 'bg-[#EEEDF3] text-ink-soft', ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-[#7A4500]', bad: 'bg-bad-soft text-bad', action: 'bg-action-soft text-action-ink' }[tone];
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12.5px] font-bold', t)}>{children}</span>;
}

export function Money({ cents, className }: { cents: number | null | undefined; className?: string }) {
  return <span className={cx('num', className)}>{brl(cents ?? 0)}</span>;
}

/** Modal acessível: prende o foco e fecha com Esc (19.0). */
export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    prev.current = document.activeElement as HTMLElement;
    const el = ref.current!;
    const focusables = () => Array.from(el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(x => !x.hasAttribute('disabled'));
    setTimeout(() => (focusables()[0] ?? el).focus(), 10);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const f = focusables(); if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev.current?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1} className="max-h-[92vh] w-full overflow-auto rounded-t-card bg-white p-6 shadow-xl sm:max-w-md sm:rounded-card">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id="modal-title" className="text-[19px] font-extrabold">{title}</h2>
          <button onClick={onClose} aria-label="Fechar" className="-mr-2 -mt-1 flex h-10 w-10 items-center justify-center rounded-ctl text-ink-mute hover:bg-canvas">✕</button>
        </div>
        {children}
        {footer && <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>
  );
}

/** Faixa "Sem conexão. Tentando de novo…" (19.0). */
export function NetworkBanner() {
  const [off, setOff] = useState(false);
  useEffect(() => {
    const on = () => setOff(false), offf = () => setOff(true);
    window.addEventListener('online', on); window.addEventListener('offline', offf);
    window.addEventListener('dm:online', on); window.addEventListener('dm:offline', offf);
    if (!navigator.onLine) setOff(true);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', offf); window.removeEventListener('dm:online', on); window.removeEventListener('dm:offline', offf); };
  }, []);
  if (!off) return null;
  return <div role="status" className="sticky top-0 z-[60] bg-ink px-4 py-2 text-center text-[14px] font-semibold text-white">Sem conexão. Tentando de novo…</div>;
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="rounded-card border border-dashed border-line bg-white/60 px-6 py-10 text-center"><p className="text-[16px] font-bold">{title}</p>{children && <div className="mx-auto mt-1 max-w-md text-ink-mute">{children}</div>}{action && <div className="mt-4">{action}</div>}</div>;
}

export function CopyButton({ text, label = 'Copiar', done = 'Copiado', variant = 'secondary', size = 'md', full, onCopied }: { text: string; label?: string; done?: string; variant?: BtnProps['variant']; size?: BtnProps['size']; full?: boolean; onCopied?: () => void }) {
  const [ok, setOk] = useState(false);
  return (
    <Button type="button" variant={variant} size={size} full={full} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setOk(true); onCopied?.(); setTimeout(() => setOk(false), 3000); }
      catch { const r = document.createRange(); const n = document.getElementById('copy-src'); if (n) { r.selectNodeContents(n); getSelection()?.removeAllRanges(); getSelection()?.addRange(r); } }
    }}>{ok ? `✓ ${done}` : label}</Button>
  );
}

export function Initials({ name, size = 72, src }: { name: string; size?: number; src?: string | null }) {
  if (src) return <img src={src} alt="" width={size} height={size} className="flex-none rounded-ctl object-cover" style={{ width: size, height: size }} />;
  const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return <div aria-hidden="true" className="flex flex-none items-center justify-center rounded-ctl bg-action-soft font-extrabold text-action" style={{ width: size, height: size, fontSize: size / 3 }}>{ini}</div>;
}

export function Logo({ className, iconOnlyOnMobile }: { className?: string; iconOnlyOnMobile?: boolean }) {
  return <span className={cx('inline-flex items-center gap-2 font-extrabold tracking-tight', className)}><svg viewBox="0 0 64 64" className="h-7 w-7" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#5B3FE6" /><path d="M18 16h14c10 0 16 6.5 16 16s-6 16-16 16H18V16zm9 8v16h5c4.6 0 7-3 7-8s-2.4-8-7-8h-5z" fill="#fff" /></svg><span className={iconOnlyOnMobile ? 'hidden sm:inline' : undefined}>Domma Mart</span></span>;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [state, set] = useState<{ data?: T; error?: any; loading: boolean }>({ loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    set(s => ({ ...s, loading: true }));
    fn().then(d => alive && set({ data: d, loading: false })).catch(e => alive && set({ error: e, loading: false }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { ...state, reload: () => setN(x => x + 1) };
}
