/**
 * Dados de demonstração. Uso: npm run db:seed
 * Cria: super admin (com 2FA), produtor com identidade aprovada e um curso publicado,
 * e um afiliado. Imprime as credenciais e os segredos TOTP para o app autenticador.
 */
import 'reflect-metadata';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const envFile = resolve(__dirname, '../.env');
if (existsSync(envFile)) for (const l of readFileSync(envFile, 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { encrypt, blindIndex, base62 } from './common/crypto';
import { generateSecret } from './common/totp';

const prisma = new PrismaClient();
const PASSWORD = 'Domma@Mart2026';

async function user(email: string, name: string, role: any = 'none', withTotp = false) {
  const existing = await prisma.users.findUnique({ where: { email } });
  if (existing) return { u: existing, secret: null as string | null };
  const secret = withTotp ? generateSecret() : null;
  const u = await prisma.users.create({ data: {
    email, name, password_hash: await argon2.hash(PASSWORD, { type: argon2.argon2id }), email_verified_at: new Date(), platform_role: role,
    phone_enc: encrypt('+5531999990000'), ...(secret ? { totp_secret_enc: encrypt(secret), totp_enabled_at: new Date() } : {}),
  } });
  return { u, secret };
}

async function workspace(ownerId: string, name: string, doc: string, approved: boolean) {
  const m = await prisma.memberships.findFirst({ where: { user_id: ownerId, role: 'owner' } });
  if (m) return prisma.workspaces.findUniqueOrThrow({ where: { id: m.workspace_id } });
  const ws = await prisma.workspaces.create({ data: {
    owner_id: ownerId, name, person_type: 'pf', document_enc: encrypt(doc), document_hash: blindIndex(doc),
    kyc_status: approved ? 'approved' : 'pending', gateway_subaccount_id: approved ? `acc_sbx_${base62(10)}` : null, support_whatsapp: '+5531999990000',
  } });
  await prisma.memberships.create({ data: { user_id: ownerId, workspace_id: ws.id, role: 'owner', permissions: [] } });
  return ws;
}

async function main() {
  const admin = await user('admin@dommamart.com', 'Admin Domma', 'super_admin', true);
  await workspace(admin.u.id, 'Domma (interno)', '39053344705', false);

  const fin = await user('financeiro@dommamart.com', 'Financeiro Domma', 'finance', true);
  await workspace(fin.u.id, 'Domma Financeiro (interno)', '86288366757', false);

  const prod = await user('produtora@demo.com', 'Ana Confeiteira', 'none', true);
  const ws = await workspace(prod.u.id, 'Ana Confeiteira', '52998224725', true);
  await prisma.payout_accounts.upsert({ where: { workspace_id: ws.id }, create: { workspace_id: ws.id, pix_key_enc: encrypt('produtora@demo.com'), pix_key_mask: 'pr***@demo.com', holder_name: 'Ana Confeiteira', holder_doc_hash: ws.document_hash!, active_from: new Date(Date.now() - 86400000) }, update: {} });

  let product = await prisma.products.findFirst({ where: { workspace_id: ws.id } });
  if (!product) {
    product = await prisma.products.create({ data: {
      workspace_id: ws.id, type: 'course', name: 'Curso de Confeitaria Lucrativa', description: 'Aprenda a fazer bolos que vendem e a precificar do jeito certo.',
      moderation_status: 'approved', published_at: new Date(), affiliation_enabled: true, affiliate_commission_bps: 4000,
    } });
    const m1 = await prisma.course_modules.create({ data: { product_id: product.id, title: 'Primeiros passos', position: 0 } });
    const m2 = await prisma.course_modules.create({ data: { product_id: product.id, title: 'Precificação', position: 1 } });
    const lessons = [
      [m1.id, 'Boas-vindas', 'Que bom ter você aqui! Neste curso você vai aprender, passo a passo, a montar sua confeitaria em casa.'],
      [m1.id, 'Utensílios essenciais', 'Batedeira, formas, espátulas e termômetro: o mínimo para começar sem gastar muito.'],
      [m2.id, 'Quanto cobrar por um bolo', 'Some ingredientes, embalagem, gás e o seu tempo. Depois aplique a margem.'],
    ];
    for (const [i, [mid, title, body]] of lessons.entries()) await prisma.lessons.create({ data: { module_id: mid, product_id: product.id, title, kind: 'text', body, position: i % 2 } });
    await prisma.offers.create({ data: { workspace_id: ws.id, product_id: product.id, slug: 'confeitaria', price_cents: 19700n, methods: ['pix', 'card', 'boleto'], status: 'active' } });
    const ebook = await prisma.products.create({ data: { workspace_id: ws.id, type: 'file', name: 'E-book 50 Receitas de Recheio', moderation_status: 'approved', published_at: new Date() } });
    const ebookOffer = await prisma.offers.create({ data: { workspace_id: ws.id, product_id: ebook.id, slug: 'recheios', price_cents: 2700n, status: 'active' } });
    const main = await prisma.offers.findUniqueOrThrow({ where: { slug: 'confeitaria' } });
    await prisma.offer_bumps.create({ data: { offer_id: main.id, bump_offer_id: ebookOffer.id, headline: 'Leve também o e-book com 50 recheios', position: 0 } });
    await prisma.coupons.create({ data: { workspace_id: ws.id, code: 'BEMVINDO', kind: 'percent', value: 1000 } });
  }

  const aff = await user('afiliado@demo.com', 'Bruno Afiliado');
  const affWs = await workspace(aff.u.id, 'Bruno Afiliado', '11144477735', true);
  await prisma.affiliations.upsert({ where: { product_id_affiliate_workspace_id: { product_id: product.id, affiliate_workspace_id: affWs.id } }, create: { product_id: product.id, producer_workspace_id: ws.id, affiliate_workspace_id: affWs.id, affiliate_user_id: aff.u.id, code: 'bruno', status: 'active' }, update: {} });

  console.log('\n✔ Seed concluído. Senha de todos: ' + PASSWORD);
  console.log('  admin@dommamart.com  (back-office)' + (admin.secret ? `  TOTP: ${admin.secret}` : ''));
  console.log('  financeiro@dommamart.com (financeiro)' + (fin.secret ? `  TOTP: ${fin.secret}` : ''));
  console.log('  produtora@demo.com   (produtora)  ' + (prod.secret ? `  TOTP: ${prod.secret}` : ''));
  console.log('  afiliado@demo.com    (afiliado, link /r/bruno/confeitaria)');
  console.log('  Checkout: /pay/confeitaria   ·   Cupom: BEMVINDO\n');
}
main().finally(() => prisma.$disconnect());
