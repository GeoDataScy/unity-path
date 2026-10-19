import { Cell, CodeLine, ConstructionNotice, Hint, NotebookSheet, Placeholder, PreviewFrame } from "../components/Notebook";

const COLUNAS = ["coluna", "tipo", "o que significa"] as const;

export function BancoNotebook() {
  return (
    <NotebookSheet fileName="banco_de_dados.ipynb">
      <Cell kind="markdown">
        <h1>Banco de dados</h1>
        <p>
          O mapa de como o banco da XMX funciona: cada tabela, para que ela serve, as colunas que importam, como
          ela se liga às outras e as armadilhas conhecidas.
        </p>
        <ConstructionNotice>Nenhuma tabela mapeada ainda. Abaixo, o desenho de uma ficha de tabela.</ConstructionNotice>
      </Cell>

      <PreviewFrame title="estrutura de uma ficha de tabela, sem dados">
        <Cell kind="markdown" label="Anotação da tabela">
          <h2 className="nb-code !text-[1.05rem] !font-medium">nome_da_tabela</h2>
          <Hint>Para que a tabela serve, quem escreve nela e o cuidado que se deve ter ao consultá-la.</Hint>
        </Cell>
        <Cell kind="code" label="Consulta de exemplo">
          <CodeLine tone="comment"># consulta de exemplo para explorar a tabela</CodeLine>
        </Cell>
        <Cell kind="output" label="Colunas">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] border-collapse text-left text-[13px]">
              <caption className="sr-only">Colunas da tabela (prévia, sem dados)</caption>
              <thead>
                <tr className="border-b border-[var(--nb-border-strong)]">
                  {COLUNAS.map((c) => (
                    <th key={c} scope="col" className="px-3 py-2 font-semibold text-[var(--nb-ink)]">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody aria-hidden="true">
                {[0, 1, 2].map((r) => (
                  <tr key={r} className="border-b border-[var(--nb-border)] even:bg-[var(--nb-code-bg)]">
                    <td className="px-3 py-3">
                      <Placeholder width={["70%", "55%", "80%"][r]} />
                    </td>
                    <td className="px-3 py-3">
                      <Placeholder width={["40%", "50%", "35%"][r]} />
                    </td>
                    <td className="px-3 py-3">
                      <Placeholder width={["90%", "75%", "60%"][r]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Cell>
      </PreviewFrame>
    </NotebookSheet>
  );
}
