import { Check, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SIDEBAR_TONES, isSidebarTone, type SidebarTone } from "@/lib/sidebarTone";
import { cn } from "@/lib/utils";

type Props = {
  fullName: string | null;
  tone: SidebarTone;
  onToneChange: (tone: SidebarTone) => void;
  className?: string;
};

function initials(name: string | null) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

/** Miniatura da sidebar no tom escolhido. Usa a própria classe `hubi-sidebar`
 *  com `data-tone`, então mostra exatamente os tokens reais — inclusive no
 *  modo escuro. */
function TonePreview({ tone }: { tone: SidebarTone }) {
  return (
    <div
      className="hubi-sidebar flex h-[88px] w-full flex-col gap-1.5 rounded-md border border-sidebar-border bg-sidebar p-2"
      data-tone={tone}
      aria-hidden
    >
      <div className="h-1.5 w-8 rounded-full bg-sidebar-foreground/30" />
      <nav className="mt-1 space-y-1">
        <div className="h-2 w-12 rounded-full bg-sidebar-foreground/20" />
        <div className="relative flex h-4 items-center rounded bg-sidebar-accent pl-2 before:absolute before:-left-1 before:bottom-1 before:top-1 before:w-0.5 before:rounded-full before:bg-signal">
          <div className="h-1.5 w-1.5 rounded-sm bg-signal" />
          <div className="ml-1.5 h-1.5 w-10 rounded-full bg-sidebar-accent-foreground/60" />
        </div>
        <div className="h-2 w-10 rounded-full bg-sidebar-foreground/20" />
      </nav>
    </div>
  );
}

export function SettingsDialog({ fullName, tone, onToneChange, className }: Props) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Configurações"
          title="Configurações"
          className={className}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-subtle text-sm font-medium text-ink">
              {initials(fullName)}
            </div>
            <div className="min-w-0 text-left">
              <DialogTitle className="truncate text-base font-medium">{fullName || "Meu perfil"}</DialogTitle>
              <DialogDescription className="text-xs">Suas configurações</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Tabs defaultValue="personalizar" className="mt-2">
          <TabsList>
            <TabsTrigger value="personalizar">Personalize sua tela</TabsTrigger>
          </TabsList>

          {/* O foco do teclado fica nas opções (anel no cartão), não na área da aba
              inteira — senão abrir a janela já desenha um contorno em tudo. */}
          <TabsContent value="personalizar" className="mt-4 space-y-3 focus-visible:ring-0 focus-visible:ring-offset-0">
            <div>
              <p className="text-sm font-medium text-ink">Cor da barra lateral</p>
              <p className="text-xs text-ink-tertiary">A mudança aparece na hora e fica salva neste navegador.</p>
            </div>

            <RadioGroup
              value={tone}
              onValueChange={(v) => isSidebarTone(v) && onToneChange(v)}
              className="grid grid-cols-3 gap-3"
              aria-label="Cor da barra lateral"
            >
              {SIDEBAR_TONES.map((option) => {
                const selected = option.value === tone;
                return (
                  <label
                    key={option.value}
                    className={cn(
                      "flex cursor-pointer flex-col gap-2 rounded-lg border p-2 transition-colors",
                      "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
                      selected ? "border-ink ring-1 ring-ink" : "border-line hover:border-line-strong",
                    )}
                  >
                    <TonePreview tone={option.value} />
                    <span className="flex items-center gap-1.5 px-0.5 text-xs font-medium text-ink">
                      <RadioGroupItem value={option.value} className="sr-only" />
                      {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
                      {option.label}
                    </span>
                  </label>
                );
              })}
            </RadioGroup>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
