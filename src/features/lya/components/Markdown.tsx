import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Renderiza o Markdown das respostas da Lya (tabelas GFM, títulos, listas,
// código, citações) com os tokens do tema do app. A cor do texto é herdada do
// container (funciona no balão e na tela cheia, claro e escuro).
const components: Components = {
  h1: ({ children }) => <h1 className="mb-2 mt-4 text-[1.3em] font-semibold leading-snug first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-4 text-[1.15em] font-semibold leading-snug first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-[1.05em] font-semibold leading-snug first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="my-2 leading-[1.7] first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-[1.6]">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2.5 rounded-r-md border-l-[3px] border-primary bg-primary/5 py-1 pl-3.5 pr-2 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-border" />,
  code: ({ className, children }) => {
    const isBlock = (className || "").includes("language-");
    if (isBlock) return <code className="font-mono text-[0.85em] leading-relaxed">{children}</code>;
    return <code className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-primary">{children}</code>;
  },
  pre: ({ children }) => <pre className="my-2.5 overflow-x-auto rounded-lg border border-border bg-muted p-3">{children}</pre>,
  table: ({ children }) => (
    <div className="my-3 w-full overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-[0.9em]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
  th: ({ children }) => <th className="whitespace-nowrap border-b border-border px-3 py-2 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-t border-border px-3 py-1.5 align-top">{children}</td>,
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-[inherit]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
