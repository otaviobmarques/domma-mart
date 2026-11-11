import { LegalDoc, V, type Section } from '@/components/legal-doc';
import { LEGAL } from '@/lib/legal';

export const metadata = { title: 'Política de Privacidade — Domma Mart' };

const S: Section[] = [
  { id: 'quem', title: 'Quem cuida dos seus dados', body: <>
    <p>Esta Política explica como a Domma Mart, operada por <V v={LEGAL.company} label="Razão social" /> (CNPJ <V v={LEGAL.cnpj} label="CNPJ" />), trata dados pessoais, de acordo com a Lei Geral de Proteção de Dados (Lei 13.709/2018 — LGPD).</p>
    <ul>
      <li><b>Produtores, afiliados e coprodutores:</b> a Domma Mart é a <b>controladora</b> dos seus dados.</li>
      <li><b>Compradores:</b> quem decide sobre os seus dados é o <b>produtor</b> de quem você comprou (controlador). A Domma Mart trata esses dados em nome dele, como <b>operadora</b>, para processar a compra, entregar o acesso e dar suporte. Para fraude, segurança e obrigações legais, a Domma Mart também atua como controladora.</li>
    </ul>
    <p>Encarregado de dados (DPO): <V v={LEGAL.dpoName} label="Nome do encarregado" /> — <V v={LEGAL.dpoEmail} label="E-mail do encarregado" />.</p>
  </> },
  { id: 'dados', title: 'Quais dados tratamos', body: <>
    <p><b>Se você compra:</b> nome, e-mail, WhatsApp, CPF ou CNPJ, o que comprou e como pagou. Quando o banco pede confirmação no cartão (3-D Secure), também o endereço da fatura. <b>Nunca recebemos o número completo do cartão:</b> ele vai do seu navegador direto para a instituição de pagamento; guardamos só a bandeira, o final e, se você pedir, uma referência para comprar com 1 clique.</p>
    <p><b>Se você vende ou é afiliado:</b> nome, e-mail, telefone, CPF ou CNPJ, data de nascimento, endereço, profissão e renda (ou faturamento e dados do sócio, para empresas), fotos do documento e selfie, conta bancária de saque, produtos, vendas, saldo e saques.</p>
    <p><b>De todos:</b> IP, navegador, aparelho, páginas acessadas, origem da visita (UTM e link de afiliado) e registros de acesso.</p>
  </> },
  { id: 'finalidades', title: 'Para que usamos e com qual base legal', body: <div className="table-wrap"><table>
    <thead><tr><th>Para quê</th><th>Base legal (LGPD, art. 7º)</th></tr></thead>
    <tbody>
      <tr><td>Processar a compra, liberar o acesso, emitir comprovantes, reembolsos e suporte</td><td>Execução de contrato</td></tr>
      <tr><td>Cadastro do vendedor, divisão dos valores, saques e conta na instituição de pagamento</td><td>Execução de contrato</td></tr>
      <tr><td>Verificação de identidade e prevenção à lavagem de dinheiro</td><td>Obrigação legal (Lei 9.613/1998 e Circular Bacen 3.978/2020)</td></tr>
      <tr><td>Antifraude, limites de tentativas, segurança da conta e da plataforma</td><td>Legítimo interesse e proteção ao crédito</td></tr>
      <tr><td>Guarda de registros de acesso, dados fiscais e financeiros</td><td>Obrigação legal (Marco Civil da Internet e legislação tributária)</td></tr>
      <tr><td>Lembrete de Pix, boleto ou carrinho não pago</td><td>Legítimo interesse do produtor, com opção de sair em toda mensagem</td></tr>
      <tr><td>Mensagens de marketing e cartão guardado para 1 clique</td><td>Consentimento, que pode ser retirado a qualquer momento</td></tr>
      <tr><td>Medir anúncios (pixels configurados pelo produtor)</td><td>Legítimo interesse do produtor ou consentimento, conforme o caso</td></tr>
    </tbody>
  </table></div> },
  { id: 'compartilhamento', title: 'Com quem compartilhamos', body: <ul>
    <li><b>Produtor (e coprodutores) de quem você comprou:</b> recebe seus dados de comprador para entregar o produto e dar suporte. Afiliados veem as vendas que indicaram, sem os dados de contato do comprador.</li>
    <li><b>{LEGAL.paymentInstitution.charAt(0).toUpperCase() + LEGAL.paymentInstitution.slice(1)}:</b> processa pagamentos, verificação 3-D Secure, divisão dos valores e saques, e recebe os dados de cadastro dos vendedores exigidos pelo Banco Central.</li>
    <li><b>Provedores que operam a plataforma:</b> hospedagem e banco de dados (Vercel, Railway e Supabase), envio de e-mails e mensagens, proteção contra robôs (Cloudflare Turnstile) e consulta de CEP (ViaCEP, só o CEP). Eles só tratam os dados para prestar o serviço, sob contrato.</li>
    <li><b>Ferramentas de anúncio do produtor</b> (Meta, Google, TikTok), quando ele as configura na página de pagamento. Nesse caso o produtor é o responsável por esse uso.</li>
    <li><b>Autoridades públicas</b>, quando houver ordem judicial ou obrigação legal.</li>
  </ul> },
  { id: 'internacional', title: 'Transferência internacional', body: <p>Parte dos nossos servidores fica nos Estados Unidos. Essas transferências são feitas com provedores que oferecem garantias de proteção compatíveis com a LGPD (art. 33), como cláusulas contratuais e medidas de segurança, e apenas para prestar o serviço.</p> },
  { id: 'guarda', title: 'Por quanto tempo guardamos', body: <ul>
    <li><b>Registros de acesso:</b> no mínimo 6 meses (Marco Civil da Internet, art. 15).</li>
    <li><b>Dados de identidade e de operações financeiras de vendedores:</b> 5 anos após o encerramento da conta (Lei 9.613/1998).</li>
    <li><b>Dados de compras e fiscais:</b> pelo prazo exigido pela legislação tributária e de defesa do consumidor.</li>
    <li><b>Cartão guardado:</b> até você remover em “Minhas compras” ou pedir a exclusão.</li>
    <li>Passados esses prazos, os dados são apagados ou anonimizados.</li>
  </ul> },
  { id: 'seguranca', title: 'Como protegemos', body: <p>Usamos conexão segura (HTTPS), criptografia dos dados sensíveis no banco (documentos, CPF, telefone, conta bancária), senhas com algoritmo resistente, verificação em duas etapas para saques, registro de auditoria das ações administrativas e acesso aos dados restrito por função. Nenhum sistema é 100% seguro; se ocorrer um incidente que possa trazer risco relevante, avisamos os titulares e a ANPD.</p> },
  { id: 'direitos', title: 'Seus direitos', body: <>
    <p>Pela LGPD (art. 18) você pode pedir: confirmação de que tratamos seus dados, acesso, correção, anonimização ou eliminação de dados desnecessários, portabilidade, informação sobre com quem compartilhamos, revisão de decisões automatizadas e retirada do consentimento.</p>
    <ul>
      <li><b>Compradores:</b> em “Minhas compras” › “Seus dados” você baixa uma cópia dos seus dados, pede correção ou pede a exclusão; também remove cartões guardados e pode deixar de receber mensagens pelo link de cada uma.</li>
      <li><b>Produtores e afiliados:</b> em “Configurações” › “Privacidade e dados” você baixa os seus dados e pede correção ou o encerramento da conta.</li>
      <li>Também atendemos pelo e-mail <V v={LEGAL.dpoEmail} label="E-mail do encarregado" />. Respondemos em até 15 dias. Dados que a lei manda guardar só são apagados ao fim do prazo legal; depois disso, a anonimização é automática.</li>
      <li>Se você é comprador, também pode falar com o produtor, que é o controlador dos seus dados; repassamos a ele os pedidos que recebermos.</li>
    </ul>
  </> },
  { id: 'cookies', title: 'Cookies', body: <ul>
    <li><b>Essenciais:</b> mantêm você conectado ao painel ou à área de compras e protegem contra ataques. Sem eles a plataforma não funciona.</li>
    <li><b>Indicação de afiliado:</b> guardam qual afiliado indicou a compra, pelo prazo definido em cada produto, para pagar a comissão correta.</li>
    <li><b>Medição de anúncios:</b> pixels de terceiros configurados pelo produtor na página de pagamento.</li>
    <li>Você pode apagar ou bloquear cookies no seu navegador; os essenciais são necessários para entrar e comprar.</li>
  </ul> },
  { id: 'menores', title: 'Crianças e adolescentes', body: <p>A Domma Mart não é destinada a menores de 18 anos para vender ou ser afiliado. Compras para menores devem ser feitas por um responsável.</p> },
  { id: 'mudancas', title: 'Alterações desta política', body: <p>Podemos atualizar esta Política. Mudanças relevantes são avisadas por e-mail e no painel, e a data da versão fica no topo desta página.</p> },
];

export default function Page() {
  return <LegalDoc title="Política de Privacidade" intro={<p>Aqui você encontra, em linguagem simples, quais dados pessoais a Domma Mart usa, para quê, com quem compartilha, por quanto tempo guarda e como exercer os seus direitos.</p>} sections={S} />;
}
