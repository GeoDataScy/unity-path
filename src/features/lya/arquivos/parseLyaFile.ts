import * as XLSX from "xlsx";

import type { LyaArquivoParse, LyaColuna, LyaColunaTipo } from "../types";

// Parse, no browser, do arquivo que a gestora dá para a Lya.
//
// Duas saídas possíveis, decididas pela extensão (e pelo cabeçalho binário):
//
// 1) `markdown` — .md/.markdown/.txt viram texto puro em `conteudo`. A Lya lê
//    o corpo inteiro; não há linhas nem colunas.
// 2) `csv` — .csv/.tsv e planilhas que o xlsx abre (.xlsx/.xls/.ods) viram uma
//    linha por linha do arquivo, com o cabeçalho normalizado em snake_case.
//    É esse formato que vai para `lya_file_rows(data jsonb)` e que deixa a Lya
//    CRUZAR o arquivo com services/refunds no SQL.
//
// O que NÃO fazemos aqui é adivinhar: o valor da célula vai para o jsonb como
// o arquivo o entregou (texto continua texto, número de planilha continua
// número). Reinterpretar "00123" como 123 estragaria número de pedido, e
// trocar a vírgula decimal por ponto sem evidência de que o arquivo é
// brasileiro inventaria dado. A leitura fica por conta da Lya, que recebe o
// perfil das colunas junto.

/** Acima disso o navegador engasga e o upload em lotes vira um castigo. */
export const LYA_MAX_LINHAS = 50_000;
export const LYA_MAX_BYTES = 8 * 1024 * 1024;

/** Quantas linhas preenchidas bastam para inferir o tipo de uma coluna. */
const AMOSTRA_TIPO = 200;

/** Até 3 exemplos por coluna, curtos — é dica de formato, não conteúdo. */
const MAX_EXEMPLOS = 3;
const TAMANHO_EXEMPLO = 80;

const EXT_MARKDOWN = new Set(["md", "markdown", "txt"]);
const EXT_TABELA = new Set(["csv", "tsv", "xlsx", "xls", "ods"]);

/** Erro de ingestão: a mensagem já vem pronta para o toast, em pt-BR. */
export class LyaArquivoErro extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LyaArquivoErro";
  }
}

function extensao(nome: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(nome.trim());
  return m ? m[1].toLowerCase() : "";
}

// ZIP (xlsx/ods) começa com "PK" (0x50 0x4B); OLE2 (xls) começa com 0xD0 0xCF.
// Mesma checagem do parse de pedidos em espera: a extensão mente com frequência.
function pareceBinario(bytes: Uint8Array): boolean {
  return (bytes[0] === 0x50 && bytes[1] === 0x4b) || (bytes[0] === 0xd0 && bytes[1] === 0xcf);
}

/**
 * Cabeçalho → chave do jsonb. "Data do Pedido" e "DATA DO PEDIDO " viram a
 * mesma `data_do_pedido`: é essa chave que a Lya escreve no SQL, então ela
 * precisa ser previsível e digitável (sem acento, sem espaço, sem maiúscula).
 */
