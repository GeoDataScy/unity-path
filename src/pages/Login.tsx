import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { InputLogin } from "@/components/ui/input-login";
import { useToast } from "@/hooks/use-toast";
import { getMeStatus, recordAuthEvent } from "@/lib/userSession";
import { homePathForRole } from "@/lib/roles";
import { Logo } from "@/components/brand/Logo";

function isNetworkError(error: unknown): boolean {
  if (!error) return false;
  const msg = (error as { message?: string }).message ?? "";
  const name = (error as { name?: string }).name ?? "";
  return (
    /failed to fetch/i.test(msg) ||
    /network/i.test(msg) ||
    /load failed/i.test(msg) ||
    name === "AuthRetryableFetchError" ||
    name === "TypeError"
  );
}

const NETWORK_ERROR_MESSAGE =
  "Não conseguimos conectar ao servidor. Verifique sua internet, desative VPN/antivírus/extensões e tente novamente. Se persistir, troque o DNS da sua rede para 1.1.1.1 ou 8.8.8.8.";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    // Listen for auth changes — avoids race condition when redirected after signOut
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "SIGNED_IN" && session) {
          redirectUser(session.user.id);
        }
      }
    );

    // Also check existing session on mount (e.g. page refresh while logged in)
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error || !session) {
        // Clear stale/invalid session
        supabase.auth.signOut();
        return;
      }
      redirectUser(session.user.id);
    });

    // Healthcheck: ping Supabase REST root to detect DNS/network blocks before user tries to log in.
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    if (supabaseUrl) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      fetch(`${supabaseUrl}/auth/v1/health`, { signal: ctrl.signal, mode: "cors" })
        .then(() => setReachable(true))
        .catch(() => setReachable(false))
        .finally(() => clearTimeout(timer));
      return () => {
        clearTimeout(timer);
        ctrl.abort();
        subscription.unsubscribe();
      };
    }

    return () => subscription.unsubscribe();
  }, []);

  const redirectUser = async (userId: string) => {
    try {
      const status = await getMeStatus();
      if (!status.is_active) {
        await supabase.auth.signOut({ scope: "local" });
        navigate("/blocked", { replace: true });
        return;
      }
    } catch {
      // If me_status fails, fall through and rely on the profile fetch below.
    }

    try {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();

      if (error) throw error;

      // Best-effort: record login event. Non-blocking.
      recordAuthEvent("login").catch(() => {});

      navigate(homePathForRole(profile?.role));
    } catch (error) {
      console.error("Error fetching profile:", error);
      toast({
        title: "Erro",
        description: "Não foi possível carregar o perfil do usuário.",
        variant: "destructive",
      });
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      toast({
        title: "Sem conexão",
        description: "Você parece estar offline. Verifique sua internet e tente novamente.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      if (data.user) {
        await redirectUser(data.user.id);
        toast({
          title: "Bem-vindo!",
          description: "Login realizado com sucesso.",
        });
      }
    } catch (error: any) {
      const description = isNetworkError(error)
        ? NETWORK_ERROR_MESSAGE
        : error?.message || "Ocorreu um erro durante a autenticação.";
      toast({
        title: isNetworkError(error) ? "Falha de conexão" : "Erro",
        description,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-login-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8 animate-in fade-in-50 duration-500">
        <div className="flex flex-col items-center space-y-8">
          <Logo height={40} className="animate-in fade-in-0 duration-500" />
          
          <div className="w-full space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-[48px] font-medium leading-[52px] tracking-[-0.035em] text-ink">Bem-vindo de volta</h1>
              <p className="text-sm text-ink-tertiary">Faça login para continuar</p>
            </div>

            {reachable === false && (
              <div className="rounded-lg border border-warning/40 bg-amber-soft p-3 text-sm text-ink">
                <p className="font-medium">Não conseguimos alcançar o servidor.</p>
                <p className="mt-1 text-ink-secondary">
                  Sua rede está bloqueando o acesso. Desative VPN/antivírus, troque o DNS
                  para 1.1.1.1 ou 8.8.8.8, ou tente em outra rede (ex.: 4G do celular).
                </p>
              </div>
            )}

            <form onSubmit={handleAuth} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-[13px] font-medium text-ink">
                  Email
                </label>
                <InputLogin
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="text-[13px] font-medium text-ink">
                  Senha
                </label>
                <InputLogin
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>

              <Button
                type="submit"
                className="w-full h-11 text-[15px] font-medium"
                disabled={loading}
              >
                {loading ? "Carregando..." : "Entrar"}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
