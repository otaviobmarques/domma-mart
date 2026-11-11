import { HttpException } from '@nestjs/common';

/** Códigos estáveis e mensagens da seção 23. Nunca expõem detalhes técnicos. */
export const ERRORS = {
  VALIDATION_ERROR: [422, 'Confira os campos destacados.'],
  CPF_INVALID: [422, 'CPF inválido. Confira os números.'],
  EMAIL_DISPOSABLE: [422, 'Use um e-mail que você acessa sempre.'],
  OFFER_UNAVAILABLE: [410, 'Esta oferta não está mais disponível.'],
  OFFER_SOLD_OUT: [410, 'As vagas desta oferta acabaram.'],
  COUPON_INVALID: [422, 'Cupom inválido ou expirado.'],
  CARD_DECLINED: [402, 'O banco recusou o pagamento. Tente outro cartão ou pague com Pix.'],
  CARD_INSUFFICIENT_FUNDS: [402, 'O cartão não tem limite para esta compra. Tente outro cartão ou pague com Pix.'],
  CARD_EXPIRED: [402, 'Este cartão está vencido.'],
  CARD_CVV_INVALID: [402, 'O código de segurança (CVV) não confere.'],
  CARD_RISK_BLOCKED: [402, 'Não conseguimos aprovar este pagamento. Tente pagar com Pix.'],
  PIX_EXPIRED: [409, 'Este Pix expirou. Gere um novo.'],
  RATE_LIMITED: [429, 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.'],
  REFUND_WINDOW_CLOSED: [409, 'O prazo de garantia terminou. Fale com o produtor.'],
  REFUND_ALREADY_REQUESTED: [409, 'O reembolso desta compra já foi pedido.'],
  AUTH_LINK_EXPIRED: [401, 'Este link expirou. Peça um novo.'],
  UNAUTHENTICATED: [401, 'Entre na sua conta para continuar.'],
  INVALID_CREDENTIALS: [401, 'E-mail ou senha incorretos.'],
  OTP_INVALID: [422, 'Código incorreto. Confira no seu aplicativo autenticador.'],
  OTP_LOCKED: [423, 'Muitas tentativas. Por segurança, o saque ficou bloqueado por 30 minutos.'],
  TWO_FACTOR_REQUIRED: [403, 'Ative a verificação em duas etapas para continuar.'],
  KYC_REQUIRED: [403, 'Confirme sua identidade para sacar.'],
  INSUFFICIENT_BALANCE: [422, 'O valor é maior que o seu saldo disponível.'],
  WITHDRAWAL_MIN: [422, 'O saque mínimo é de R$ 10,00.'],
  DAILY_LIMIT_REACHED: [422, 'Você atingiu o limite de saques de hoje.'],
  PAYOUT_DESTINATION_COOLDOWN: [422, 'Sua nova chave Pix poderá receber saques a partir de [data e hora].'],
  PAYOUT_ACCOUNT_REQUIRED: [422, 'Cadastre uma chave Pix no seu CPF/CNPJ para sacar.'],
  ACCOUNT_BLOCKED: [423, 'Sua conta está temporariamente bloqueada. Fale com o suporte.'],
  PERMISSION_DENIED: [403, 'Você não tem permissão para fazer isso. Peça ao dono da conta.'],
  NOT_FOUND: [404, 'Não encontramos o que você procurou.'],
  UPLOAD_TOO_LARGE: [413, 'O arquivo passa de 5 GB. Divida em partes menores.'],
  IDEMPOTENCY_KEY_REQUIRED: [400, 'Algo deu errado do nosso lado. Tente de novo em instantes.'],
  IDEMPOTENCY_CONFLICT: [409, 'Esta operação já está sendo processada.'],
  EMAIL_TAKEN: [409, 'Já existe uma conta com este e-mail. Tente entrar.'],
  WEAK_PASSWORD: [422, 'Use uma senha com pelo menos 9 caracteres.'],
  PWNED_PASSWORD: [422, 'Esta senha já apareceu em vazamentos. Escolha outra.'],
  SALES_PAUSED_KYC: [403, 'Confirme sua identidade para continuar vendendo.'],
  DOMAINS_UNAVAILABLE: [503, 'Domínio próprio ainda não está disponível. Fale com o suporte.'],
  INTERNAL_ERROR: [500, 'Algo deu errado do nosso lado. Tente de novo em instantes.'],
} as const;

export type ErrorCode = keyof typeof ERRORS;

export class AppError extends HttpException {
  constructor(public readonly code: ErrorCode, detail?: { title?: string; fields?: Record<string, string>; [k: string]: unknown }) {
    const [status, title] = ERRORS[code];
    super({ type: `https://docs.dommamart.com/erros/${code}`, code, title: detail?.title ?? title, status, ...detail }, status);
  }
}
