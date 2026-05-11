import * as XLSX from "xlsx";

type SheetSpec = {
  name: string;
  title: string;
  columns: string[];
};

const SHEETS: SheetSpec[] = [
  {
    name: "Visão Geral",
    title: "Visão Geral da Operação",
    columns: ["Métrica", "Valor"],
  },
  {
    name: "Atendimentos por Canal",
    title: "Total de atendimentos por canal",
    columns: ["Canal", "Quantidade"],
  },
  {
    name: "Status dos Tickets",
    title: "Tickets novos / em andamento / finalizados",
    columns: ["Status", "Quantidade"],
  },
  {
    name: "Motivos de Contato",
    title: "Motivos de contato por canal",
    columns: ["Canal", "Motivo", "Quantidade"],
  },
  {
    name: "Reembolsos - Resumo",
    title: "Resumo de reembolsos",
    columns: ["Métrica", "Valor"],
  },
  {
    name: "Ranking % Reembolso Parcial",
    title: "Ranking dos percentuais de reembolso parcial mais aceitos",
    columns: ["Percentual", "Quantidade", "% do total"],
  },
  {
    name: "Reembolsos por Produto",
    title: "Reembolsos por produto",
    columns: ["Produto", "Quantidade"],
  },
  {
    name: "Reembolsos por Plataforma",
    title: "Reembolsos por plataforma",
    columns: ["Plataforma", "Quantidade"],
  },
  {
    name: "Motivos de Reembolso",
    title: "Motivos de reembolso por produto",
    columns: ["Produto", "Motivo", "Quantidade"],
  },
  {
    name: "Valores - Resumo",
    title: "Valores financeiros de reembolsos",
    columns: ["Tipo", "Valor (R$)"],
  },
  {
    name: "Valores por Canal",
    title: "Valor de reembolso por canal de atendimento",
    columns: ["Canal", "Valor (R$)"],
  },
  {
    name: "Valores por Produto",
    title: "Valor de reembolso por produto",
    columns: ["Produto", "Valor (R$)"],
  },
];

function formatBrDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function buildSheet(spec: SheetSpec, fromISO: string, toISO: string): XLSX.WorkSheet {
  const rows: (string | number)[][] = [
    [spec.title],
    [`Período: ${formatBrDate(fromISO)} até ${formatBrDate(toISO)}`],
    [],
    spec.columns,
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);

  const colCount = spec.columns.length;
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, colCount - 1) } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(0, colCount - 1) } },
  ];

  ws["!cols"] = spec.columns.map(() => ({ wch: 28 }));

  return ws;
}

export function exportEmptyReport(fromISO: string, toISO: string): void {
  const wb = XLSX.utils.book_new();

  for (const spec of SHEETS) {
    const ws = buildSheet(spec, fromISO, toISO);
    XLSX.utils.book_append_sheet(wb, ws, spec.name);
  }

  const fileName = `relatorio-suporte_${fromISO}_a_${toISO}.xlsx`;
  XLSX.writeFile(wb, fileName);
}
