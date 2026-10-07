import { useMemo, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { formatMesPorExtenso, formatPrazoContratual, saoPauloMonthStart } from "./format";
import { useSlaAderenciaQuery } from "./useSlaAderenciaQuery";
import { useSlaRelatorioQuery } from "./useSlaRelatorioQuery";

const MESES_NO_SELETOR = 12;
const META_ADERENCIA = 95;

function formatData(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR");
}

function formatPct(pct: number | null): string {
  return pct === null ? "—" : `${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

/**
 * Relatório do mês fechado (doc XMX-2026/IMP-SUP-01-A v2): volume × capacidade
 * do pacote, os três prazos contratuais por caso e a aderência à Base de Suporte
 * apurada pela Imperium. O mês anterior libera no 3º dia útil (regra na RPC).
 */
export function MonthlyReportSection({ userId }: { userId: string | null }) {
  const meses = useMemo(
    () => Array.from({ length: MESES_NO_SELETOR }, (_, i) => saoPauloMonthStart(-(i + 1))),
    [],
  );
  const [month, setMonth] = useState(meses[0]);

  const enabled = Boolean(userId);
  const relatorio = useSlaRelatorioQuery({ enabled, month });
  const aderencia = useSlaAderenciaQuery({ enabled, month, userId });
  const r = relatorio.data;

  return (
    <section className="mt-6" aria-label="Relatório do mês">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base font-medium">Relatório do mês</CardTitle>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-full sm:w-56" aria-label="Mês do relatório">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {meses.map((m) => (
                <SelectItem key={m} value={m}>
                  {formatMesPorExtenso(m.slice(0, 7))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {relatorio.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : relatorio.isError || !r ? (
            <p className="text-sm text-muted-foreground">Não foi possível carregar o relatório agora.</p>
          ) : !r.disponivel ? (
            <p className="text-sm text-muted-foreground">
              O relatório de {formatMesPorExtenso(r.mes)} fica disponível a partir de {formatData(r.disponivel_em)}{" "}
              (3º dia útil do mês seguinte).
            </p>
          ) : (
            <div className="grid gap-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm text-muted-foreground">Volume × capacidade do pacote</p>
                  <p className="mt-1 text-2xl font-mono tabular-nums">
                    {r.volume.toLocaleString("pt-BR")}
                    <span className="text-muted-foreground"> / {r.capacidade.toLocaleString("pt-BR")}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{r.dias_uteis} dias úteis no mês</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Aderência à Base de Suporte</p>
                  {aderencia.isLoading ? (
                    <Skeleton className="mt-1 h-8 w-24" />
                  ) : aderencia.data == null ? (
                    <p className="mt-1 text-sm">Aguardando apuração da Imperium</p>
                  ) : (
                    <>
                      <p className="mt-1 text-2xl font-mono tabular-nums">{formatPct(aderencia.data)}</p>
                      <p className="text-xs text-muted-foreground">Meta contratual: {META_ADERENCIA}%</p>
                    </>
                  )}
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Prazo contratual</TableHead>
                    <TableHead>Parâmetro</TableHead>
                    <TableHead className="text-right">Casos no prazo</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.indicadores.map((i) => (
                    <TableRow key={i.chave}>
                      <TableCell>{i.rotulo}</TableCell>
                      <TableCell>{formatPrazoContratual(i.parametro_horas)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{i.casos_no_prazo}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{i.casos_total}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{formatPct(i.pct_no_prazo)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">
                Prazos medidos por caso, em horas úteis (segunda a sexta, exceto feriados). Conclusão de reembolso só
                conta casos com a data de autorização da plataforma informada.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
