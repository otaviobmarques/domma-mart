'use client';
/** Pixel Meta / GA4 / TikTok no navegador, com event_id igual ao da Conversions API (5.8). */
type Pixels = { meta_pixel_id?: string; ga4_id?: string; tiktok_pixel_id?: string };
declare global { interface Window { fbq?: any; _fbq?: any; gtag?: any; dataLayer?: any[]; ttq?: any } }

export function loadPixels(p?: Pixels) {
  if (!p || typeof window === 'undefined') return;
  if (p.meta_pixel_id && !window.fbq) {
    const f: any = (window.fbq = function (...a: any[]) { f.callMethod ? f.callMethod(...a) : f.queue.push(a); });
    f.push = f; f.loaded = true; f.version = '2.0'; f.queue = [];
    const s = document.createElement('script'); s.async = true; s.src = 'https://connect.facebook.net/en_US/fbevents.js'; document.head.appendChild(s);
    window.fbq('init', p.meta_pixel_id); window.fbq('track', 'PageView');
  }
  if (p.ga4_id && !window.gtag) {
    const s = document.createElement('script'); s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${p.ga4_id}`; document.head.appendChild(s);
    window.dataLayer = window.dataLayer || []; window.gtag = function () { window.dataLayer!.push(arguments); };
    window.gtag('js', new Date()); window.gtag('config', p.ga4_id);
  }
}
export function track(event: 'InitiateCheckout' | 'AddPaymentInfo' | 'Purchase', data: { value?: number; eventId?: string } = {}) {
  try {
    window.fbq?.('track', event, data.value != null ? { value: data.value, currency: 'BRL' } : {}, data.eventId ? { eventID: data.eventId } : undefined);
    const ga = { InitiateCheckout: 'begin_checkout', AddPaymentInfo: 'add_payment_info', Purchase: 'purchase' }[event];
    window.gtag?.('event', ga, { value: data.value, currency: 'BRL', transaction_id: data.eventId });
  } catch {}
}
