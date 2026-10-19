import { ChartFramePlaceholder } from "../components/ChartFramePlaceholder";
import { Cell, CodeLine, ConstructionNotice, Hint, NotebookSheet, PreviewFrame } from "../components/Notebook";

export function RelatoriosNotebook() {
  return (
    <NotebookSheet fileName="relatorios.ipynb">
      <Cell kind="markdown">
        <h1>Relatórios</h1>
        <p>
          Aqui ficam as análises do Geovani, cada uma como um notebook: o gráfico, a consulta que gerou os
          números e a explicação do que eles querem dizer — tudo na mesma página, de cima para baixo.
        </p>
        <p>Como ler cada relatório:</p>
        <ul>
          <li>
            <strong>Texto</strong> — o contexto e a conclusão, em linguagem direta.
          </li>
          <li>
            <code>In [ ]</code> — a consulta usada (SQL ou Python), para quem quiser conferir a origem.
          </li>
          <li>
            <code>Out[ ]</code> — o resultado: gráfico ou tabela.
          </li>
        </ul>
        <ConstructionNotice>
          Nenhum relatório publicado ainda. Abaixo, o desenho de como cada um vai aparecer.
        </ConstructionNotice>
      </Cell>

      <PreviewFrame title="estrutura de um relatório, sem dados">
        <Cell kind="markdown" label="Contexto da análise">
          <h2>Título da análise</h2>
          <Hint>A pergunta que a análise responde, o período e as tabelas consultadas.</Hint>
        </Cell>
        <Cell kind="code" label="Consulta usada">
          <CodeLine tone="comment"># consulta que gerou os números desta análise</CodeLine>
          <CodeLine tone="comment"># (aparece aqui exatamente como foi rodada)</CodeLine>
        </Cell>
        <Cell kind="output" label="Resultado">
          <ChartFramePlaceholder />
        </Cell>
        <Cell kind="markdown" label="Leitura do resultado">
          <Hint>Leitura do resultado: o que o gráfico mostra, o que chama atenção e o que fazer com isso.</Hint>
        </Cell>
      </PreviewFrame>
    </NotebookSheet>
  );
}
