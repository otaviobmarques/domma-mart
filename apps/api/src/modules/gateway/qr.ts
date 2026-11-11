import QRCode from 'qrcode';

/**
 * QR Code do Pix como SVG em data URL. O SVG é texto puro: sai ~20x mais barato que desenhar e
 * comprimir um PNG (que consumia metade da CPU da API no teste de carga) e fica nítido em qualquer tela.
 */
export async function pixQrDataUrl(copyPaste: string): Promise<string> {
  const svg = await QRCode.toString(copyPaste, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}
