import { MessageSquareReply } from "lucide-react";

import { Cell, ConstructionNotice, Hint, NotebookSheet, Placeholder, PreviewFrame } from "../components/Notebook";

export function DuvidasNotebook() {
  return (
    <NotebookSheet fileName="duvidas.ipynb">
      <Cell kind="markdown">
        <h1>Dúvidas</h1>
        <p>
          As perguntas do Geovani sobre os dados e sobre o negócio. Cada pergunta é um item; quem sabe a resposta
          responde logo abaixo, no próprio item, e a conversa fica registrada ali.
        </p>
        <ConstructionNotice>Nenhuma pergunta aberta ainda. Abaixo, o desenho de um item.</ConstructionNotice>
      </Cell>

      <PreviewFrame title="estrutura de uma dúvida, sem dados">
        <Cell kind="markdown" label="Pergunta">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="nb-code text-[var(--nb-ink-3)]">Pergunta #—</span>
            <span className="rounded-full border border-[var(--nb-border-strong)] px-2 py-px text-[var(--nb-ink-2)]">
              Aguardando resposta
            </span>
          </div>
          <Hint>
            O texto da pergunta entra aqui, com o contexto que a motivou: a tabela, o período ou o gráfico em questão.
          </Hint>
        </Cell>
        <Cell kind="markdown" label="Respostas">
          <div className="space-y-3 rounded-sm border border-[var(--nb-border)] p-3">
            <div className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className="mt-0.5 h-6 w-6 shrink-0 rounded-full bg-[var(--nb-skeleton)]"
              />
              <div className="flex-1 space-y-2 pt-1">
                <Placeholder width="28%" />
                <Placeholder width="85%" />
                <Placeholder width="62%" />
              </div>
            </div>
            <div className="flex flex-col gap-2 border-t border-[var(--nb-border)] pt-3 sm:flex-row sm:items-center">
              <div
                aria-hidden="true"
                className="flex-1 rounded-sm border border-[var(--nb-border)] bg-[var(--nb-code-bg)] px-3 py-2 text-[13px] text-[var(--nb-ink-3)]"
              >
                Escreva sua resposta…
              </div>
              <span
                aria-hidden="true"
                className="inline-flex items-center justify-center gap-1.5 rounded-sm border border-[var(--nb-border-strong)] px-3 py-2 text-[13px] text-[var(--nb-ink-3)]"
              >
                <MessageSquareReply className="h-3.5 w-3.5" />
                Responder
              </span>
            </div>
            <p className="text-[12px] text-[var(--nb-ink-3)]">
              Campo de resposta ilustrativo — ainda não envia nada.
            </p>
          </div>
        </Cell>
      </PreviewFrame>
    </NotebookSheet>
  );
}
