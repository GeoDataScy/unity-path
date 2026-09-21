import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { LYA_MAX_BYTES, LyaArquivoErro, chaveDeColuna, parseLyaFile } from "./parseLyaFile";

function bytesDeTexto(texto: string): Uint8Array {
  return new TextEncoder().encode(texto);
}

function bytesDePlanilha(aoa: unknown[][]): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Plan1");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

describe("chaveDeColuna", () => {
  it("tira acento, espaço e maiúscula do cabeçalho", () => {
    expect(chaveDeColuna("Data do Pedido")).toBe("data_do_pedido");
    expect(chaveDeColuna("  NÚMERO DO PEDIDO ")).toBe("numero_do_pedido");
    expect(chaveDeColuna("E-mail (cliente)")).toBe("e_mail_cliente");
  });
});

describe("parseLyaFile — planilha", () => {
  it("normaliza o cabeçalho e respeita a vírgula dentro das aspas", () => {
    const csv =
      "Número do Pedido,E-mail do Cliente,Motivo,Valor\n" +
      '671D96DAEE,ana@exemplo.com,"Reembolso, parcial",12.50\n';

    const parse = parseLyaFile(bytesDeTexto(csv), "reembolsos.csv");

    expect(parse.tipo).toBe("csv");
    expect(parse.arquivo).toBe("reembolsos.csv");
    expect(parse.conteudo).toBe("");
    expect(parse.linhas).toHaveLength(1);
    expect(parse.linhas[0]).toEqual({
      numero_do_pedido: "671D96DAEE",
      e_mail_do_cliente: "ana@exemplo.com",
      motivo: "Reembolso, parcial",
      valor: "12.50",
    });
  });

  it("perfila as colunas: tipo, preenchidas, distintos e exemplos", () => {
    const csv =
      "produto,quantidade,vendido_em,ativo,observacao\n" +
      "Presgera,3,2026-06-01,sim,\n" +
      "Presgera,5,2026-06-02,nao,tudo certo\n" +
      "Jellyrock,12,2026-06-03,sim,\n";

    const { colunas } = parseLyaFile(bytesDeTexto(csv), "vendas.csv");
    const porNome = Object.fromEntries(colunas.map((c) => [c.nome, c]));

    expect(porNome.produto.tipo).toBe("texto");
    expect(porNome.produto.distintos).toBe(2);
    expect(porNome.produto.exemplos).toEqual(["Presgera", "Jellyrock"]);

    expect(porNome.quantidade.tipo).toBe("numero");
    expect(porNome.quantidade.preenchidas).toBe(3);

    expect(porNome.vendido_em.tipo).toBe("data");
    expect(porNome.ativo.tipo).toBe("booleano");

    // Célula vazia não conta como preenchida e vira null na linha.
    expect(porNome.observacao.preenchidas).toBe(1);
    expect(porNome.observacao.tipo).toBe("texto");
  });

  it("mantém como texto o número com vírgula decimal e o código com zero à esquerda", () => {
    const csv = "codigo,valor\n0012345,\"1.234,56\"\n0067890,\"98,10\"\n";

    const parse = parseLyaFile(bytesDeTexto(csv), "financeiro.csv");
    const porNome = Object.fromEntries(parse.colunas.map((c) => [c.nome, c]));

    expect(parse.linhas[0].codigo).toBe("0012345");
    expect(parse.linhas[0].valor).toBe("1.234,56");
    // Zero à esquerda e vírgula decimal são ambíguos: ficam texto, sem palpite.
    expect(porNome.valor.tipo).toBe("texto");
  });

  it("aceita TSV e resolve cabeçalho vazio e repetido", () => {
    const tsv = "nome\tnome\t\nana\tsilva\tx\n";

    const parse = parseLyaFile(bytesDeTexto(tsv), "duplicado.tsv");

    expect(parse.colunas.map((c) => c.nome)).toEqual(["nome", "nome_2", "coluna_3"]);
    expect(parse.linhas[0]).toEqual({ nome: "ana", nome_2: "silva", coluna_3: "x" });
  });

  it("lê planilha binária com data como Date e ignora a linha totalmente vazia", () => {
    const bytes = bytesDePlanilha([
      ["Pedido", "Data", "Itens"],
      ["2JD7MZGE", new Date(Date.UTC(2026, 5, 17)), 6],
      ["", "", ""],
    ]);

    const parse = parseLyaFile(bytes, "devolucoes.xlsx");

    expect(parse.tipo).toBe("csv");
    expect(parse.linhas).toHaveLength(1);
    expect(parse.linhas[0].data).toBe("2026-06-17");
    expect(parse.linhas[0].itens).toBe(6);
  });

  it("recusa arquivo só com cabeçalho", () => {
    expect(() => parseLyaFile(bytesDeTexto("a,b,c\n"), "vazio.csv")).toThrow(LyaArquivoErro);
  });
});

describe("parseLyaFile — markdown", () => {
  it("guarda o corpo inteiro em conteudo, sem linhas nem colunas", () => {
    const md = "# Política de reembolso\n\nReembolso integral até 30 dias.\n";

    const parse = parseLyaFile(bytesDeTexto(md), "politica.md");

    expect(parse.tipo).toBe("markdown");
    expect(parse.conteudo).toBe("# Política de reembolso\n\nReembolso integral até 30 dias.");
    expect(parse.linhas).toHaveLength(0);
    expect(parse.colunas).toHaveLength(0);
  });
});

describe("parseLyaFile — limites e formato", () => {
  it("recusa arquivo acima de 8 MB dizendo o que fazer", () => {
    const grande = new Uint8Array(LYA_MAX_BYTES + 1);
    expect(() => parseLyaFile(grande, "enorme.csv")).toThrow(/8 MB/);
    expect(() => parseLyaFile(grande, "enorme.csv")).toThrow(/Recorte a planilha/);
  });

  it("recusa extensão desconhecida", () => {
    expect(() => parseLyaFile(bytesDeTexto("qualquer coisa"), "foto.png")).toThrow(/Formato não reconhecido/);
  });
});
