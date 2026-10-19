import { cn } from "@/lib/utils";

type Props = { className?: string };

/**
 * Símbolo da área Análises Geovani: releitura simplificada da marca do Jupyter —
 * dois arcos laranja (as "órbitas") e três luas. As luas usam currentColor para
 * acompanhar o tema; o laranja é fixo porque é o que faz a marca ser reconhecida.
 */
export function JupyterMark({ className }: Props) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-6 w-6", className)} aria-hidden="true" focusable="false">
      <path d="M4.5 12.2C7.6 5.6 24.4 5.6 27.5 12.2 22.6 8.9 9.4 8.9 4.5 12.2Z" fill="#f37626" />
      <path d="M4.5 19.8C7.6 26.4 24.4 26.4 27.5 19.8 22.6 23.1 9.4 23.1 4.5 19.8Z" fill="#f37626" />
      <circle cx="25.6" cy="4.4" r="1.9" fill="currentColor" opacity="0.72" />
      <circle cx="6.6" cy="27.4" r="2.3" fill="currentColor" opacity="0.72" />
      <circle cx="5.6" cy="5.4" r="1.15" fill="currentColor" opacity="0.72" />
    </svg>
  );
}
