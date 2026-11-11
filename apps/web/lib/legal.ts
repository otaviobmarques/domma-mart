/**
 * Dados da empresa usados nos documentos legais. Campos vazios aparecem destacados como
 * “[a preencher]” nas páginas até serem completados (podem vir de variáveis de ambiente).
 */
export const LEGAL = {
  version: '2026-11-11',
  updatedAt: '11 de novembro de 2026',
  brand: 'Domma Mart',
  company: process.env.NEXT_PUBLIC_LEGAL_COMPANY || 'Domma Tecnologia',
  cnpj: process.env.NEXT_PUBLIC_LEGAL_CNPJ || '',
  address: process.env.NEXT_PUBLIC_LEGAL_ADDRESS || '',
  supportEmail: process.env.NEXT_PUBLIC_LEGAL_SUPPORT_EMAIL || '',
  dpoName: process.env.NEXT_PUBLIC_LEGAL_DPO_NAME || '',
  dpoEmail: process.env.NEXT_PUBLIC_LEGAL_DPO_EMAIL || '',
  forum: process.env.NEXT_PUBLIC_LEGAL_FORUM || '',
  paymentInstitution: process.env.NEXT_PUBLIC_LEGAL_PAYMENT_INSTITUTION || 'instituição de pagamento parceira autorizada pelo Banco Central',
};
