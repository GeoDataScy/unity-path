/**
 * Playbook de reembolso — escada de retenção, exceções, perfis de cliente e
 * frases de apoio.
 *
 * Conteúdo fixo no código (não entra no admin da gestora nesta primeira entrega).
 * É procedimento, não catálogo: muda com pouca frequência e precisa de revisão
 * antes de mudar. Para alterar, editar aqui e subir um deploy.
 */

export const TYPEFORM_URL = "https://form.typeform.com/to/VJ0rC2ZS";

export const REGRA_OBRIGATORIA =
  "Todo pedido de reembolso deve seguir a sequência: 30% → 40% → 50%. Nunca pule etapas sem autorização. O formulário Typeform é obrigatório após a recusa das três ofertas. Reembolsos integrais não devem ser concedidos em atendimentos comuns.";

export type FunilStep = {
  numero: string;
  titulo: string;
  /** Selo à direita do título: percentual da oferta ou rótulo da etapa. */
  selo: string;
  descricao: string;
  frase?: string;
  tags: string[];
  typeform?: boolean;
};

export const FUNIL_STEPS: FunilStep[] = [
  {
    numero: "01",
    titulo: "1ª Oferta",
    selo: "30%",
    descricao:
      "Primeira tentativa obrigatória. Apresentar como condição especial conseguida para o caso do cliente, de forma empática e personalizada.",
    frase:
      "Entendo sua situação e quero encontrar a melhor solução para você. Consegui uma condição especial de 30% de reembolso imediato, sem necessidade de devolução.",
    tags: ["Âncora inicial", "Empatia", "Sem devolução"],
  },
  {
    numero: "02",
    titulo: "2ª Oferta",
    selo: "40%",
    descricao:
      "Segunda tentativa após recusa. Apresentar como uma melhoria conquistada individualmente, reforçando que o caso foi analisado com atenção.",
    frase:
      "Revisei sua solicitação com atenção e consegui melhorar para 40% de reembolso. Você mantém o produto e recebe o valor de volta sem precisar devolver nada.",
    tags: ["Concessão", "Reciprocidade", "Esforço pessoal"],
  },
  {
    numero: "03",
    titulo: "3ª Oferta",
    selo: "50%",
    descricao:
      "Terceira e última tentativa antes do formulário. Criar senso de urgência e apresentar como a melhor alternativa disponível antes do processo formal.",
    frase:
      "Gostaria de apresentar uma alternativa antes de seguirmos com o processo completo. Temos uma condição de 50% que resolve isso de forma rápida e sem custos adicionais para você.",
    tags: ["Urgência", "Última oferta", "Conveniência"],
  },
  {
    numero: "04",
    titulo: "Formulário Typeform",
    selo: "Obrigatório",
    descricao:
      "Envio obrigatório após recusa das três ofertas. O cliente deve preencher o formulário e enviar o código gerado ao final para o suporte. Obrigatório antes de abrir processo de RMA.",
    frase:
      "Para prosseguirmos com o processo de reembolso, precisamos que você preencha o formulário abaixo. Ao finalizar, você receberá um código de confirmação — envie-o para nós.",
    tags: ["Compliance", "Pré-RMA obrigatório"],
    typeform: true,
  },
  {
    numero: "05",
    titulo: "Oferta automática dentro do Typeform",
    selo: "75%",
    descricao:
      "Durante o preenchimento do Typeform, o próprio formulário apresenta automaticamente uma oferta de 75% de reembolso ao cliente em uma das perguntas. O atendente não precisa fazer nada — é um processo automático do formulário. Se o cliente aceitar o 75% dentro do Typeform, o processo de RMA não é aberto.",
    tags: ["Automático", "Dentro do formulário", "Sem ação do prestador"],
    typeform: true,
  },
  {
    numero: "06",
    titulo: "Reembolso RMA",
    selo: "80%",
    descricao:
      "Se o cliente recusar a oferta de 75%, prosseguir com o processo formal de RMA. Reembolso de 80% após recebimento e conferência da devolução.",
    frase:
      "Vamos prosseguir com o processo de RMA. O reembolso de 80% será processado após a conferência do produto devolvido. O prazo pode levar até 60 dias úteis dependendo da administradora.",
    tags: ["RMA formal", "Devolução", "Encerramento"],
  },
];

export type Excecao = {
  titulo: string;
  quando: string;
  comoAgir: string;
  detalhe?: string;
  /** Cor do topo do card — verde (médico), roxo (duplicada), âmbar (upsell). */
  tom: "verde" | "roxo" | "ambar";
  larguraTotal?: boolean;
};

