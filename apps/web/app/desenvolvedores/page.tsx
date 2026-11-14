'use client';
import { useEffect, useState } from 'react';
import { Logo, Pill, CopyButton } from '@/components/ui';

type Spec = { servers: { url: string }[]; components: { 'x-scopes': Record<string, string> }; paths: Record<string, Record<string, { summary: string; description?: string; 'x-scope'?: string | null; parameters?: { name: string; in: string; description?: string; required?: boolean }[] }>> };

function Code({ children, copy = true }: { children: string; copy?: boolean }) {
  return <div className="relative"><pre className="num overflow-x-auto rounded-ctl bg-ink p-4 text-[13px] leading-relaxed text-white"><code>{children}</code></pre>{copy && <div className="absolute right-2 top-2"><CopyButton text={children} size="sm" /></div>}</div>;
}
const M: Record<string, string> = { get: 'bg-ok-soft text-ok', post: 'bg-action-soft text-action', patch: 'bg-warn-soft text-[#7A4500]', delete: 'bg-bad-soft text-bad' };

/** Documentação pública da API (Fase 2), com guias de Zapier e n8n. */
export default function Desenvolvedores() {
  const [spec, setSpec] = useState<Spec | null>(null);
  useEffect(() => { fetch('/api/v1/openapi.json').then(r => r.json()).then(setSpec).catch(() => {}); }, []);
  const base = spec?.servers[0]?.url ?? 'https://domma-mart.vercel.app/api/v1';
  const nav = [['inicio', 'Começo rápido'], ['autenticacao', 'Chaves e permissões'], ['formato', 'Formato, paginação e erros'], ['catalogo', 'Montar um produto'], ['endpoints', 'Endpoints'], ['webhooks', 'Webhooks e assinatura'], ['zapier', 'Zapier'], ['n8n', 'n8n']];
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 text-[15.5px] leading-relaxed text-ink">
      <a href="/" aria-label="Início"><Logo /></a>
      <h1 className="mt-6 text-[30px] font-extrabold leading-tight">API da Domma Mart</h1>
      <p className="mt-2 text-ink-soft">Ligue sua conta a qualquer sistema: consulte vendas, compradores e afiliados, crie cupons e receba eventos em tempo real. Funciona com Zapier, n8n, Make e com o seu próprio código.</p>
      <nav aria-label="Nesta página" className="mt-6 flex flex-wrap gap-2">{nav.map(([id, l]) => <a key={id} href={`#${id}`} className="rounded-full border border-line bg-white px-3 py-1 text-[14px] font-semibold text-action">{l}</a>)}</nav>

      <section id="inicio" className="mt-10 scroll-mt-6 space-y-3">
        <h2 className="text-[21px] font-extrabold">Começo rápido</h2>
        <ol className="list-decimal space-y-1 pl-5 text-ink-soft">
          <li>No painel, vá em <b>Configurações › API</b> e clique em <b>Criar chave</b> (precisa da verificação em duas etapas ligada).</li>
          <li>Escolha só as permissões de que a integração precisa e copie a chave — ela aparece uma vez.</li>
          <li>Envie a chave no cabeçalho <span className="num">Authorization</span> de cada chamada:</li>
        </ol>
        <Code>{`curl ${base}/sales?status=paid&limit=10 \\\n  -H "Authorization: Bearer dm_live_SUA_CHAVE"`}</Code>
      </section>

      <section id="autenticacao" className="mt-10 scroll-mt-6 space-y-3">
        <h2 className="text-[21px] font-extrabold">Chaves e permissões</h2>
        <p className="text-ink-soft">Cada chave pertence a uma conta e só vê os dados dela. Guarde a chave como uma senha: no servidor, nunca no navegador nem em aplicativo. Revogou, parou na hora (e os webhooks criados por ela também).</p>
        <div className="overflow-x-auto rounded-card border border-line bg-white"><table className="w-full text-left text-[14.5px]"><thead className="bg-canvas/60 text-[13px] text-ink-mute"><tr><th className="px-4 py-2">Permissão</th><th className="px-4">O que libera</th></tr></thead>
          <tbody className="divide-y divide-line">{Object.entries(spec?.components['x-scopes'] ?? {}).map(([s, l]) => <tr key={s}><td className="num px-4 py-2 font-semibold">{s}</td><td className="px-4">{l}</td></tr>)}</tbody></table></div>
        <p className="text-[14px] text-ink-mute">Limite: 120 chamadas por minuto por chave. Acima disso a resposta é 429; espere alguns segundos e tente de novo.</p>
      </section>

      <section id="formato" className="mt-10 scroll-mt-6 space-y-3">
        <h2 className="text-[21px] font-extrabold">Formato, paginação e erros</h2>
        <ul className="list-disc space-y-1 pl-5 text-ink-soft">
          <li>Valores em <b>centavos</b> (19700 = R$ 197,00). Datas em ISO 8601 (UTC). Nomes de campos em inglês, como nos webhooks.</li>
          <li>Listas vêm como <span className="num">{'{ data, has_more, next_cursor }'}</span>. Para a próxima página, repita a chamada com <span className="num">?cursor=next_cursor</span>. Mais recentes primeiro.</li>
          <li>Erros seguem o padrão problem+json, com mensagem em português e um código estável:</li>
        </ul>
        <Code copy={false}>{`HTTP 403\n{ "code": "PERMISSION_DENIED", "title": "Esta chave não tem a permissão customers:read. ...", "status": 403 }`}</Code>
      </section>

      <section id="catalogo" className="mt-10 scroll-mt-6 space-y-3">
        <h2 className="text-[21px] font-extrabold">Montar um produto pela API</h2>
        <p className="text-ink-soft">Com a permissão <span className="num">products:write</span> dá para criar o produto inteiro sem abrir o painel: oferta, conteúdo em texto ou link, oferta especial (order bump), upsell com 1 clique, materiais de afiliado e teste A/B. As regras são as mesmas do painel, inclusive a análise automática ao publicar (o produto pode voltar <span className="num">in_review</span>). Vídeos, PDFs e a capa ainda são enviados pelo painel.</p>
        <Code>{`K="Authorization: Bearer dm_live_SUA_CHAVE"; J="Content-Type: application/json"

# 1. produto + primeira oferta
curl -X POST ${base}/products -H "$K" -H "$J" \
  -d '{ "type": "course", "name": "Curso de Bolos Caseiros", "price_cents": 29700 }'
# → { "product_id": "...", "offer_id": "..." }

# 2. conteúdo
curl -X POST ${base}/products/PRODUCT_ID/modules -H "$K" -H "$J" -d '{ "title": "Começando" }'
curl -X POST ${base}/modules/MODULE_ID/lessons -H "$K" -H "$J" \
  -d '{ "title": "Boas-vindas", "kind": "text", "body": "Olá!" }'

# 3. publicar
curl -X POST ${base}/products/PRODUCT_ID/publish -H "$K"

# 4. oferta especial (order bump) no checkout — lista completa, até 3
curl -X PUT ${base}/offers/OFFER_ID/bumps -H "$K" -H "$J" \
  -d '{ "items": [{ "offer_id": "OUTRA_OFERTA", "headline": "Adicione 1 hora de consultoria" }] }'

# 5. upsell com 1 clique na página de obrigado
curl -X PUT ${base}/offers/OFFER_ID/funnel -H "$K" -H "$J" \
  -d '{ "upsell_offer_id": "OUTRA_OFERTA", "upsell_headline": "Que tal uma consultoria?" }'`}</Code>
      </section>

      <section id="endpoints" className="mt-10 scroll-mt-6 space-y-3">
        <h2 className="text-[21px] font-extrabold">Endpoints</h2>
        <p className="text-ink-soft">Base: <span className="num">{base}</span> · especificação OpenAPI: <a href="/api/v1/openapi.json" className="num font-semibold text-action">/api/v1/openapi.json</a> (importe no Postman, Insomnia ou n8n).</p>
        {!spec ? <p className="text-ink-mute">Carregando…</p> : <div className="divide-y divide-line rounded-card border border-line bg-white">{Object.entries(spec.paths).flatMap(([path, ops]) => Object.entries(ops).map(([m, o]) => (
          <div key={m + path} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2"><span className={`num rounded px-2 py-0.5 text-[12.5px] font-bold uppercase ${M[m]}`}>{m}</span><span className="num font-semibold">{path}</span><span className="text-ink-soft">— {o.summary}</span>{o['x-scope'] && <Pill>{o['x-scope']}</Pill>}</div>
            {o.parameters?.some(p => p.in === 'query') && <p className="mt-1 text-[13.5px] text-ink-mute">Filtros: {o.parameters.filter(p => p.in === 'query').map(p => p.name).join(', ')}</p>}
          </div>)))}</div>}
        <p className="text-[14px] text-ink-mute">O comprador vem com nome e e-mail. Telefone e CPF só aparecem com a permissão <span className="num">customers:read</span>.</p>
      </section>

      <section id="webhooks" className="mt-10 scroll-mt-6 space-y-3">
        <h2 className="text-[21px] font-extrabold">Webhooks e assinatura</h2>
        <p className="text-ink-soft">Cadastre a URL em <b>Configurações › Integrações</b> ou pela API (<span className="num">POST /webhooks</span>). Eventos: venda criada e paga, reembolso, contestação, Pix e boleto gerados, carrinho abandonado, assinatura renovada e cancelada, comissão de afiliado. Tentamos de novo até 6 vezes se a sua URL falhar.</p>
        <p className="text-ink-soft">O e-mail do comprador vem mascarado no webhook. Para o dado completo, busque a venda pela API com o <span className="num">order_id</span> do evento. Confira sempre a assinatura <span className="num">X-DommaMart-Signature</span>:</p>
        <Code>{`import crypto from 'node:crypto';\n\n// header: "t=1731322800,v1=<hex>"   body: corpo bruto da requisição   secret: whsec_...\nfunction valido(header, body, secret) {\n  const [t, v1] = header.split(',').map(p => p.split('=')[1]);\n  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // mais de 5 min: recuse\n  const esperado = crypto.createHmac('sha256', secret).update(\`\${t}.\${body}\`).digest('hex');\n  return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(v1));\n}`}</Code>
      </section>

      <section id="zapier" className="mt-10 scroll-mt-6 space-y-3">
        <h2 className="text-[21px] font-extrabold">Zapier</h2>
        <p className="font-semibold">Gatilho (ex.: venda aprovada → linha numa planilha)</p>
        <ol className="list-decimal space-y-1 pl-5 text-ink-soft">
          <li>No Zapier, crie um Zap com o gatilho <b>Webhooks by Zapier › Catch Hook</b> e copie a URL que ele mostra.</li>
          <li>Na Domma Mart, em <b>Configurações › Integrações</b>, adicione um webhook com essa URL e o evento <span className="num">order.paid</span>. Clique em <b>Testar</b> para o Zapier receber um exemplo.</li>
          <li>Continue o Zap normalmente (Google Sheets, CRM, e-mail…). Para telefone ou CPF, adicione um passo <b>Webhooks by Zapier › GET</b> em <span className="num">{base}/sales/{'{order_id}'}</span> com o cabeçalho <span className="num">Authorization: Bearer dm_live_…</span>.</li>
        </ol>
        <p className="font-semibold">Ação (ex.: criar cupom quando alguém entra na lista)</p>
        <p className="text-ink-soft">Use <b>Webhooks by Zapier › Custom Request</b>: método POST, URL <span className="num">{base}/coupons</span>, cabeçalhos <span className="num">Authorization</span> e <span className="num">Content-Type: application/json</span>, e o corpo:</p>
        <Code>{`{ "code": "VOLTA10", "kind": "percent", "value": 1000, "max_uses": 1 }`}</Code>
      </section>

      <section id="n8n" className="mt-10 scroll-mt-6 space-y-3">
        <h2 className="text-[21px] font-extrabold">n8n</h2>
        <ol className="list-decimal space-y-1 pl-5 text-ink-soft">
          <li><b>Gatilho:</b> adicione o nó <b>Webhook</b> (método POST) e copie a URL de produção. Cadastre-a na Domma Mart (Integrações) ou crie pela API, como abaixo.</li>
          <li><b>Credencial:</b> em Credentials, crie uma <b>Header Auth</b> com nome <span className="num">Authorization</span> e valor <span className="num">Bearer dm_live_…</span>.</li>
          <li><b>Chamadas:</b> use o nó <b>HTTP Request</b> com essa credencial. Para importar todos os endpoints de uma vez, use a especificação <span className="num">/api/v1/openapi.json</span>.</li>
        </ol>
        <Code>{`curl -X POST ${base}/webhooks \\\n  -H "Authorization: Bearer dm_live_SUA_CHAVE" -H "Content-Type: application/json" \\\n  -d '{ "url": "https://seu-n8n.com/webhook/vendas", "events": ["order.paid", "order.refunded"] }'`}</Code>
        <p className="text-[14px] text-ink-mute">A resposta traz o segredo (<span className="num">whsec_…</span>) para conferir a assinatura. Para cancelar, <span className="num">DELETE /webhooks/{'{id}'}</span>.</p>
      </section>

      <footer className="mt-12 border-t border-line pt-4 text-[13.5px] text-ink-mute">Dúvidas sobre a API? Fale com o suporte pelo WhatsApp no painel. · <a href="/termos" className="underline">Termos de Uso</a> · <a href="/privacidade" className="underline">Política de Privacidade</a></footer>
    </main>
  );
}
