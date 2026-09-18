// Cor de cada produto nos gráficos de reembolso externo.
//
// As quatro primeiras são as do painel de referência, ligadas ao nome do produto
// (geleia, mel, castanho, azul) — quem já viu aquele painel reconhece. Os demais
// produtos entram na reserva, na ordem de volume, para que o maior fique com a
// cor mais distinta. A Cartpanda sozinha traz sete produtos, então a lista fixa
// do original não bastava.

const FIXAS: Record<string, string> = {
  Jellyrock: "var(--rf-p1)",
  Honeyfil: "var(--rf-p2)",
  Horsefil: "var(--rf-p3)",
  "Blue Horse": "var(--rf-p4)",
};

const RESERVA = ["var(--rf-p5)", "var(--rf-p6)", "var(--rf-p7)", "var(--rf-p8)"];

/** Recebe os produtos em ordem de volume e devolve cada um com sua cor. */
export function assignProductColors(products: string[]): { key: string; color: string }[] {
  let i = 0;
  return products.map((key) => {
    const fixa = FIXAS[key];
    if (fixa) return { key, color: fixa };
    const cor = RESERVA[i % RESERVA.length];
    i += 1;
    return { key, color: cor };
  });
}
