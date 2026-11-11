'use client';
import { useEffect, useState } from 'react';

/** Botão "Continuar com Google" (5.1). Só aparece quando o login com Google está configurado. */
export function GoogleButton({ href, disabled, onBlocked }: { href: string; disabled?: boolean; onBlocked?: () => void }) {
  const [on, setOn] = useState(false);
  useEffect(() => { fetch('/v1/auth/providers').then(r => r.json()).then(p => setOn(!!p.google)).catch(() => {}); }, []);
  if (!on) return null;
  return (
    <>
      <div className="my-4 flex items-center gap-3 text-[13px] text-ink-mute"><span className="h-px flex-1 bg-line" />ou<span className="h-px flex-1 bg-line" /></div>
      <a href={disabled ? undefined : href} onClick={e => { if (disabled) { e.preventDefault(); onBlocked?.(); } }} aria-disabled={disabled || undefined}
        className="flex min-h-[48px] w-full items-center justify-center gap-3 rounded-ctl border border-line bg-white font-bold text-ink hover:border-action/50">
        <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
        Continuar com Google
      </a>
    </>
  );
}

export const GOOGLE_ERRORS: Record<string, string> = {
  google_cancelado: 'Você cancelou a entrada com Google.',
  google_expirado: 'A entrada com Google expirou. Tente de novo.',
  google_falhou: 'Não conseguimos entrar com Google agora. Tente de novo em instantes.',
  google_email_nao_verificado: 'Seu e-mail do Google não está verificado. Use outra conta ou entre com senha.',
  google_indisponivel: 'A entrada com Google não está disponível no momento.',
  conta_bloqueada: 'Sua conta está temporariamente bloqueada. Fale com o suporte.',
};
