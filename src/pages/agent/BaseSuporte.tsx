import { ExternalLink } from "lucide-react";

// A Base Suporte é um HTML estático e autossuficiente (CSS/JS próprios) servido
// de /base-suporte.html. Fica em um iframe de propósito: assim os estilos globais
// dele não vazam para o app nem o app interfere no layout da base.
const BASE_SUPORTE_URL = "/base-suporte.html";

export default function BaseSuporte() {
  return (
    <div className="relative">
      <a
        href={BASE_SUPORTE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-md bg-black/60 px-2.5 py-1.5 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-black/75"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        Abrir em nova aba
      </a>

      <iframe
        src={BASE_SUPORTE_URL}
        title="Base Suporte"
        className="block h-[calc(100vh-3rem)] w-full border-0 bg-white"
      />
    </div>
  );
}
