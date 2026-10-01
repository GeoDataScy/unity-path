import { useState } from "react";
import {
  AlertTriangle,
  FileSpreadsheet,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Table2,
  Trash2,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LyaUploadDialog } from "@/features/lya/arquivos/LyaUploadDialog";
import {
  useApagarLyaArquivo,
  useAtualizarLyaArquivo,
  useLyaArquivoQuery,
  useLyaArquivosQuery,
} from "@/features/lya/arquivos/useLyaArquivos";
import { desde } from "@/features/lya/graph";
import type { LyaArquivo } from "@/features/lya/types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * Arquivos da Lya (/dashboard/lya/arquivos) — só gestora.
 *
 * O acervo do que ela recebeu de fora do sistema. Cada linha mostra o que a
 * Lya ENTENDEU do arquivo (o resumo que ela mesma escreveu na ingestão), que é
 * o que vira o nó de cognição no cérebro e o que ela usa para decidir cruzar
 * aquele arquivo com os dados da plataforma.
 */
export default function DashboardLyaArquivos() {
  const { toast } = useToast();
  const arquivos = useLyaArquivosQuery();
  const apagar = useApagarLyaArquivo();
  const atualizar = useAtualizarLyaArquivo();
  const [subindo, setSubindo] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [renomeando, setRenomeando] = useState<LyaArquivo | null>(null);
  const [novoNome, setNovoNome] = useState("");
  const [confirmar, setConfirmar] = useState<LyaArquivo | null>(null);

  const lista = arquivos.data ?? [];

  const salvarNome = async () => {
    if (!renomeando) return;
    const nome = novoNome.trim();
    if (!nome || nome === renomeando.nome) {
      setRenomeando(null);
      return;
    }
    try {
      await atualizar.mutateAsync({ id: renomeando.id, nome });
      toast({ title: "Nome atualizado." });
      setRenomeando(null);
    } catch (err) {
      toast({ title: "Não consegui renomear.", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  };

  return (
    <main className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Table2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-medium">Arquivos da Lya</h1>
            <p className="text-sm text-muted-foreground">
              Planilhas e documentos que você deu para ela. Ela lê, guarda e cruza com os dados do sistema quando você pergunta.
            </p>
          </div>
        </div>
        <Button onClick={() => setSubindo(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Dar um arquivo
        </Button>
      </header>

      {arquivos.isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> carregando o acervo…
        </div>
      ) : arquivos.error ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {arquivos.error instanceof Error ? arquivos.error.message : "Não foi possível carregar os arquivos."}
        </p>
      ) : lista.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <Table2 className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">A Lya ainda não tem nenhum arquivo.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Dê a primeira planilha: ela lê as colunas, escreve o que entendeu e passa a cruzar esses dados com atendimentos,
            reembolsos e pedidos em espera.
          </p>
          <Button className="mt-4" onClick={() => setSubindo(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Dar um arquivo
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {lista.map((f) => (
            <LinhaArquivo
              key={f.id}
              arquivo={f}
              aberto={aberto === f.id}
              onAlternar={() => setAberto((a) => (a === f.id ? null : f.id))}
              onRenomear={() => {
                setRenomeando(f);
                setNovoNome(f.nome);
              }}
              onApagar={() => setConfirmar(f)}
            />
          ))}
        </ul>
      )}

      <LyaUploadDialog open={subindo} onOpenChange={setSubindo} onEnviado={(id) => setAberto(id)} />

      <AlertDialog open={renomeando !== null} onOpenChange={(v) => !v && setRenomeando(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Como a Lya chama este arquivo</AlertDialogTitle>
            <AlertDialogDescription>
              É por este nome que você vai pedir a ela ("olha a planilha de…"). O arquivo original não muda.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void salvarNome();
            }}
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={salvarNome} disabled={atualizar.isPending}>
              Salvar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmar !== null} onOpenChange={(v) => !v && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar “{confirmar?.nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Apaga o arquivo, as linhas dele e o que a Lya aprendeu com ele (o nó dele no cérebro some junto). Não dá para desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!confirmar) return;
                try {
                  await apagar.mutateAsync(confirmar.id);
                  toast({ title: "Arquivo removido." });
                } catch (err) {
                  toast({ title: "Não consegui apagar.", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
                }
              }}
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function LinhaArquivo({
  arquivo,
  aberto,
  onAlternar,
  onRenomear,
  onApagar,
}: {
  arquivo: LyaArquivo;
  aberto: boolean;
  onAlternar: () => void;
  onRenomear: () => void;
  onApagar: () => void;
}) {
  const Icone = arquivo.tipo === "markdown" ? FileText : FileSpreadsheet;
  // A amostra só é buscada quando a linha abre: a lista não paga por ela.
  const detalhe = useLyaArquivoQuery(aberto ? arquivo.id : null, 10);

  return (
    <li className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-start gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icone className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onAlternar} className="text-left text-sm font-medium hover:underline">
              {arquivo.nome}
            </button>
            {arquivo.status !== "pronto" && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
                  arquivo.status === "processando" ? "bg-muted text-muted-foreground" : "bg-destructive/10 text-destructive",
                )}
              >
                {arquivo.status === "processando" ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" /> lendo
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3 w-3" /> com erro
                  </>
                )}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {arquivo.arquivo} ·{" "}
            {arquivo.tipo === "markdown"
              ? "documento"
              : `${arquivo.total_linhas.toLocaleString("pt-BR")} linha(s), ${arquivo.colunas.length} coluna(s)`}
            {arquivo.uploaded_by_nome && <> · por {arquivo.uploaded_by_nome}</>}
            {arquivo.created_at && <> · {desde(arquivo.created_at)}</>}
          </p>
          {arquivo.erro && <p className="mt-1.5 text-xs text-destructive">{arquivo.erro}</p>}
          {arquivo.resumo && <p className="mt-2 text-[13px] leading-relaxed text-foreground/90">{arquivo.resumo}</p>}
          {arquivo.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {arquivo.tags.map((t) => (
                <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button variant="ghost" size="icon" onClick={onRenomear} aria-label="Renomear" title="Renomear">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onApagar} aria-label="Apagar" title="Apagar" className="text-destructive">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {aberto && (
        <div className="border-t border-border px-4 py-3">
          {detalhe.isLoading ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> abrindo…
            </p>
          ) : detalhe.data?.tipo === "markdown" ? (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-xs leading-relaxed text-foreground/90">
              {detalhe.data.conteudo || "(documento vazio)"}
            </pre>
          ) : detalhe.data && detalhe.data.amostra.length > 0 ? (
            <div className="overflow-x-auto">
              <p className="mb-2 text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                Primeiras {detalhe.data.amostra.length} de {arquivo.total_linhas.toLocaleString("pt-BR")} linha(s)
              </p>
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1 font-medium">#</th>
                    {arquivo.colunas.map((c) => (
                      <th key={c.nome} className="whitespace-nowrap px-2 py-1 font-medium">
                        {c.nome}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detalhe.data.amostra.map((linha) => (
                    <tr key={linha.linha} className="border-t border-border/60">
                      <td className="px-2 py-1 text-muted-foreground">{linha.linha}</td>
                      {arquivo.colunas.map((c) => (
                        <td key={c.nome} className="max-w-[240px] truncate px-2 py-1" title={String(linha.data?.[c.nome] ?? "")}>
                          {String(linha.data?.[c.nome] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Sem linhas para mostrar.</p>
          )}
        </div>
      )}
    </li>
  );
}