export function chaveDeColuna(cabecalho: string): string {
  return String(cabecalho ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Resolve cabeçalho vazio e cabeçalho repetido — o jsonb não perdoa chave dupla. */
function chavesUnicas(cabecalhos: unknown[]): string[] {
  const usadas = new Map<string, number>();
  return cabecalhos.map((c, i) => {
    const base = chaveDeColuna(String(c ?? "")) || `coluna_${i + 1}`;
    const vistas = usadas.get(base) ?? 0;
    usadas.set(base, vistas + 1);
    return vistas === 0 ? base : `${base}_${vistas + 1}`;
  });
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Data de planilha binária. O xlsx com `cellDates` entrega `Date`; quando a
 * célula não tem formato de data ele entrega o serial cru, e aí não há como
 * saber que é data — o número segue como número (ver `valorDaCelula`).
 * Usa componentes UTC porque a célula representa meia-noite na origem.
 */
function dataDaCelula(v: Date): string {
  const dia = `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  const h = v.getUTCHours();
  const m = v.getUTCMinutes();
  const s = v.getUTCSeconds();
  return h || m || s ? `${dia}T${pad(h)}:${pad(m)}:${pad(s)}` : dia;
}

/** Célula → valor do jsonb. Vazia vira `null` (é assim que o SQL pergunta por "sem valor"). */
function valorDaCelula(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return dataDaCelula(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  const texto = String(v).trim();
  return texto === "" ? null : texto;
}

function comoTexto(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return dataDaCelula(v);
  return String(v).trim();
}

// Só o que é reconhecível SEM adivinhar a origem do arquivo: número com ponto
// decimal (ou inteiro) e data ISO / dd-mm-aaaa. "1.234,56" fica como texto de
// propósito — pode ser tanto um milhar brasileiro quanto outra coisa.
const RE_NUMERO = /^-?\d+(\.\d+)?$/;
const RE_DATA = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/;
const RE_DATA_BR = /^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/;
const RE_BOOLEANO = /^(true|false|verdadeiro|falso|sim|nao|não|yes|no)$/i;

function inferirTipo(amostra: unknown[]): LyaColunaTipo {
  if (amostra.length === 0) return "texto";

  const todos = (teste: (v: unknown) => boolean) => amostra.every(teste);

  if (todos((v) => typeof v === "boolean" || RE_BOOLEANO.test(String(v)))) return "booleano";
  if (todos((v) => typeof v === "number" || RE_NUMERO.test(String(v)))) return "numero";
  if (todos((v) => typeof v !== "number" && (RE_DATA.test(String(v)) || RE_DATA_BR.test(String(v))))) return "data";
  return "texto";
}

/**
 * Perfil das colunas: o que a Lya lê ANTES de olhar as linhas para decidir se
 * vale cruzar com o banco. `preenchidas` e `distintos` varrem o arquivo
 * inteiro; o tipo sai de uma amostra (200 valores bastam e evitam varrer
 * 50.000 linhas por coluna).
 */
export function perfilarColunas(chaves: string[], linhas: Record<string, unknown>[]): LyaColuna[] {
  return chaves.map((chave) => {
    const distintos = new Set<string>();
    const exemplos: string[] = [];
    const amostra: unknown[] = [];
    let preenchidas = 0;

    for (const linha of linhas) {
      const valor = linha[chave];
      if (valor === null || valor === undefined) continue;
      preenchidas++;
      const texto = comoTexto(valor);
      if (!distintos.has(texto)) {
        distintos.add(texto);
        if (exemplos.length < MAX_EXEMPLOS) {
          exemplos.push(texto.length > TAMANHO_EXEMPLO ? `${texto.slice(0, TAMANHO_EXEMPLO)}…` : texto);
        }
      }
      if (amostra.length < AMOSTRA_TIPO) amostra.push(valor);
    }

    return { nome: chave, tipo: inferirTipo(amostra), preenchidas, distintos: distintos.size, exemplos };
  });
}

function lerMatriz(bytes: Uint8Array): unknown[][] {
  // Binário (xlsx/xls/ods): deixa o xlsx materializar datas como Date.
  // Texto (csv/tsv): lê como string com `raw` para não coagir nem reformatar
  // nada — e o separador o próprio xlsx descobre (vírgula, ponto-e-vírgula, tab).
  const workbook = pareceBinario(bytes)
    ? XLSX.read(bytes, { type: "array", cellDates: true })
    : XLSX.read(new TextDecoder("utf-8").decode(bytes), { type: "string", raw: true });

  const nome = workbook.SheetNames[0];
  if (!nome) return [];
  return XLSX.utils.sheet_to_json(workbook.Sheets[nome], { header: 1, blankrows: false, defval: "", raw: true });
}

function parseMarkdown(bytes: Uint8Array, arquivo: string): LyaArquivoParse {
  const conteudo = new TextDecoder("utf-8").decode(bytes).trim();
  if (conteudo === "") {
    throw new LyaArquivoErro("O arquivo está vazio — não há texto para a Lya ler.");
  }
  return { tipo: "markdown", arquivo, bytes: bytes.byteLength, colunas: [], linhas: [], conteudo };
}

function parseTabela(bytes: Uint8Array, arquivo: string): LyaArquivoParse {
  const matriz = lerMatriz(bytes);
  if (matriz.length === 0) {
    throw new LyaArquivoErro("Não consegui ler nenhuma linha desse arquivo. Confira se a planilha tem conteúdo na primeira aba.");
  }

  const chaves = chavesUnicas(matriz[0]);
  if (chaves.length === 0) {
    throw new LyaArquivoErro("A primeira linha do arquivo precisa ser o cabeçalho, com o nome de cada coluna.");
  }

  const linhas: Record<string, unknown>[] = [];
  for (let i = 1; i < matriz.length; i++) {
    const celulas = matriz[i] ?? [];
    if (celulas.every((c) => comoTexto(c) === "")) continue;

    const linha: Record<string, unknown> = {};
    chaves.forEach((chave, idx) => {
      linha[chave] = valorDaCelula(celulas[idx]);
    });
    linhas.push(linha);

    if (linhas.length > LYA_MAX_LINHAS) {
      throw new LyaArquivoErro(
        `Esse arquivo passa de ${LYA_MAX_LINHAS.toLocaleString("pt-BR")} linhas. Recorte a planilha (por período, por loja) e suba em partes.`,
      );
    }
  }

  if (linhas.length === 0) {
    throw new LyaArquivoErro("O arquivo só tem o cabeçalho — não há linhas de dados para a Lya consultar.");
  }

  return {
    tipo: "csv",
    arquivo,
    bytes: bytes.byteLength,
    colunas: perfilarColunas(chaves, linhas),
    linhas,
    conteudo: "",
  };
}

/**
 * Lê o arquivo escolhido pela gestora e devolve o que sobe para o banco.
 * Lança `LyaArquivoErro` com a mensagem pronta para o usuário quando o arquivo
 * não serve (grande demais, formato desconhecido, vazio).
 */
export function parseLyaFile(data: ArrayBuffer | Uint8Array, nomeArquivo: string): LyaArquivoParse {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  if (bytes.byteLength > LYA_MAX_BYTES) {
    const mb = (bytes.byteLength / (1024 * 1024)).toFixed(1).replace(".", ",");
    throw new LyaArquivoErro(
      `Esse arquivo tem ${mb} MB e o limite é 8 MB. Recorte a planilha (por período, por loja) e suba em partes.`,
    );
  }
  if (bytes.byteLength === 0) {
    throw new LyaArquivoErro("O arquivo está vazio.");
  }

  const ext = extensao(nomeArquivo);
  if (EXT_MARKDOWN.has(ext) && !pareceBinario(bytes)) return parseMarkdown(bytes, nomeArquivo);
  if (EXT_TABELA.has(ext) || pareceBinario(bytes)) return parseTabela(bytes, nomeArquivo);

  throw new LyaArquivoErro(
    "Formato não reconhecido. Aceito planilha (.csv, .tsv, .xlsx, .xls, .ods) e texto (.md, .markdown, .txt).",
  );
}
