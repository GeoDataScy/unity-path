// Planilha da aba Late Hunter. A tabela é paginada no servidor, então a
// exportação pede ao banco TODAS as linhas com os mesmos filtros da tela (a
// mesma RPC, outro limite) — nunca só a página aberta.
import * as XLSX from "xlsx";

import { enderecoLinha, formatDay, motivoLabel, parseItems } from "./format";
import { fetchLateHunterList, listArgs } from "./useLateHunterQueries";
import type { LateHunterAmbiente, LateHunterFiltros, LateHunterOrder } from "./types";

/** Teto da RPC para a exportação. */
const LIMITE_EXPORTACAO = 10000;

function todayInSaoPaulo(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

export function lateHunterSheetRows(rows: LateHunterOrder[]): Record<string, string | number>[] {
  return rows.map((o) => ({
    Pedido: o.pedido,
    Loja: o.loja,
    Produto: o.loja_nome ?? "",
    Motivo: o.motivos.map(motivoLabel).join(", "),
    "Motivo (ShipOffers)": o.motivo,
    Cliente: o.cliente_nome,
    "E-mail": o.cliente_email,
    País: o.pais ?? "",
    Endereço: enderecoLinha(o.endereco),
    Itens: parseItems(o.itens)
      .map((i) => `${i.sku} × ${i.qty}`)
      .join(", "),
    "Data do pedido": formatDay(o.data_pedido),
    "Dias em espera": o.dias_em_espera ?? "",
    "No Late Hunter desde": formatDay(o.primeira_referencia),
    "Último lote": formatDay(o.ultima_referencia),
    Situação: o.situacao === "encerrado" ? "Saiu do hold" : "Em on-hold",
    "Saiu em": o.situacao === "encerrado" ? formatDay(o.encerrado_referencia) : "",
    "Voltou ao hold (vezes)": o.vezes_reaberto,
  }));
}

/** Busca tudo o que os filtros pegam e baixa o .xlsx. Devolve quantas linhas foram. */
export async function exportLateHunter(ambiente: LateHunterAmbiente, filtros: LateHunterFiltros): Promise<number> {
  const { rows, total } = await fetchLateHunterList(listArgs(ambiente, filtros, LIMITE_EXPORTACAO, 0));
  if (total > rows.length) {
    throw new Error(`Filtro pega ${total} pedidos; a planilha aceita até ${LIMITE_EXPORTACAO}. Estreite os filtros.`);
  }
  const sheet = XLSX.utils.json_to_sheet(lateHunterSheetRows(rows));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Late Hunter");
  const sufixo = ambiente === "homologacao" ? "-homologacao" : "";
  XLSX.writeFile(book, `late-hunter${sufixo}-${todayInSaoPaulo()}.xlsx`);
  return rows.length;
}
