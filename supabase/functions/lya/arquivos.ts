// Interpretação de arquivos da Lya — onde uma planilha crua vira cognição.
//
// A ingestão acontece no browser (parse + lya_criar_arquivo + lya_inserir_linhas).
// Quando as linhas já estão no banco, a tela chama a ação `arquivo_interpretar`
// desta função e é AQUI que o arquivo ganha sentido: uma chamada única ao Claude
// lê o perfil das colunas e uma amostra, escreve o que o arquivo É, o que cada
// coluna significa no vocabulário do XMX Suporte e como cruzá-lo com
// services/refunds/held_orders. O resultado vai para dois lugares:
//   1. `lya_finalizar_arquivo` — o resumo e as tags que a gestora lê no acervo;
//   2. `lya_upsert_memory` com origem 'arquivo' — o NÓ DE COGNIÇÃO no cérebro,
//      que é o que faz a Lya "lembrar" do arquivo numa conversa futura sem que
//      ninguém o anexe de novo.
//
// Princípio que manda neste arquivo: ARQUIVO NUNCA FICA ÓRFÃO. Se o modelo
// falhar, estourar o tempo ou devolver lixo, montamos o resumo em código (nome,
// tipo, nº de linhas, colunas) e seguimos: finalizamos o arquivo e criamos a
// memória assim mesmo. O caminho de erro entrega menos, nunca nada.
//
// O mesmo arquivo subido de novo ATUALIZA o nó em vez de duplicar: o slug da
// memória é derivado do nome (`arquivo-<slug>`) e o upsert é por slug.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { anthropic, TRAINER_MODEL } from "./anthropic.ts";
import { REGRAS_DO_SISTEMA } from "./prompt.ts";
import { slugify } from "./tools.ts";

// Amostra que vai ao modelo. 20 linhas bastam para ele ver o formato de cada
// coluna; o perfil (distintos/exemplos) já resume o resto.
const AMOSTRA_LINHAS = 20;
// Teto de parede da interpretação. Acima disso o fallback em código é melhor do
// que deixar a tela de upload girando.
const TIMEOUT_MS = 45_000;
// Markdown grande: o modelo só precisa do começo para dizer o que o documento é.
const MAX_CHARS_CONTEUDO = 8_000;
// Teto do corpo da memória — ela entra no system prompt de turnos futuros.
const MAX_CHARS_MEMORIA = 6_000;

export interface PerfilColuna {
  nome: string;
  tipo?: string;
  preenchidas?: number;
  distintos?: number;
  exemplos?: string[];
}

interface ColunaExplicada {
  coluna: string;
  significado: string;
}

interface Cruzamento {
  coluna_arquivo: string;
  alvo: string;
  sql_exemplo: string;
}

export interface Interpretacao {
  resumo: string;
  tags: string[];
  o_que_tem: ColunaExplicada[];
  como_cruzar: Cruzamento[];
}

export interface ResultadoInterpretacao {
  arquivo: Record<string, unknown>;
  memoria: { name: string; description: string; type: string; tags: string[] } | null;
  /** false = o resumo foi montado em código porque o modelo não respondeu. */
  interpretado: boolean;
  /** O que degradou sem derrubar a ingestão (para a tela avisar por toast). */
  avisos: string[];
}

// ── A chamada ao modelo ─────────────────────────────────────────────────────

