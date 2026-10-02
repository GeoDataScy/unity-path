import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, BarChart3, ClipboardList, Loader2, LogOut, Package, PenLine } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { getMeStatus, recordAuthEvent } from "@/lib/userSession";
import {
  AREA_LABEL,
  AREA_PATH,
  LAST_AREA_KEY,
  areaCardsForRole,
  canAccessArea,
  hasAreaChoice,
  homePathForRole,
  isValidArea,
  type AppArea,
} from "@/lib/roles";
import { Logo } from "@/components/brand/Logo";
import { cn } from "@/lib/utils";

// Escolha de área depois do login, para quem tem acesso a mais de uma
// (gestora e time de copy) e para o time de produtos, que vê os mesmos cards mas
// só entra em Produtos. É uma tela e não um modal de propósito: sobrevive a
// refresh, é linkável (/areas), não pisca por cima de um dashboard vazio e o
// usuário pode voltar aqui pelo botão de trocar área na sidebar.

type AreaCard = {
  icon: typeof BarChart3;
  headline: string;
  description: string;
  bullets: string[];
};

const AREA_CARDS: Record<AppArea, AreaCard> = {
  analytics: {
    icon: BarChart3,
    headline: "Data Analytics do Suporte",
    description: "Os números do time de suporte, do atendimento ao reembolso.",
    bullets: ["Atendimentos e canais", "Reembolsos e motivos", "Acompanhamento semanal", "Interações e follow-ups"],
  },
  copy: {
    icon: PenLine,
    headline: "Área de Copy",
    description: "O que o cliente diz sobre a promessa — insumo para a copy.",
    bullets: ["Motivos de reembolso", "Palavras do cliente", "Recortes por produto e canal"],
  },
  produtos: {
    icon: Package,
    headline: "Área de Produtos",
    description: "Os pedidos retidos no fulfillment, até o atendimento fechar.",
    bullets: ["Pedidos em espera", "Motivos do on-hold", "Andamento por agente"],
  },
  // O agente nunca chega nesta tela (só tem uma área), mas o mapa é completo
  // para o dia em que alguém acumular workspace + outra área.
  workspace: {
    icon: ClipboardList,
    headline: "Meus Atendimentos",
    description: "Sua fila de tickets do dia.",
    bullets: [],
  },
};

export default function AreaSelect() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [areas, setAreas] = useState<readonly AppArea[]>([]);
  const [lastArea, setLastArea] = useState<AppArea | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;

    const check = async () => {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error || !session) {
        if (error) await supabase.auth.signOut({ scope: "local" });
        navigate("/login", { replace: true });
        return;
      }

      try {
        const status = await getMeStatus();
        if (!status.is_active) {
          await supabase.auth.signOut({ scope: "local" });
          navigate("/blocked", { replace: true });
          return;
        }
      } catch {
        // me_status falhou (rede) — segue; o perfil abaixo ainda decide o acesso.
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role, full_name")
        .eq("id", session.user.id)
        .maybeSingle();

      if (profileError) {
        await supabase.auth.signOut({ scope: "local" });
        navigate("/login", { replace: true });
        return;
      }

      // Quem só tem uma área não escolhe nada: vai direto para ela.
      if (!hasAreaChoice(profile?.role)) {
        navigate(homePathForRole(profile?.role), { replace: true });
        return;
      }

      if (!active) return;
      setFullName(profile?.full_name ?? null);
      setRole(profile?.role ?? null);
      setAreas(areaCardsForRole(profile?.role));
      const stored = window.localStorage.getItem(LAST_AREA_KEY);
      setLastArea(isValidArea(stored) ? stored : null);
      setLoading(false);
    };

    check();

    return () => {
      active = false;
    };
  }, [navigate]);

  useEffect(() => {
    if (!loading) primaryRef.current?.focus();
  }, [loading]);

  const enterArea = (area: AppArea) => {
    // O card pode estar na tela sem dar acesso (time de produtos vê todos).
    if (!canAccessArea(role, area)) {
      toast.error("Acesso negado", {
        description: `Seu perfil não tem acesso à ${AREA_LABEL[area]}.`,
      });
      return;
    }
    window.localStorage.setItem(LAST_AREA_KEY, area);
    navigate(AREA_PATH[area], { replace: true });
  };

  const handleLogout = async () => {
    await recordAuthEvent("logout").catch(() => {});
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("sb-")) localStorage.removeItem(key);
    }
    window.location.href = "/login";
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-login-bg flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-ink-tertiary" />
      </div>
    );
  }

  const firstName = (fullName ?? "").trim().split(/\s+/)[0];

  return (
    <div className="min-h-screen bg-login-bg flex items-center justify-center p-4 sm:p-8">
      <main className="relative w-full max-w-4xl space-y-10 animate-in fade-in-50 duration-500">
        <header className="flex flex-col items-center gap-6 text-center">
          <Logo height={40} />
          <div className="space-y-2">
            <h1 className="text-[28px] font-medium leading-[34px] tracking-[-0.025em] text-ink">
              {firstName ? `Olá, ${firstName}` : "Bem-vindo de volta"}
            </h1>
            <p className="text-sm text-ink-tertiary">Escolha a área que você quer acessar agora.</p>
          </div>
        </header>

        {/* Com 3+ áreas os cards viram uma linha de três: em duas colunas o
            terceiro card ficaria órfão ocupando metade da segunda linha. */}
        <div
          className={cn(
            "grid gap-4",
            areas.length === 2 && "sm:grid-cols-2",
            areas.length >= 3 && "sm:grid-cols-2 lg:grid-cols-3",
          )}
        >
          {areas.map((area, index) => {
            const card = AREA_CARDS[area];
            const Icon = card.icon;
            const isLast = lastArea === area;

            return (
              <button
                key={area}
                ref={index === 0 ? primaryRef : undefined}
                type="button"
                onClick={() => enterArea(area)}
                aria-label={`Entrar na ${AREA_LABEL[area]}`}
                className={cn(
                  "group relative flex h-full flex-col gap-4 rounded-lg border border-line bg-surface p-6 text-left",
                  "transition duration-200 hover:border-line-strong hover:shadow-sm",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                )}
              >
                {isLast && (
                  <span className="absolute right-4 top-4 rounded-full border border-line-strong px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-tertiary">
                    última usada
                  </span>
                )}

                <span className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-subtle text-ink transition-colors group-hover:bg-inverse group-hover:text-ink-inverse">
                  <Icon className="h-5 w-5" />
                </span>

                <div className="space-y-1.5">
                  <h2 className="text-lg font-medium tracking-[-0.015em] text-ink">{card.headline}</h2>
                  <p className="text-sm text-ink-secondary">{card.description}</p>
                </div>

                {card.bullets.length > 0 && (
                  <ul className="space-y-1 text-[13px] text-ink-tertiary">
                    {card.bullets.map((b) => (
                      <li key={b} className="flex items-center gap-2">
                        <span className="h-1 w-1 shrink-0 rounded-full bg-line-control" />
                        {b}
                      </li>
                    ))}
                  </ul>
                )}

                <span className="mt-auto inline-flex items-center gap-1.5 pt-2 text-sm font-medium text-ink">
                  Entrar
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </span>
              </button>
            );
          })}
        </div>

        <footer className="flex flex-col items-center gap-3 text-center">
          <p className="text-xs text-ink-tertiary">
            Você pode trocar de área depois pelo menu lateral, sem sair da conta.
          </p>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-tertiary transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sair da conta
          </button>
        </footer>
      </main>
    </div>
  );
}
