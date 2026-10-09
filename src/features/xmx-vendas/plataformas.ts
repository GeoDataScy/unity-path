/**
 * Famílias de plataforma do sistema de vendas (a "Nova Estrutura" de mai/2026
 * é a migração do mesmo checkout, por isso entra junto). A chave é a que a RPC
 * `dashboard_xmx_refunds` devolve.
 *
 * A cor segue a plataforma, nunca a posição no ranking. Ordem fixa da paleta
 * categórica validada (skill dataviz), com passo próprio no tema escuro — os
 * valores ficam em `--xmx-*` no index.css.
 */
export const XMX_PLATAFORMAS: Record<string, { label: string; cor: string }> = {
  cartpanda: { label: "Cartpanda", cor: "var(--xmx-cartpanda)" },
  buygoods: { label: "BuyGoods", cor: "var(--xmx-buygoods)" },
  pagamerican: { label: "PagAmerican", cor: "var(--xmx-pagamerican)" },
  helpgrid: { label: "HelpGrid", cor: "var(--xmx-helpgrid)" },
  clickbank: { label: "Clickbank", cor: "var(--xmx-clickbank)" },
  digistore: { label: "DigiStore", cor: "var(--xmx-digistore)" },
  cartcandy: { label: "CartCandy", cor: "var(--xmx-cartcandy)" },
};

const OUTRA = { label: "Outras", cor: "var(--xmx-outras)" };

export function plataforma(key: string) {
  return XMX_PLATAFORMAS[key] ?? { ...OUTRA, label: key === "outras" ? OUTRA.label : key };
}