const TOOL = {
  name: "registrar_interpretacao",
  description: "Registra o que a Lya entendeu do arquivo: o que ele é, o que cada coluna significa e como cruzá-lo com o banco do XMX Suporte.",
  input_schema: {
    type: "object" as const,
    properties: {
      resumo: {
        type: "string",
        description: "2 a 4 frases em PT-BR: o que É este arquivo, de onde ele parece vir e para que serve no dia a dia do suporte.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "3 a 8 palavras-chave minúsculas, sem acento, estilo slug — as palavras que a gestora usaria ao perguntar sobre este arquivo.",
      },
      o_que_tem: {
        type: "array",
        description: "Uma entrada por coluna do arquivo, na ordem em que aparecem.",
        items: {
          type: "object",
          properties: {
            coluna: { type: "string", description: "Nome da coluna EXATAMENTE como veio (chave do jsonb)." },
            significado: { type: "string", description: "O que essa coluna é no vocabulário do XMX Suporte, em uma frase. Cite o formato quando importar." },
          },
          required: ["coluna", "significado"],
        },
      },
      como_cruzar: {
        type: "array",
        description: "Só as colunas que REALMENTE casam com dado da plataforma. Se nenhuma casar, devolva lista vazia — não invente correspondência.",
        items: {
          type: "object",
          properties: {
            coluna_arquivo: { type: "string", description: "Coluna do arquivo." },
            alvo: { type: "string", description: "Coluna do banco com que ela casa (ex.: services.client_email, refunds.order_id, held_orders.order_number)." },
            sql_exemplo: { type: "string", description: "SELECT de exemplo do JOIN, já com o file_id real no WHERE. Uma instrução, sem ';'." },
          },
          required: ["coluna_arquivo", "alvo"],
        },
      },
    },
    required: ["resumo", "tags", "o_que_tem", "como_cruzar"],
  },
};

const SYSTEM = `Você é a Lya, assistente de inteligência do Painel da Gestora do suporte da XMX Corp ("XMX Suporte").
A gestora acabou de subir um arquivo (planilha ou documento) para o seu acervo. Seu trabalho agora é ENTENDER esse
arquivo e registrar o entendimento — é isso que vai ficar no seu cérebro e permitir que você o use em conversas
futuras sem que ninguém o anexe de novo.

Você recebe: nome, tipo, nº de linhas, o PERFIL de cada coluna (tipo inferido, quantas linhas preenchidas, quantos
valores distintos, até 3 exemplos) e uma AMOSTRA das primeiras linhas. Para documento, o começo do texto.

O que fazer:
- resumo: 2 a 4 frases dizendo o que o arquivo É (relatório da plataforma de venda? lista de pedidos? procedimento
  escrito?), o que cada linha representa e para que ele serve no suporte. Nada de floreio.
- tags: as palavras que a gestora usaria ao perguntar sobre isto depois (inclua sinônimos: "reembolso"/"estorno",
  "pedido"/"order", "atendimento"/"ticket").
- o_que_tem: coluna por coluna, o que ela significa NO VOCABULÁRIO DO XMX SUPORTE (e-mail de cliente, nº de pedido,
  produto, canal, plataforma de venda, motivo, data, valor, agente). Use as regras do sistema abaixo para nomear as
  coisas do jeito que o time nomeia.
- como_cruzar: as colunas que casam com dado da plataforma e o SQL do JOIN.

COMO AS LINHAS FICAM NO BANCO (isto define o SQL que você escreve):
- Cada linha do arquivo é uma linha em lya_file_rows(file_id uuid, linha int, data jsonb).
- As colunas são chaves de \`data\` em snake_case. data->>'coluna' devolve SEMPRE texto — faça o cast quando for
  número ou data: (data->>'valor')::numeric, (data->>'data_pedido')::date. Célula vazia é NULL.
- TODA consulta precisa de WHERE file_id = '<uuid deste arquivo>' — sem isso você mistura arquivos diferentes.
- Casamentos que valem a pena: e-mail do cliente -> services.client_email; nº de pedido -> refunds.order_id ou
  held_orders.order_number; produto -> services.product / refunds.product. Compare com lower(btrim(...)) dos dois
  lados: o texto do arquivo vem sujo (maiúscula, espaço sobrando).

REGRAS:
- Descreva SÓ o que está no arquivo. Não invente colunas, nem valores, nem correspondência com o banco que os dados
  não sustentem — lista vazia em como_cruzar é uma resposta válida e honesta.
- Escreva em português do Brasil.

${REGRAS_DO_SISTEMA}`;

