import { useOutletContext } from "react-router-dom";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CopyOutletContext } from "@/layouts/CopyLayout";

export default function CopyHome() {
  const { fullName } = useOutletContext<CopyOutletContext>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          {fullName ? `Olá, ${fullName}` : "Painel do Copy"}
        </h1>
        <p className="text-muted-foreground mt-1">Área exclusiva do time de copy.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Em construção</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          As ferramentas do time de copy aparecem aqui conforme forem liberadas. Por enquanto,
          use o menu lateral para navegar.
        </CardContent>
      </Card>
    </div>
  );
}
