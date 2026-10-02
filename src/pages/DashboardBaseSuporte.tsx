import { useMemo, useState } from "react";
import { BookOpen, MessageSquare, Package, Pencil, Plus, Search, Trash2 } from "lucide-react";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ProductFormDialog } from "@/features/support-base/components/ProductFormDialog";
import { SmsBrandFormDialog } from "@/features/support-base/components/SmsBrandFormDialog";
import { SmsReplyFormDialog } from "@/features/support-base/components/SmsReplyFormDialog";
import {
  useDeleteSupportProductMutation,
  useDeleteSupportSmsBrandMutation,
  useDeleteSupportSmsReplyMutation,
  useSupportProductsQuery,
  useSupportSmsBrandsQuery,
  useSupportSmsRepliesQuery,
} from "@/features/support-base/useSupportBaseQuery";
import {
  ESTRUTURA_LABEL,
  type SupportProduct,
  type SupportSmsBrand,
  type SupportSmsReply,
} from "@/features/support-base/types";

/** Alvo da confirmação de exclusão: o que apagar e de qual tabela. */
type DeleteTarget = {
  tipo: "produto" | "brand" | "resposta";
  id: string;
  nome: string;
};

export default function DashboardBaseSuporte() {
  const { toast } = useToast();

  // includeInactive: o admin precisa enxergar (e reativar) o que foi desativado.
  const produtos = useSupportProductsQuery(true);
  const brands = useSupportSmsBrandsQuery(true);
  const respostas = useSupportSmsRepliesQuery(true);

  const deleteProduto = useDeleteSupportProductMutation();
  const deleteBrand = useDeleteSupportSmsBrandMutation();
  const deleteResposta = useDeleteSupportSmsReplyMutation();

  const [busca, setBusca] = useState("");
  const [produtoEmEdicao, setProdutoEmEdicao] = useState<SupportProduct | null>(null);
  const [produtoDialogAberto, setProdutoDialogAberto] = useState(false);
  const [brandEmEdicao, setBrandEmEdicao] = useState<SupportSmsBrand | null>(null);
  const [brandDialogAberto, setBrandDialogAberto] = useState(false);
  const [respostaEmEdicao, setRespostaEmEdicao] = useState<SupportSmsReply | null>(null);
  const [respostaDialogAberto, setRespostaDialogAberto] = useState(false);
  const [aExcluir, setAExcluir] = useState<DeleteTarget | null>(null);

  const q = busca.toLowerCase().trim();
  const filtrar = <T,>(itens: T[], campos: (item: T) => string) =>
    !q ? itens : itens.filter((i) => campos(i).toLowerCase().includes(q));

  const produtosFiltrados = filtrar(
    produtos.data ?? [],
    (p) => `${p.nome}${p.funcao ?? ""}${p.plataforma ?? ""}${p.nicho ?? ""}`,
  );
  const brandsFiltradas = filtrar(brands.data ?? [], (b) => `${b.nome}${b.sistema}`);
  const respostasFiltradas = filtrar(
    respostas.data ?? [],
    (r) => `${r.titulo}${r.categoria}${r.texto_en}${r.texto_pt}`,
  );

  const proximaOrdem = (itens: Array<{ sort_order: number }>) =>
    itens.reduce((max, i) => Math.max(max, i.sort_order), -1) + 1;

  const categoriasDeResposta = useMemo(
    () => [...new Set((respostas.data ?? []).map((r) => r.categoria))].sort(),
    [respostas.data],
  );

  const confirmarExclusao = async () => {
    if (!aExcluir) return;
    const mutations = {
      produto: deleteProduto,
      brand: deleteBrand,
      resposta: deleteResposta,
    };
    try {
      await mutations[aExcluir.tipo].mutateAsync(aExcluir.id);
      toast({ title: `"${aExcluir.nome}" foi excluído.` });
    } catch (error) {
      toast({
        title: "Não foi possível excluir.",
        description: (error as { message?: string })?.message,
        variant: "destructive",
      });
    }
    setAExcluir(null);
  };

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <BookOpen className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-medium">Base de Suporte</h1>
          <p className="text-sm text-muted-foreground">
            O que você cadastra aqui aparece na Base de Suporte de todos os agentes.
          </p>
        </div>
      </header>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar em produtos, brands e mensagens…"
          className="pl-9"
        />
      </div>

      <Tabs defaultValue="produtos">
        <TabsList>
          <TabsTrigger value="produtos" className="gap-1.5 text-xs">
            <Package className="h-3.5 w-3.5" />
            Produtos ({produtos.data?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="brands" className="gap-1.5 text-xs">
            <MessageSquare className="h-3.5 w-3.5" />
            Brands SMS ({brands.data?.length ?? 0})
          </TabsTrigger>
          <TabsTrigger value="respostas" className="gap-1.5 text-xs">
            <MessageSquare className="h-3.5 w-3.5" />
            Respostas SMS ({respostas.data?.length ?? 0})
          </TabsTrigger>
        </TabsList>

        {/* ── Produtos ── */}
        <TabsContent value="produtos" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button
              onClick={() => {
                setProdutoEmEdicao(null);
                setProdutoDialogAberto(true);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Novo produto
            </Button>
          </div>

          <Card>
            {produtos.isLoading ? (
              <TabelaCarregando />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Estrutura</TableHead>
                    <TableHead>Nicho</TableHead>
                    <TableHead>Links</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-24 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {produtosFiltrados.length === 0 ? (
                    <LinhaVazia colSpan={6} texto="Nenhum produto encontrado." />
                  ) : (
                    produtosFiltrados.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="font-medium">{p.nome}</div>
                          {p.funcao && (
                            <div className="text-xs text-muted-foreground">{p.funcao}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{ESTRUTURA_LABEL[p.estrutura]}</TableCell>
                        <TableCell className="text-xs">{p.nicho ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          {p.links.length > 0 ? `${p.links.length} extra(s)` : "—"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge ativo={p.ativo} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Acoes
                            onEdit={() => {
                              setProdutoEmEdicao(p);
                              setProdutoDialogAberto(true);
                            }}
                            onDelete={() =>
                              setAExcluir({ tipo: "produto", id: p.id, nome: p.nome })
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        {/* ── Brands SMS ── */}
        <TabsContent value="brands" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button
              onClick={() => {
                setBrandEmEdicao(null);
                setBrandDialogAberto(true);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Nova brand
            </Button>
          </div>

          <Card>
            {brands.isLoading ? (
              <TabelaCarregando />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Brand</TableHead>
                    <TableHead>Nome no sistema</TableHead>
                    <TableHead>Estrutura</TableHead>
                    <TableHead>Número</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-24 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {brandsFiltradas.length === 0 ? (
                    <LinhaVazia colSpan={6} texto="Nenhuma brand encontrada." />
                  ) : (
                    brandsFiltradas.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{b.nome}</TableCell>
                        <TableCell className="text-xs">{b.sistema}</TableCell>
                        <TableCell className="text-xs">{ESTRUTURA_LABEL[b.estrutura]}</TableCell>
                        <TableCell className="font-mono text-xs">{b.sms_number ?? "—"}</TableCell>
                        <TableCell>
                          <StatusBadge ativo={b.ativo} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Acoes
                            onEdit={() => {
                              setBrandEmEdicao(b);
                              setBrandDialogAberto(true);
                            }}
                            onDelete={() => setAExcluir({ tipo: "brand", id: b.id, nome: b.nome })}
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        {/* ── Respostas SMS ── */}
        <TabsContent value="respostas" className="mt-4 space-y-3">
          <div className="flex justify-end">
            <Button
              onClick={() => {
                setRespostaEmEdicao(null);
                setRespostaDialogAberto(true);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Nova mensagem
            </Button>
          </div>

          <Card>
            {respostas.isLoading ? (
              <TabelaCarregando />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Situação</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Texto (EN)</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-24 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {respostasFiltradas.length === 0 ? (
                    <LinhaVazia colSpan={5} texto="Nenhuma mensagem encontrada." />
                  ) : (
                    respostasFiltradas.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.titulo}</TableCell>
                        <TableCell className="text-xs">{r.categoria}</TableCell>
                        <TableCell className="max-w-md truncate text-xs text-muted-foreground">
                          {r.texto_en}
                        </TableCell>
                        <TableCell>
                          <StatusBadge ativo={r.ativo} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Acoes
                            onEdit={() => {
                              setRespostaEmEdicao(r);
                              setRespostaDialogAberto(true);
                            }}
                            onDelete={() =>
                              setAExcluir({ tipo: "resposta", id: r.id, nome: r.titulo })
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <ProductFormDialog
        open={produtoDialogAberto}
        onOpenChange={setProdutoDialogAberto}
        product={produtoEmEdicao}
        nextSortOrder={proximaOrdem(produtos.data ?? [])}
      />
      <SmsBrandFormDialog
        open={brandDialogAberto}
        onOpenChange={setBrandDialogAberto}
        brand={brandEmEdicao}
        nextSortOrder={proximaOrdem(brands.data ?? [])}
      />
      <SmsReplyFormDialog
        open={respostaDialogAberto}
        onOpenChange={setRespostaDialogAberto}
        reply={respostaEmEdicao}
        nextSortOrder={proximaOrdem(respostas.data ?? [])}
        categorias={categoriasDeResposta}
      />

      <AlertDialog open={Boolean(aExcluir)} onOpenChange={(o) => !o && setAExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir "{aExcluir?.nome}"?</AlertDialogTitle>
            <AlertDialogDescription>
              A exclusão é definitiva e some na hora para todos os agentes. Se a ideia é só tirar
              da tela por enquanto, feche isto e desative o item na edição — assim ele volta depois
              sem precisar ser recadastrado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmarExclusao}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function StatusBadge({ ativo }: { ativo: boolean }) {
  return (
    <Badge variant={ativo ? "secondary" : "outline"} className="text-[10px]">
      {ativo ? "Visível" : "Oculto"}
    </Badge>
  );
}

function Acoes({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Editar" className="h-8 w-8">
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onDelete}
        aria-label="Excluir"
        className="h-8 w-8"
      >
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );
}

function LinhaVazia({ colSpan, texto }: { colSpan: number; texto: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-10 text-center text-sm text-muted-foreground">
        {texto}
      </TableCell>
    </TableRow>
  );
}

function TabelaCarregando() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