function cortar(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "\n…(cortado)";
}

function listaDeTextos(v: unknown, max = 8): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((t) => String(t ?? "").trim()).filter(Boolean).slice(0, max);
}

/** Normaliza o perfil que veio do banco — o parse é do browser, não confie nele. */
function perfilColunas(v: unknown): PerfilColuna[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      const nome = String(o.nome ?? "").trim();
      if (!nome) return null;
      return {
        nome,
        tipo: o.tipo ? String(o.tipo) : "texto",
        preenchidas: Number(o.preenchidas ?? 0) || 0,
        distintos: Number(o.distintos ?? 0) || 0,
        exemplos: listaDeTextos(o.exemplos, 3),
      } as PerfilColuna;
    })
    .filter((c): c is PerfilColuna => c !== null);
}

async function pedirInterpretacao(entrada: Record<string, unknown>): Promise<Interpretacao | null> {
  try {
    const resp = await anthropic().messages.create(
      {
        model: TRAINER_MODEL,
        max_tokens: 4096,
        output_config: { effort: "low" },
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [{ role: "user", content: "Arquivo subido para o acervo da Lya:\n" + JSON.stringify(entrada, null, 2) }],
      },
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    const bloco = resp.content.find((b) => b.type === "tool_use");
    if (!bloco || bloco.type !== "tool_use") return null;
    const saida = bloco.input as Record<string, unknown>;
    const resumo = String(saida.resumo ?? "").trim();
    if (!resumo) return null; // sem resumo não há interpretação — cai no fallback
    return {
      resumo,
      tags: listaDeTextos(saida.tags).map((t) => slugify(t, 40)).filter(Boolean),
      o_que_tem: (Array.isArray(saida.o_que_tem) ? saida.o_que_tem : [])
        .map((c) => {
          const o = (c ?? {}) as Record<string, unknown>;
          return { coluna: String(o.coluna ?? "").trim(), significado: String(o.significado ?? "").trim() };
        })
        .filter((c) => c.coluna && c.significado),
      como_cruzar: (Array.isArray(saida.como_cruzar) ? saida.como_cruzar : [])
        .map((c) => {
          const o = (c ?? {}) as Record<string, unknown>;
          return {
            coluna_arquivo: String(o.coluna_arquivo ?? "").trim(),
            alvo: String(o.alvo ?? "").trim(),
            sql_exemplo: String(o.sql_exemplo ?? "").trim(),
          };
        })
        .filter((c) => c.coluna_arquivo && c.alvo),
    };
  } catch {
    return null; // quem chama monta o resumo em código
  }
}

// ── Fallback: a interpretação que o código consegue escrever sozinho ────────
//
// Não é um placeholder: nome, tipo, nº de linhas e nomes das colunas já tornam
// o arquivo encontrável no acervo e no recall. O que falta é a leitura de
// negócio — e isso a gestora pode corrigir renomeando/editando o resumo.
function interpretacaoDeReserva(
  nome: string,
  tipo: string,
  total: number,
  colunas: PerfilColuna[],
  conteudo: string,
): Interpretacao {
  const linhas = total.toLocaleString("pt-BR");
  const resumo = tipo === "markdown"
    ? `Documento "${nome}" no acervo da Lya, com ${conteudo.length.toLocaleString("pt-BR")} caracteres de texto. ` +
      `A leitura automática do conteúdo não rodou na ingestão, então este resumo foi montado pelo sistema — o texto ` +
      `está inteiro no arquivo e pode ser lido com a ferramenta de arquivos.`
    : `Planilha "${nome}" no acervo da Lya, com ${linhas} linha(s) e ${colunas.length} coluna(s)` +
      (colunas.length ? `: ${colunas.map((c) => c.nome).join(", ")}.` : ".") +
      ` A interpretação automática não rodou na ingestão, então este resumo foi montado pelo sistema a partir do ` +
      `perfil das colunas — as linhas estão no banco e podem ser consultadas e cruzadas normalmente.`;
  return {
    resumo,
    tags: [slugify(nome, 40), tipo === "markdown" ? "documento" : "planilha"].filter(Boolean),
    o_que_tem: colunas.map((c) => ({
      coluna: c.nome,
      significado: `Coluna do tipo ${c.tipo || "texto"}, ${c.preenchidas ?? 0} linha(s) preenchida(s), ` +
        `${c.distintos ?? 0} valor(es) distinto(s)` + (c.exemplos?.length ? `. Exemplos: ${c.exemplos.join(", ")}` : "") + ".",
    })),
    como_cruzar: [],
  };
}

// ── O corpo da memória (o nó de cognição) ───────────────────────────────────
//
// Escrito para o RECALL: quem lê isto num turno futuro precisa saber o que o
// arquivo é, o que cada coluna significa e — principalmente — o SQL exato para
// consultá-lo. Por isso o file_id vai literal no texto: a Lya copia dali.
function corpoDaMemoria(
  nome: string,
  arquivoOriginal: string,
  tipo: string,
  fileId: string,
  total: number,
  colunas: PerfilColuna[],
  interp: Interpretacao,
): string {
  const partes: string[] = [];
  const cabecalho = tipo === "markdown"
    ? `Documento "${nome}" (arquivo ${arquivoOriginal}) no acervo de arquivos da Lya. file_id: ${fileId}.`
    : `Planilha "${nome}" (arquivo ${arquivoOriginal}) no acervo de arquivos da Lya: ${total.toLocaleString("pt-BR")} linha(s), ` +
      `${colunas.length} coluna(s). file_id: ${fileId}.`;
  partes.push(cabecalho);
  partes.push(`O QUE É: ${interp.resumo}`);

  if (interp.o_que_tem.length) {
    const porNome = new Map(colunas.map((c) => [c.nome, c]));
    partes.push(
      "COLUNAS (chave em lya_file_rows.data -> o que significa no XMX Suporte):\n" +
        interp.o_que_tem
          .map((c) => {
            const perfil = porNome.get(c.coluna);
            const ex = perfil?.exemplos?.length ? ` Ex.: ${perfil.exemplos.join(" | ")}.` : "";
            return `- ${c.coluna} → ${c.significado}${ex}`;
          })
          .join("\n"),
    );
  }

  if (tipo !== "markdown") {
    partes.push(
      "COMO CONSULTAR: as linhas estão em lya_file_rows(file_id, linha, data jsonb), uma por linha do arquivo, com as\n" +
        `colunas como chaves de data. Use consultar_banco e SEMPRE filtre por file_id:\n` +
        `SELECT r.linha, r.data FROM lya_file_rows r WHERE r.file_id = '${fileId}' ORDER BY r.linha LIMIT 50\n` +
        "data->>'coluna' devolve texto — faça o cast para número/data quando for calcular.",
    );
  }

  if (interp.como_cruzar.length) {
    partes.push(
      "COMO CRUZAR COM A PLATAFORMA:\n" +
        interp.como_cruzar
          .map((c) => `- ${c.coluna_arquivo} casa com ${c.alvo}.${c.sql_exemplo ? `\n  ${c.sql_exemplo.replace(/\s*\n\s*/g, " ")}` : ""}`)
          .join("\n"),
    );
  }

  return cortar(partes.join("\n\n"), MAX_CHARS_MEMORIA);
}

// ── O fluxo da ação `arquivo_interpretar` ───────────────────────────────────

/**
 * Lê o arquivo, interpreta, finaliza e cria/atualiza o nó de cognição.
 *
 * Lança só quando não há mais o que fazer aqui (não conseguiu LER o arquivo ou
 * não conseguiu FINALIZÁ-LO) — nesses casos quem chamou (a tela de upload) tem
 * o próprio fallback de `lya_finalizar_arquivo` com o perfil do parse. Falha do
 * modelo ou da memória vira aviso, não exceção.
 */
export async function interpretarArquivo(supabase: SupabaseClient, fileId: string): Promise<ResultadoInterpretacao> {
  const avisos: string[] = [];

  const { data: lido, error: erroLeitura } = await supabase.rpc("lya_get_file", { p_file_id: fileId, p_amostra: AMOSTRA_LINHAS });
  if (erroLeitura) throw new Error(`Não consegui ler o arquivo: ${String(erroLeitura.message || "").slice(0, 300)}`);
  const arq = (lido ?? {}) as Record<string, unknown>;
  if (!arq.id) throw new Error("Arquivo não encontrado no acervo da Lya.");

  const arquivoOriginal = String(arq.arquivo ?? "");
  const nome = String(arq.nome ?? "").trim() || arquivoOriginal || "arquivo";
  const tipo = String(arq.tipo ?? "csv");
  const total = Number(arq.total_linhas ?? 0) || 0;
  const colunas = perfilColunas(arq.colunas);
  const conteudo = String(arq.conteudo ?? "");
  const amostra = Array.isArray(arq.amostra) ? (arq.amostra as unknown[]).slice(0, AMOSTRA_LINHAS) : [];

  const interpretada = await pedirInterpretacao({
    nome,
    arquivo: arquivoOriginal,
    tipo,
    file_id: fileId,
    total_linhas: total,
    colunas,
    amostra,
    conteudo: tipo === "markdown" ? cortar(conteudo, MAX_CHARS_CONTEUDO) : "",
  });
  if (!interpretada) avisos.push("A interpretação automática não respondeu — o resumo do arquivo foi montado pelo sistema.");
  const interp = interpretada ?? interpretacaoDeReserva(nome, tipo, total, colunas, conteudo);

  // Reenviamos colunas e total: os parâmetros de `lya_finalizar_arquivo` têm
  // default vazio e sobrescrevem a linha — omiti-los zeraria o perfil do parse.
  const { data: finalizado, error: erroFim } = await supabase.rpc("lya_finalizar_arquivo", {
    p_file_id: fileId,
    p_colunas: colunas,
    p_total: total,
    p_resumo: interp.resumo,
    p_tags: interp.tags,
    p_erro: null,
  });
  if (erroFim) throw new Error(`Não consegui finalizar o arquivo: ${String(erroFim.message || "").slice(0, 300)}`);

  // Nó de cognição. Slug estável derivado do nome: subir o MESMO arquivo de novo
  // atualiza este nó em vez de encher o cérebro de duplicatas.
  const slug = `arquivo-${slugify(nome, 48) || slugify(arquivoOriginal, 48) || fileId.slice(0, 8)}`;
  const tags = Array.from(new Set(["arquivo", ...interp.tags])).slice(0, 10);
  let memoria: ResultadoInterpretacao["memoria"] = null;
  const { data: mem, error: erroMem } = await supabase.rpc("lya_upsert_memory", {
    p_name: slug,
    p_description: `Arquivo "${nome}" no acervo da Lya${tipo === "markdown" ? "" : ` (${total.toLocaleString("pt-BR")} linhas)`}`,
    p_type: "reference",
    p_tags: tags,
    p_body: corpoDaMemoria(nome, arquivoOriginal, tipo, fileId, total, colunas, interp),
    p_origem: "arquivo",
    p_file_id: fileId,
  });
  if (erroMem) {
    avisos.push(`O arquivo entrou no acervo, mas não virou memória no cérebro: ${String(erroMem.message || "").slice(0, 200)}`);
  } else {
    const row = (mem ?? {}) as Record<string, unknown>;
    memoria = {
      name: String(row.name ?? slug),
      description: String(row.description ?? ""),
      type: String(row.type ?? "reference"),
      tags: Array.isArray(row.tags) ? (row.tags as unknown[]).map(String) : tags,
    };
  }

  return {
    arquivo: (finalizado ?? {}) as Record<string, unknown>,
    memoria,
    interpretado: interpretada !== null,
    avisos,
  };
}
