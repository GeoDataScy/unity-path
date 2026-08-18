import { ExternalLink } from "lucide-react";

// Mesma base que o agente vê em /workspace/base-suporte: um HTML estático e
// autossuficiente servido de /base-suporte.html, dentro de iframe para os
// estilos dele não vazarem para o app (e vice-versa). O copy tem só leitura —
// quem edita produto/mensagem é a gestora.
//
// Não reaproveita o componente do agente por um detalhe de layout: no /copy o
// ThemeToggle é fixo no canto superior direito, então o botão "abrir em nova
// aba" precisa de folga para não ficar embaixo dele.
const BASE_SUPORTE_URL = "/base-suporte.html";

export default function CopyBaseSuporte() {
  return (
    <div className="relative">
      <a
        href={BASE_SUPORTE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute right-16 top-3 z-10 inline-flex items-center gap-1.5 rounded-md bg-black/60 px-2.5 py-1.5 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-black/75"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        Abrir em nova aba
      </a>

      <iframe
        src={BASE_SUPORTE_URL}
        title="Base de Suporte"
        className="block h-screen w-full border-0 bg-white"
      />
    </div>
  );
}
