import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Notificações (seção 24). Drivers: Resend (RESEND_API_KEY) para e-mail e Domma Chat
 * (DOMMA_CHAT_URL + DOMMA_CHAT_TOKEN, API oficial com modelos aprovados) para WhatsApp.
 * Sem credenciais, grava na caixa de saída (tabela notifications) — útil em desenvolvimento.
 */
export const TEMPLATES: Record<string, { subject?: string; body: string }> = {
  purchase_approved: { subject: '{produtor}: sua compra foi aprovada', body: 'Oi, {primeiro_nome}! Sua compra de {produto} foi aprovada. Acesse aqui: {link_acesso}. Qualquer dúvida, fale com {produtor}: {contato}.' },
  pix_generated: { subject: '{produtor}: seu Pix está pronto', body: 'Seu Pix de {valor} para {produto} está pronto. Ele vale até {hora}. Pagar agora: {link_pix}' },
  pix_unpaid: { body: '{primeiro_nome}, seu Pix para {produto} ainda não foi pago. Gere um novo aqui: {link}. Para não receber mais, responda SAIR.' },
  recovery: { subject: '{produtor}: termine sua compra', body: '{texto}\n\nPara não receber mais: {descadastro}' },
  boleto_generated: { subject: '{produtor}: seu boleto', body: 'Seu boleto de {valor} vence em {data}. Código: {linha_digitavel}. PDF: {link}' },
  magic_link: { subject: 'Seu link de acesso — Domma Mart', body: 'Clique para entrar na sua área de cliente: {link}. O link vale por 15 minutos e só pode ser usado uma vez.' },
  otp_code: { body: 'Seu código de acesso Domma Mart é {codigo}. Ele vale por 10 minutos.' },
  refund_confirmed: { subject: '{produtor}: reembolso confirmado', body: 'Seu reembolso de {valor} da compra {produto} foi confirmado. {prazo_por_meio}.' },
  subscription_renewed: { subject: '{produtor}: assinatura renovada', body: 'Renovamos sua assinatura de {produto}: {valor}, cartão final {final}. Próxima cobrança em {data}.' },
  subscription_failed: { subject: '{produtor}: não conseguimos cobrar seu cartão', body: 'Não conseguimos cobrar seu cartão para {produto}. Atualize em {link} para não perder o acesso.' },
  sale_approved: { subject: 'Venda aprovada!', body: 'Venda aprovada! {comprador} comprou {produto} por {valor}. Você recebe {liquido}.' },
  refund_requested: { subject: 'Pedido de reembolso', body: '{comprador} pediu reembolso de {produto} ({valor}) dentro da garantia.' },
  chargeback_opened: { subject: 'Cliente contestou uma compra', body: 'Um cliente contestou a compra {codigo} ({valor}) no banco. O valor ficou em análise. Já enviamos as evidências.' },
  withdrawal_done: { subject: 'Saque enviado', body: 'Seu saque de {valor} foi enviado para a chave {chave_mascarada}.' },
  payout_key_changed: { subject: 'Sua chave de saque foi alterada', body: 'Sua chave de saque foi alterada. Se não foi você, fale com o suporte agora: {link}.' },
  kyc_approved: { subject: 'Identidade confirmada', body: 'Sua identidade foi confirmada. Você já pode sacar.' },
  kyc_more_docs: { subject: 'Precisamos de mais um documento', body: 'Para confirmar sua identidade, precisamos de: {motivo}. Envie em {link}.' },
  kyc_rejected: { subject: 'Não foi possível confirmar sua identidade', body: 'Não foi possível confirmar sua identidade. Motivo: {motivo}. Fale com o suporte: {link}.' },
  new_login: { subject: 'Novo acesso à sua conta', body: 'Entramos na sua conta de um novo aparelho ({dispositivo}). Se não foi você, troque a senha.' },
  verify_email: { subject: 'Confirme seu e-mail — Domma Mart', body: 'Confirme seu e-mail para ativar sua conta: {link}' },
  reset_password: { subject: 'Trocar senha — Domma Mart', body: 'Para criar uma nova senha, use este link (vale 30 minutos): {link}' },
  coproduction_invite: { subject: 'Convite de sociedade em {produto}', body: '{produtor} convidou você para ser sócio de {produto}, com {percentual} sobre o líquido. Aceite em {link}.' },
};

export function render(tpl: string, vars: Record<string, string | number | undefined>): string {
  return tpl.replace(/\{(\w+)\}/g, (_m, k) => (vars[k] ?? '').toString());
}

@Injectable()
export class NotifyService {
  private log = new Logger('Notify');
  constructor(private prisma: PrismaService) {}

  async send(o: { channel: 'email' | 'whatsapp' | 'push'; to: string; template: keyof typeof TEMPLATES; vars: Record<string, any>; workspaceId?: string | null; refType?: string; refId?: string; sensitive?: string[] }) {
    const t = TEMPLATES[o.template];
    const body = render(t.body, o.vars);
    const subject = t.subject ? render(t.subject, o.vars) : undefined;
    const masked = o.channel === 'email' ? o.to.replace(/^(.).*(@.*)$/, '$1***$2') : o.to.replace(/.(?=.{4})/g, '*');
    const realDriver = (o.channel === 'email' && !!process.env.RESEND_API_KEY) || (o.channel === 'whatsapp' && !!process.env.DOMMA_CHAT_URL);
    // Com driver real, links mágicos/códigos não ficam gravados em claro (seção 11.7).
    const stored = realDriver && o.sensitive?.length
      ? render(t.body, { ...o.vars, ...Object.fromEntries(o.sensitive.map(k => [k, '[oculto]'])) })
      : body;
    const n = await this.prisma.notifications.create({ data: { channel: o.channel, to_masked: masked, template: o.template, subject, body: stored, workspace_id: o.workspaceId ?? null, ref_type: o.refType, ref_id: o.refId } });
    try {
      let status = 'sent';
      if (o.channel === 'email' && process.env.RESEND_API_KEY) {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: process.env.EMAIL_FROM || 'Domma Mart <nao-responda@dommamart.com>', to: o.to, subject, text: body }),
        });
        if (!r.ok) throw new Error(`resend ${r.status}`);
      } else if (o.channel === 'whatsapp' && process.env.DOMMA_CHAT_URL) {
        const r = await fetch(`${process.env.DOMMA_CHAT_URL}/v1/messages/template`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.DOMMA_CHAT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: o.to, template: o.template, variables: o.vars }),
        });
        if (!r.ok) throw new Error(`domma-chat ${r.status}`);
      } else {
        status = 'logged'; // caixa de saída de desenvolvimento
        this.log.log(`[${o.channel}] ${masked} · ${o.template}: ${body}`);
      }
      await this.prisma.notifications.update({ where: { id: n.id }, data: { status } });
    } catch (e: any) {
      await this.prisma.notifications.update({ where: { id: n.id }, data: { status: 'failed', error: String(e.message).slice(0, 300) } });
    }
    return n.id;
  }
}
