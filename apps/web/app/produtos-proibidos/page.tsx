import { LegalDoc, V, type Section } from '@/components/legal-doc';
import { LEGAL } from '@/lib/legal';

export const metadata = { title: 'Política de Produtos Proibidos — Domma Mart' };

const S: Section[] = [
  { id: 'ilegais', title: 'Conteúdo ilegal ou que viole direitos', body: <ul>
    <li>Qualquer produto ou serviço proibido pela lei brasileira, ou que incentive crimes.</li>
    <li>Pirataria: cursos, livros, softwares, músicas, filmes ou materiais de terceiros sem autorização do autor; revenda de acessos; “pacotes” com conteúdo copiado.</li>
    <li>Falsificação de documentos, diplomas, certificados ou laudos; venda de dados pessoais, listas de contatos, contas, logins ou senhas.</li>
    <li>Ferramentas ou serviços para invadir sistemas, espionar pessoas, aplicar golpes, burlar pagamentos ou distribuir vírus.</li>
  </ul> },
  { id: 'promessas', title: 'Promessas enganosas e esquemas financeiros', body: <ul>
    <li>Promessa de enriquecimento rápido, renda garantida ou ganhos sem esforço; uso de depoimentos ou resultados falsos.</li>
    <li>Pirâmide financeira, esquemas Ponzi ou “marketing multinível” em que o ganho vem do recrutamento de pessoas.</li>
    <li>Sinais, robôs ou recomendações de investimento sem o registro exigido pela CVM; captação de dinheiro de terceiros; promessas de rentabilidade.</li>
    <li>Apostas, cassinos, jogos de azar, rifas e sorteios sem a autorização exigida por lei, e métodos para “ganhar” em apostas.</li>
  </ul> },
  { id: 'saude', title: 'Saúde e segurança', body: <ul>
    <li>Promessa de cura, tratamento ou diagnóstico de doenças; substituição de acompanhamento médico, psicológico ou nutricional por um produto.</li>
    <li>Venda ou orientação de uso de medicamentos controlados, anabolizantes, drogas ou substâncias proibidas.</li>
    <li>Armas, munições, explosivos ou instruções para fabricá-los.</li>
  </ul> },
  { id: 'conteudo', title: 'Conteúdo adulto, violento ou discriminatório', body: <ul>
    <li>Pornografia, conteúdo sexual explícito ou serviços de cunho sexual.</li>
    <li>Qualquer conteúdo que envolva sexualização de crianças ou adolescentes — denunciado imediatamente às autoridades.</li>
    <li>Discurso de ódio, discriminação, incentivo à violência, ao suicídio ou à automutilação.</li>
  </ul> },
  { id: 'outros', title: 'Outros produtos não aceitos', body: <ul>
    <li>Seguidores, curtidas, avaliações ou visualizações falsas, e qualquer forma de manipulação de plataformas.</li>
    <li>Produtos físicos e ingressos (ainda não suportados pela Domma Mart).</li>
    <li>Pedidos de doação disfarçados de produto, ou produtos sem entrega real.</li>
    <li>Produtos que dependam de dados de cartão, CPF ou senhas do comprador fora do checkout da Domma Mart.</li>
  </ul> },
  { id: 'moderacao', title: 'Como fazemos a moderação', body: <>
    <p>Todo produto novo passa por uma análise automática e, quando necessário, por revisão da nossa equipe antes de começar a vender. Produtos já publicados também podem ser revistos a qualquer momento, por iniciativa nossa ou por denúncia.</p>
    <ul>
      <li>Quando um produto é recusado, explicamos o motivo e o produtor pode corrigir e enviar de novo.</li>
      <li>Violações graves ou repetidas levam à retirada do produto, à suspensão da conta e, quando houver indício de crime, à retenção dos valores e à comunicação às autoridades.</li>
      <li>Os compradores de um produto retirado por violação podem pedir reembolso, que é debitado do produtor.</li>
    </ul>
  </> },
  { id: 'denuncia', title: 'Como denunciar', body: <p>Viu um produto que descumpre esta política? Escreva para <V v={LEGAL.supportEmail} label="E-mail de suporte" /> com o link da página de pagamento e o motivo. Toda denúncia é analisada e a identidade de quem denuncia é preservada.</p> },
];

export default function Page() {
  return <LegalDoc title="Política de Produtos Proibidos" intro={<><p>Para proteger compradores, produtores e a própria plataforma, alguns produtos e serviços não podem ser vendidos nem divulgados na Domma Mart. A lista abaixo traz exemplos; na dúvida, fale com o suporte antes de publicar.</p><p>Esta política faz parte dos <a href="/termos">Termos de Uso</a>.</p></>} sections={S} />;
}
