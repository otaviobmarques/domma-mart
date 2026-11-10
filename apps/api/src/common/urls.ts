import { signToken } from './crypto';
const APP = () => process.env.APP_URL || 'http://localhost:3000';
export const urls = {
  app: (p = '') => APP() + p,
  orderToken: (orderId: string, ttlMs: number) => signToken({ o: orderId, exp: Date.now() + ttlMs }),
  pix: (orderId: string, expiresAt: Date) => `${APP()}/pix/${orderId}?t=${signToken({ o: orderId, exp: expiresAt.getTime() + 86400000 })}`,
  thanks: (orderId: string) => `${APP()}/obrigado/${orderId}?t=${signToken({ o: orderId, exp: Date.now() + 7 * 86400000 })}`,
  boleto: (orderId: string) => `${APP()}/boleto/${orderId}?t=${signToken({ o: orderId, exp: Date.now() + 10 * 86400000 })}`,
  checkout: (slug: string) => `${APP()}/pay/${slug}`,
  customerArea: () => `${APP()}/minhas-compras`,
};
