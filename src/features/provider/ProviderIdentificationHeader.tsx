import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { CAPACIDADE_PADRAO, useMyProviderContractQuery, type ProviderContract } from "./useMyProviderContractQuery";

type Props = {
  userId: string | null;
  fullName: string | null;
  /** Badge de canal (SMS/EMAIL) já calculado pela página. */
  channelBadge?: ReactNode;
};

/** Campo sem dado: placeholder em cinza (texto terciário), nunca vazio. */
function Valor({ value, placeholder, className }: { value: string | null | undefined; placeholder: string; className?: string }) {
  const v = value?.trim();
  return v ? (
    <span className={className}>{v}</span>
  ) : (
    <span className={cn(className, "text-ink-tertiary")} data-placeholder="true">
      {placeholder}
    </span>
  );
}

function formatData(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

function Coluna({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-tertiary">{rotulo}</p>
      <div className="mt-1 grid gap-0.5">{children}</div>
    </div>
  );
}

function Vigencia({ contrato }: { contrato: ProviderContract | null }) {
  const inicio = formatData(contrato?.vigencia_inicio ?? null);
  const fim = formatData(contrato?.vigencia_fim ?? null);
  if (!inicio && !fim) {
    return <Valor value={null} placeholder="Vigência a definir" className="text-sm" />;
  }
  return (
    <span className="text-sm text-muted-foreground">
      Vigência: <Valor value={inicio} placeholder="a definir" /> a <Valor value={fim} placeholder="a definir" />
    </span>
  );
}

/**
 * Proposta 5 do doc XMX-2026/IMP-SUP-01-A v2: a área do prestador abre com a
 * identificação da prestadora e do contrato, no lugar da saudação.
 */
export function ProviderIdentificationHeader({ userId, fullName, channelBadge }: Props) {
  const { data: contrato = null, isLoading } = useMyProviderContractQuery(userId);
  const capacidade = contrato?.capacidade_dia_util ?? CAPACIDADE_PADRAO;

  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-normal tracking-tight md:text-4xl">{fullName?.trim() || "Prestador"}</h1>
        {channelBadge}
      </div>

      {isLoading ? (
        <Skeleton className="mt-4 h-16 w-full" />
      ) : (
        <section
          aria-label="Identificação do prestador"
          className="mt-4 grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-3"
        >
          <Coluna rotulo="Prestadora">
            <Valor value={contrato?.razao_social} placeholder="[Razão social a cadastrar]" className="font-medium" />
            <span className="text-sm text-muted-foreground">
              CNPJ <Valor value={contrato?.cnpj} placeholder="00.000.000/0000-00" className="font-mono tabular-nums" />
            </span>
          </Coluna>

          <Coluna rotulo="Titular / responsável">
            <span className="font-medium">{fullName?.trim() || "—"}</span>
            <span className="text-sm text-muted-foreground">
              Contrato de prestação de serviços{" "}
              {contrato?.contrato_numero?.trim() ? (
                <span>nº {contrato.contrato_numero.trim()}</span>
              ) : (
                <Valor value={null} placeholder="nº 0000/2026" />
              )}
            </span>
          </Coluna>

          <Coluna rotulo="Pacote contratado">
            <span className="font-medium">
              <Valor value={contrato?.pacote_nome} placeholder="Suporte" /> — {capacidade} atendimentos por dia útil
            </span>
            <Vigencia contrato={contrato} />
          </Coluna>
        </section>
      )}
    </header>
  );
}
