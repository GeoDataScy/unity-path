import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, BarChart3, ClipboardList, Loader2, LogOut, PenLine } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { getMeStatus, recordAuthEvent } from "@/lib/userSession";
import {
  AREA_LABEL,
  AREA_PATH,
  LAST_AREA_KEY,
  areasForRole,
  hasAreaChoice,
  homePathForRole,
  isValidArea,
  type AppArea,
} from "@/lib/roles";
import logo from "@/assets/logo-xmx.png";
import { cn } from "@/lib/utils";

// Escolha de área depois do login, para quem tem acesso a mais de uma
// (gestora e time de copy). É uma tela e não um modal de propósito: sobrevive a
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
      setAreas(areasForRole(profile?.role));
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
        <Loader2 className="h-6 w-6 animate-spin text-white/60" />
      </div>
    );
  }

  const firstName = (fullName ?? "").trim().split(/\s+/)[0];

  return (
    <div className="min-h-screen bg-login-bg flex items-center justify-center p-4 sm:p-8">
      {/* Brilho roxo do logo, só decoração */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(60% 45% at 50% 0%, hsl(263 70% 62% / 0.22) 0%, transparent 70%)",
        }}
      />

      <main className="relative w-full max-w-4xl space-y-10 animate-in fade-in-50 duration-500">
        <header className="flex flex-col items-center gap-6 text-center">
          <img src={logo} alt="XMX" className="h-14 w-auto" />
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-semibold text-white">
              {firstName ? `Olá, ${firstName}` : "Bem-vindo de volta"}
            </h1>
            <p className="text-sm text-white/60">Escolha a área que você quer acessar agora.</p>
          </div>
        </header>

        <div className={cn("grid gap-4", areas.length > 1 && "sm:grid-cols-2")}>
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
                  "group relative flex h-full flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-left",
                  "transition duration-200 hover:-translate-y-0.5 hover:border-primary/60 hover:bg-white/[0.07]",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-black",
                )}
              >
                {isLast && (
                  <span className="absolute right-4 top-4 rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/60">
                    última usada
                  </span>
                )}

                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary transition group-hover:bg-primary/25">
                  <Icon className="h-5 w-5" />
                </span>

                <div className="space-y-1.5">
                  <h2 className="text-lg font-semibold text-white">{card.headline}</h2>
                  <p className="text-sm text-white/60">{card.description}</p>
                </div>

                {card.bullets.length > 0 && (
                  <ul className="space-y-1 text-[13px] text-white/45">
                    {card.bullets.map((b) => (
                      <li key={b} className="flex items-center gap-2">
                        <span className="h-1 w-1 shrink-0 rounded-full bg-primary/70" />
                        {b}
                      </li>
                    ))}
                  </ul>
                )}

                <span className="mt-auto inline-flex items-center gap-1.5 pt-2 text-sm font-medium text-primary">
                  Entrar
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </span>
              </button>
            );
          })}
        </div>

        <footer className="flex flex-col items-center gap-3 text-center">
          <p className="text-xs text-white/40">
            Você pode trocar de área depois pelo menu lateral, sem sair da conta.
          </p>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-white/50 transition hover:text-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sair da conta
          </button>
        </footer>
      </main>
    </div>
  );
}