export const EXCECOES: Excecao[] = [
  {
    titulo: "🏥 Caso Médico → 80%",
    quando:
      "Restrição médica · Reação adversa · Contraindicação com medicamentos · Orientação médica para interromper o uso.",
    comoAgir:
      "Não percorrer a escada. Oferecer diretamente 80% de reembolso. Registrar as informações fornecidas pelo cliente.",
    tom: "verde",
  },
  {
    titulo: "🔁 Compra Duplicada → 100%",
    quando: "Confirmação de compra duplicada pelo cliente.",
    comoAgir:
      "Reembolso integral de 100%. Não seguir a escada. Usar procedimento específico para compras duplicadas.",
    tom: "roxo",
  },
  {
    titulo: "📦 Reclamação de Upsell → Valor integral do upsell",
    quando:
      "Cliente satisfeito com o produto principal mas insatisfeito somente com o upsell. Quer reembolso especificamente dessa compra adicional.",
    detalhe:
      "Oferecer o reembolso do valor exato pago no upsell — sem escada de porcentagem, sem envolver o pedido principal. Exemplo: Pedido total = $300 · Upsell = $60 → Reembolso = $60. O prestador identifica o valor do upsell no sistema, confirma com o cliente e processa o reembolso desse valor específico. O produto principal não é afetado.",
    comoAgir:
      "\"Entendo que a experiência com o produto adicional não foi a esperada. Vou verificar aqui o valor exato que você pagou pelo upsell e processar o reembolso integral desse valor, sem afetar seu pedido principal.\"",
    tom: "ambar",
    larguraTotal: true,
  },
];

export type PerfilCliente = {
  titulo: string;
  comoIdentificar: string;
  comoResponder: string;
};

export const PERFIS_CLIENTE: PerfilCliente[] = [
  {
    titulo: "😢 Emocional",
    comoIdentificar: "Valide os sentimentos antes de apresentar qualquer oferta.",
    comoResponder:
      "\"Entendo sua frustração e quero ajudá-lo a resolver isso da melhor forma possível.\"",
  },
  {
    titulo: "📊 Pragmático",
    comoIdentificar: "Foque em números, objetividade e ausência de etapas adicionais.",
    comoResponder: "\"Posso apresentar uma solução imediata sem necessidade de etapas adicionais.\"",
  },
  {
    titulo: "😤 Agressivo",
    comoIdentificar: "Mantenha calma e profissionalismo. Nunca responda no mesmo tom.",
    comoResponder: "Tom calmo e controlado. Frase curta, empática, sem confronto direto.",
  },
  {
    titulo: "😊 Colaborativo",
    comoIdentificar: "Use reciprocidade — o cliente já está disposto a ouvir.",
    comoResponder:
      "\"Agradeço sua compreensão e por isso consegui uma condição diferenciada para seu caso.\"",
  },
];

export const FRASES_APOIO: Array<{ tipo: string; frase: string }> = [
  { tipo: "Cuidado pessoal", frase: "Posso cuidar pessoalmente do seu caso." },
  { tipo: "Atenção individual", frase: "Revisei sua solicitação com atenção." },
  { tipo: "Solução adequada", frase: "Quero encontrar a solução mais adequada para você." },
  {
    tipo: "Alternativa rápida",
    frase: "Temos uma alternativa que pode atender sua necessidade de forma mais rápida.",
  },
  { tipo: "Disponibilidade", frase: "Estou aqui para ajudar e facilitar esse processo." },
  {
    tipo: "Condição especial",
    frase: "Consegui uma condição especial que pode resolver sua solicitação de forma rápida.",
  },
];

/** Links externos que o time usa no dia a dia (sidebar "Links Rápidos" do HTML). */
export const LINKS_RAPIDOS: Array<{ grupo: string; label: string; url: string }> = [
  { grupo: "Checkout", label: "BuyGoods Admin", url: "https://admin.buygoods.com/" },
  { grupo: "Checkout", label: "CartPanda", url: "https://accounts.cartpanda.com/" },
  { grupo: "Checkout", label: "ClickBank", url: "https://accounts.clickbank.com/" },
  {
    grupo: "Checkout",
    label: "Digistore24",
    url: "https://www.digistore24.com/login/UaHR0cHM6Ly93d3cuZGlnaXN0b3JlMjQtYXBwLmNvbS9hY2Nlc3NfMjY2NzUvZGFzaGJvYXJkLw_e_e",
  },
  { grupo: "Checkout", label: "SparkCRM", url: "https://app.sparkcrm.io/" },
  { grupo: "Checkout", label: "CheckoutChamp CRM", url: "https://crm.checkoutchamp.com/" },
  { grupo: "Atendimento", label: "SlickText", url: "https://app.slicktext.com/" },
  { grupo: "Atendimento", label: "XMX Desk", url: "https://xmxdesk.vercel.app/" },
];
