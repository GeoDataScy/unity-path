import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { InputLogin } from "@/components/ui/input-login";
import { useToast } from "@/hooks/use-toast";
import logo from "@/assets/logo-xmx.png";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    // Check if user is already logged in
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await redirectUser(session.user.id);
      }
    };
    checkSession();
  }, []);

  const redirectUser = async (userId: string) => {
    try {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();

      if (error) throw error;

      if (profile?.role === "manager") {
        navigate("/dashboard");
      } else {
        navigate("/workspace");
      }
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
    setLoading(true);

    try {
      if (isLogin) {
        // Login
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
      } else {
        // Signup
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
          },
        });

        if (error) throw error;

        toast({
          title: "Conta criada!",
          description: "Você já pode fazer login.",
        });
        setIsLogin(true);
      }
    } catch (error: any) {
      toast({
        title: "Erro",
        description: error.message || "Ocorreu um erro durante a autenticação.",
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
          <img 
            src={logo} 
            alt="XMX Logo" 
            className="w-32 h-auto animate-in zoom-in-50 duration-700"
          />
          
          <div className="w-full space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-semibold text-white">
                {isLogin ? "Bem-vindo de volta" : "Criar conta"}
              </h1>
              <p className="text-sm text-muted-foreground/80">
                {isLogin ? "Faça login para continuar" : "Cadastre-se para começar"}
              </p>
            </div>

            <form onSubmit={handleAuth} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium text-white/90">
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
                <label htmlFor="password" className="text-sm font-medium text-white/90">
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
                className="w-full h-12 text-base font-medium"
                disabled={loading}
              >
                {loading ? "Carregando..." : isLogin ? "Entrar" : "Criar conta"}
              </Button>
            </form>

            <div className="text-center">
              <button
                type="button"
                onClick={() => setIsLogin(!isLogin)}
                className="text-sm text-muted-foreground/80 hover:text-primary transition-colors duration-200"
              >
                {isLogin ? "Não tem conta? Cadastre-se" : "Já tem conta? Faça login"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
