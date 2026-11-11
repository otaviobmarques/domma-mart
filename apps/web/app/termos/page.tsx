import { LegalDoc, V, type Section } from '@/components/legal-doc';
import { LEGAL } from '@/lib/legal';

export const metadata = { title: 'Termos de Uso — Domma Mart' };

const S: Section[] = [
  { id: 'quem-somos', title: 'Quem somos e o que a Domma Mart faz', body: <>
    <p>A Domma Mart é uma plataforma de software, operada por <V v={LEGAL.company} label="Razão social" /> (CNPJ <V v={LEGAL.cnpj} label="CNPJ" />), que permite a <b>produtores</b> vender produtos digitais (cursos, arquivos, serviços e assinaturas), a <b>afiliados</b> e <b>coprodutores</b> receberem comissões e a <b>compradores</b> comprarem e acessarem o que compraram.</p>
    <p>A Domma Mart <b>não é banco nem instituição de pagamento</b>. Os pagamentos, a divisão dos valores e os saques são processados pela {LEGAL.paymentInstitution}, que mantém as contas de recebimento de cada vendedor.</p>
    <p>A Domma Mart <b>não é a vendedora</b> dos produtos. Quem vende é o produtor, que é o fornecedor responsável perante o comprador, inclusive pelo conteúdo, pela entrega, pelo suporte e pela nota fiscal da venda.</p>
  </> },
  { id: 'aceite', title: 'Aceite destes termos', body: <>
    <p>Ao criar uma conta ou fazer uma compra, você declara que leu e concorda com estes Termos, com a <a href="/privacidade">Política de Privacidade</a> e com a <a href="/produtos-proibidos">Política de Produtos Proibidos</a>. Registramos o aceite com a versão do documento, data, IP e navegador.</p>
  </> },
  { id: 'conta', title: 'Conta, cadastro e segurança', body: <ul>
    <li>Para vender ou ser afiliado é preciso ter <b>18 anos ou mais</b> (ou ser empresa regularmente constituída) e informar dados verdadeiros. Cada CPF ou CNPJ pode ter uma única conta.</li>
    <li>Você é responsável por manter sua senha em segredo e por tudo o que for feito com a sua conta. Saques e alterações da conta de recebimento exigem verificação em duas etapas.</li>
    <li>Avise imediatamente o suporte se perceber qualquer acesso que não reconheça.</li>
  </ul> },
  { id: 'identidade', title: 'Verificação de identidade', body: <>
    <p>Para receber o dinheiro das vendas, o vendedor precisa confirmar a identidade (documento com foto, selfie e, quando exigido pela instituição de pagamento, endereço, telefone, renda ou faturamento, conforme a Circular Bacen 3.978/2020 de prevenção à lavagem de dinheiro).</p>
    <ul>
      <li>Enquanto a identidade não é aprovada, a conta pode vender até <b>R$ 5.000,00</b> no total e <b>não pode sacar</b>.</li>
      <li>Podemos pedir documentos adicionais, recusar ou suspender cadastros com indícios de fraude, e compartilhar os dados necessários com a instituição de pagamento e com autoridades, quando exigido por lei.</li>
      <li>A conta bancária de saque precisa estar no mesmo CPF ou CNPJ da conta. Uma conta de saque nova só recebe saques 24 horas depois do cadastro.</li>
    </ul>
  </> },
  { id: 'produtos', title: 'Produtos e responsabilidade do produtor', body: <ul>
    <li>O produtor garante que tem os direitos sobre o que vende, que a descrição é verdadeira e que entregará o que foi prometido.</li>
    <li>Todo produto pode passar por moderação antes e depois de publicado. Produtos que descumpram a <a href="/produtos-proibidos">Política de Produtos Proibidos</a> são recusados ou retirados do ar.</li>
    <li>O produtor é responsável pelo atendimento ao comprador e pela emissão da nota fiscal da venda. A Domma Mart emite nota fiscal apenas sobre a sua própria taxa.</li>
  </ul> },
  { id: 'taxas', title: 'Taxas', body: <>
    <p>A Domma Mart cobra uma taxa sobre cada venda aprovada, descontada automaticamente do valor recebido:</p>
    <div className="table-wrap"><table>
      <thead><tr><th>Situação</th><th>Taxa</th></tr></thead>
      <tbody>
        <tr><td>Venda direta</td><td>4,49% + R$ 1,49</td></tr>
        <tr><td>Venda feita por afiliado</td><td>6,49% + R$ 1,49</td></tr>
        <tr><td>Venda por Pix</td><td>mesma taxa acima, com teto de R$ 14,90 por venda</td></tr>
        <tr><td>Vendas abaixo de R$ 10,00</td><td>R$ 1,99 fixos</td></tr>
        <tr><td>Contas com mais de R$ 50 mil vendidos nos últimos 30 dias</td><td>3,99% + R$ 1,49 (venda direta)</td></tr>
      </tbody>
    </table></div>
    <p>No parcelamento do cartão, os juros (2,99% ao mês) são pagos pelo comprador ou absorvidos pelo produtor, conforme a configuração da oferta; o checkout sempre mostra o valor total e o de cada parcela antes da compra. Condições negociadas por escrito prevalecem sobre esta tabela. Mudanças nas taxas são avisadas com pelo menos 30 dias de antecedência e não afetam vendas já feitas.</p>
  </> },
  { id: 'recebimentos', title: 'Recebimentos e saques', body: <>
    <p>O valor líquido de cada venda fica disponível para saque nos prazos abaixo:</p>
    <ul>
      <li><b>Pix:</b> 90% no dia seguinte ao pagamento e 10% ao fim do prazo de garantia.</li>
      <li><b>Boleto:</b> 2 dias após a compensação.</li>
      <li><b>Cartão:</b> 30 dias após a aprovação.</li>
    </ul>
    <p>O saque mínimo é de R$ 10,00, com um saque grátis por dia e limite diário definido para a conta. Para contas novas ou com risco elevado, uma parte do faturamento pode ficar retida temporariamente como reserva de segurança, informada no painel. A divisão entre produtor, coprodutores, afiliados e Domma Mart é feita automaticamente em cada venda, conforme as regras configuradas no produto.</p>
  </> },
  { id: 'garantia', title: 'Garantia, arrependimento e reembolso', body: <ul>
    <li>Todo produto tem garantia mínima de <b>7 dias</b> (direito de arrependimento do Código de Defesa do Consumidor, art. 49). O produtor pode oferecer prazo maior.</li>
    <li>Dentro da garantia, o comprador pede o reembolso em “Minhas compras”, sem precisar justificar. O acesso ao produto é encerrado quando o reembolso é confirmado.</li>
    <li>O valor reembolsado é debitado do saldo do produtor, dos coprodutores e dos afiliados na mesma proporção em que foi dividido, e a taxa da Domma Mart daquela venda é devolvida. O custo de processamento cobrado pela instituição de pagamento não é devolvido e fica com o produtor. Se o saldo não for suficiente, a diferença é descontada das vendas seguintes.</li>
  </ul> },
  { id: 'contestacoes', title: 'Contestações (chargeback) e risco', body: <ul>
    <li>Quando um comprador contesta uma compra de cartão junto ao banco, o valor da venda fica “em análise” e não pode ser sacado até a decisão. A Domma Mart envia ao banco as evidências da compra e do acesso.</li>
    <li>Se a contestação for perdida, o valor é debitado definitivamente de quem recebeu a venda.</li>
    <li>Acompanhamos as taxas de reembolso e contestação de cada conta. Acima dos limites de risco, podemos aplicar reserva de segurança, pausar o cartão de uma oferta ou bloquear a conta de forma cautelar.</li>
  </ul> },
  { id: 'afiliados', title: 'Afiliados e coprodução', body: <ul>
    <li>O afiliado divulga produtos com um link próprio e recebe a comissão definida pelo produtor nas vendas atribuídas a ele, conforme o prazo do cookie e a regra de atribuição de cada produto.</li>
    <li>Não há comissão em compras feitas pelo próprio afiliado. Também não é permitido divulgar com spam, promessas falsas, uso indevido da marca do produtor ou qualquer prática enganosa.</li>
    <li>O coprodutor recebe o percentual combinado com o produtor sobre o valor líquido das vendas, pelo período aceito no convite.</li>
  </ul> },
  { id: 'comprador', title: 'Para quem compra', body: <ul>
    <li>O checkout mostra o preço total, as parcelas, os juros, quem é o vendedor e o canal de suporte. O acesso ao produto chega no e-mail informado.</li>
    <li>Os dados do cartão são enviados diretamente à instituição de pagamento; a Domma Mart não recebe nem guarda o número do cartão. Quando você escolhe guardar o cartão para comprar com 1 clique, guardamos só uma referência, a bandeira e o final, e você pode remover quando quiser em “Minhas compras”.</li>
    <li>Dúvidas sobre o conteúdo do produto devem ser tratadas com o produtor, pelo contato mostrado na compra.</li>
  </ul> },
  { id: 'proibido', title: 'Condutas proibidas', body: <ul>
    <li>Fraude, uso de dados ou cartões de terceiros, “teste” de cartões, lavagem de dinheiro ou financiamento de atividades ilícitas.</li>
    <li>Tentar burlar limites, taxas, a verificação de identidade ou a segurança da plataforma, inclusive acessando sistemas de forma automatizada sem autorização.</li>
    <li>Vender fora da plataforma para compradores captados por ela com o objetivo de evitar a taxa.</li>
    <li>Qualquer uso que viole a lei, direitos de terceiros ou a <a href="/produtos-proibidos">Política de Produtos Proibidos</a>.</li>
  </ul> },
  { id: 'suspensao', title: 'Suspensão e encerramento', body: <>
    <p>Podemos suspender ou encerrar contas e produtos que descumpram estes Termos, com aviso e explicação do motivo, salvo quando a lei ou uma investigação impedir. Em caso de suspeita de fraude, os valores podem ficar retidos pelo tempo necessário para a apuração e para o pagamento de reembolsos e contestações.</p>
    <p>Você pode encerrar a sua conta a qualquer momento pelo suporte. O saldo disponível, descontados reembolsos e contestações pendentes, é transferido para a sua conta de saque.</p>
  </> },
  { id: 'propriedade', title: 'Propriedade intelectual', body: <p>A marca, o software e o layout da Domma Mart pertencem a <V v={LEGAL.company} label="Razão social" />. O conteúdo dos produtos pertence aos seus autores. Ao publicar um produto, o produtor autoriza a Domma Mart a armazená-lo e exibi-lo aos compradores apenas para a prestação do serviço.</p> },
  { id: 'responsabilidade', title: 'Limitação de responsabilidade', body: <p>A Domma Mart se esforça para manter a plataforma disponível e segura, mas não responde pelo conteúdo dos produtos, por promessas feitas por produtores ou afiliados, por falhas de terceiros (bancos, instituição de pagamento, provedores de internet) nem por danos indiretos. Nada nestes Termos limita os direitos do consumidor previstos em lei.</p> },
  { id: 'dados', title: 'Dados pessoais', body: <p>A Domma Mart é <b>controladora</b> dos dados dos seus usuários (produtores, afiliados e coprodutores) e <b>operadora</b> dos dados dos compradores, tratados em nome de cada produtor, que é o controlador desses dados. Os detalhes estão na <a href="/privacidade">Política de Privacidade</a>.</p> },
  { id: 'alteracoes', title: 'Alterações destes termos', body: <p>Podemos atualizar estes Termos. Mudanças relevantes são avisadas por e-mail e no painel com pelo menos 30 dias de antecedência; continuar usando a plataforma depois disso significa concordar com a nova versão.</p> },
  { id: 'foro', title: 'Lei aplicável e foro', body: <p>Estes Termos seguem as leis brasileiras. Fica eleito o foro de <V v={LEGAL.forum} label="Cidade/UF do foro" />, ressalvado o direito do consumidor de propor ação no foro do seu domicílio.</p> },
  { id: 'contato', title: 'Contato', body: <p>Suporte: <V v={LEGAL.supportEmail} label="E-mail de suporte" />. Assuntos de dados pessoais: <V v={LEGAL.dpoEmail} label="E-mail do encarregado" />.</p> },
];

export default function Page() {
  return <LegalDoc title="Termos de Uso" intro={<p>Estes Termos explicam, em linguagem simples, as regras para vender, divulgar e comprar na Domma Mart. Leia com atenção: eles valem para todos os usuários.</p>} sections={S} />;
}
