'use client';
/**
 * Identificador do aparelho para o antifraude (velocidade e CPFs no mesmo aparelho).
 * Um número aleatório guardado no navegador, combinado com traços estáveis (idioma, fuso, tela).
 * Não identifica a pessoa: serve só para notar muitas compras do mesmo aparelho.
 */
export async function deviceId(): Promise<string> {
  let r = '';
  try { r = localStorage.getItem('dm_dev') || ''; if (!r) { r = crypto.randomUUID(); localStorage.setItem('dm_dev', r); } } catch { r = 'nostore'; }
  const traits = [navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone, `${screen.width}x${screen.height}x${screen.colorDepth}`, navigator.hardwareConcurrency, navigator.platform].join('|');
  try {
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${r}|${traits}`));
    return Array.from(new Uint8Array(h)).slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { return r.replace(/-/g, '').slice(0, 32); }
}
