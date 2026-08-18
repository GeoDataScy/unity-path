import { SupportBaseScreen } from "@/features/support-base/components/SupportBaseScreen";

// Mesma base que o agente vê em /workspace/base-suporte. O copy tem só leitura —
// quem edita produto, brand e mensagem é a gestora em /dashboard/base.
export default function CopyBaseSuporte() {
  return <SupportBaseScreen />;
}
