import { useEffect } from "react";

import { supabase } from "@/integrations/supabase/client";

const Blocked = () => {
  useEffect(() => {
    supabase.auth.signOut({ scope: "local" }).catch(() => {});
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("sb-")) localStorage.removeItem(key);
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <p className="text-center text-base text-foreground">
        O acesso ao sistema foi bloqueado para este usuário.
      </p>
    </div>
  );
};

export default Blocked;
