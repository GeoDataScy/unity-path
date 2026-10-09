import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import type { ServiceItem } from "@/features/services/useMyServicesQuery";
import {
  CONTACT_REASONS,
  CONTACT_REASON_NOTE_MAX_LENGTH,
  getContactReasonNoteCopy,
  normalizeContactReasonNote,
  requiresContactReasonNote,
  type ContactReasonCode,
} from "@/features/services/contact-reasons";
import { ProductCombobox } from "@/features/services/ProductCombobox";

const PRODUCTS = [
  "Arialief",
  "Alphacur",
  "Blinzador",
  "Feilaira",
  "Garaherb",
  "Karylief",
  "Kymezol",
  "Jertaris",
  "Laellium",
  "Memyts",
  "Presgera",
  "Biografa",
  "Cetacondor",
  "Cetadusse",
  "Sciatilief",
  "Goldenfrib",
  "Felaromi",
  "Tenurima",
  "Ariovira",
  "CucuDrops",
  "Zalovira",
  "Xelovita",
  "Cerami",
  "NATHUREX",
  "Mahgryn",
  "Levhyn",
  "Ariomyx",
  "Alitoryn",
  "Athentys",
  "Velynivo",
  "Mioralab",
  "Vergolief",
  "Olisteren",
  "Halegryn",
  "Danmyts",
  "Maizkidor",
  "Basmontex",
  "Fraganief",
  "Ceramiri",
  "Shapeon",
  "Nexburn",
  "Memoryon",
  "Korvizol",
  "Erectozyn",
  "Thewellnesswize",
  "VIP.Shipping",
  "VisualEase",
  "NerveEase",
  "Steelpower",
  "Gluco Off",
  "Cognivex",
  "Nad Dermal+",
  "Alpharock",
  "Hair Bloom",
  "Guardon",
  "Joint Mend",
  "Keskara",
  "Lipolegs",
  "LipoShape",
  "Mind Recall",
  "Mind Wake",
  "Prostate Vital",
  "Quiet Nerves",
  "Quiet Rest",
  "RingSilence",
  "FlowStrong",
  "Youth Within",
  "Thermo Ignite",
  "Glyco Barrier",
  "Gluco Mild",
  "Horsefil",
  "Honeyfil",
  "Clear Gaze",
  "PagAmerican",
  "Jellyrock",
  "Blue Horse",
  "Nail Defender",
  "Mind Honey Trick",
  "Nerve Relief Protocol",
  "Lean Leg",
  "Soda Burn",
  "Nerve Stride",
  "Honey Vital",
  "Cardio Honey",
  "Gut Active",
  "Military Honey",
  "Golden Nerves",
  "Balancemax",
  "Beautycell",
  "Bicarburn",
  "Brainignition",
  "BuzzBalance",
  "Cinna Nerves",
  "Cognishift",
  "Curvereset",
  "Deep Ease",
  "Effect Plus",
  "Family Health Corner",
  "Farulena",
  "Firm Flow",
  "Flora Harmony",
  "FlowerNerves",
  "Gluco Quiet",
  "Glucopoise",
  "Glucoserene",
  "Glyco Oliva",
  "Hard Peak",
  "Honey Protocol",
  "Im Mush",
  "Joint Relax",
  "Lipo Jelly",
  "Magnesium Uni5",
  "Nerve Relief Gelatin",
  "One Click Health",
  "Peak Rises",
  "Prime Greens",
  "Red Horse",
  "Rose Memory",
  "Sharpfocus",
  "Skinfortify",
  "Stallion Force",
  "Strong Peak",
  "Trace Eraser",
  "Vapo Mind",
  "Velvet Lift",
  "Vigor Jelly",
  "Virilemax",
  "Vitahear",
  "Your Health World",
] as const;

const PLATFORMS = [
  "Nenhum",
  "Cartpanda",
  "CartCandy",
  "Buygoods",
  "ClickBank",
  "Digistore24",
  "SalesBound",
  "LogiCall",
  "PagAmerican",
] as const;

const CHANNELS = ["Nenhum", "Clickbank", "Email", "SMS"] as const;

type Props = {
  service: ServiceItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (next: { client_email: string; product: string; platform: string; channel: string; contact_reason: string | null; contact_reason_note: string | null; order_id: string | null }) => Promise<void>;
};

export function EditServiceDialog({ service, open, onOpenChange, onSave }: Props) {
  const [saving, setSaving] = useState(false);
  const [clientEmail, setClientEmail] = useState(service.client_email);
  const [product, setProduct] = useState(service.product);
  const [platform, setPlatform] = useState(service.platform ?? "");
  const [channel, setChannel] = useState(service.channel ?? "Nenhum");
  const [contactReason, setContactReason] = useState<ContactReasonCode | "">(
    (service.contact_reason as ContactReasonCode | null) ?? "",
  );
  const [contactReasonNote, setContactReasonNote] = useState(service.contact_reason_note ?? "");
  const [orderId, setOrderId] = useState("");

  const isRefund = contactReason === "reembolso";
  const contactReasonNoteCopy = getContactReasonNoteCopy(contactReason);

  // order_id não vem na listagem (my_recent_services), então é buscado ao abrir —
  // sem isso, salvar apagaria o número do pedido já gravado.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("services")
        .select("order_id")
        .eq("id", service.id)
        .maybeSingle();
      if (error) {
        console.error("[edit-service] fetch order_id failed:", error);
        return;
      }
      // types.ts é gerado e ainda não conhece services.order_id.
      const row = data as unknown as { order_id: string | null } | null;
      if (!cancelled) setOrderId(row?.order_id ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [open, service.id]);

  const canSave = useMemo(() => {
    const orderOk = !isRefund || orderId.trim().length > 0;
    // Motivo que pede descrição só é salvável com o texto preenchido.
    const reasonOk =
      !requiresContactReasonNote(contactReason) || contactReasonNote.trim().length > 0;
    return (
      Boolean(clientEmail) && Boolean(product) && Boolean(platform) && orderOk && reasonOk && !saving
    );
  }, [clientEmail, product, platform, isRefund, orderId, contactReason, contactReasonNote, saving]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        client_email: clientEmail,
        product,
        platform,
        channel,
        contact_reason: contactReason || null,
        contact_reason_note: normalizeContactReasonNote(contactReason, contactReasonNote),
        order_id: orderId.trim() || null,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar atendimento</DialogTitle>
          <DialogDescription>Atualize os dados do registro e salve.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="edit-client-email">E-mail do Cliente</Label>
            <Input
              id="edit-client-email"
              type="email"
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
              placeholder="cliente@email.com"
            />
          </div>

          <div className="grid gap-2">
            <Label>Produto</Label>
            <ProductCombobox value={product} onChange={setProduct} options={PRODUCTS} />
          </div>

          <div className="grid gap-2">
            <Label>Plataforma</Label>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {PLATFORMS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Canal</Label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {CHANNELS.map((ch) => (
                  <SelectItem key={ch} value={ch}>
                    {ch}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Motivo de contato</Label>
            <Select
              value={contactReason}
              onValueChange={(v) => {
                setContactReason(v as ContactReasonCode);
                if (!requiresContactReasonNote(v)) setContactReasonNote("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {CONTACT_REASONS.map((r) => (
                  <SelectItem key={r.code} value={r.code}>
                    <span className="flex items-center gap-2">
                      <span className={`inline-block h-2 w-2 rounded-full ${r.dot}`} />
                      {r.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {contactReasonNoteCopy && (
            <div className="grid gap-2">
              <Label htmlFor="edit-contact-reason-note">{contactReasonNoteCopy.label}</Label>
              <Textarea
                id="edit-contact-reason-note"
                value={contactReasonNote}
                onChange={(e) =>
                  setContactReasonNote(e.target.value.slice(0, CONTACT_REASON_NOTE_MAX_LENGTH))
                }
                maxLength={CONTACT_REASON_NOTE_MAX_LENGTH}
                rows={2}
                placeholder={contactReasonNoteCopy.placeholder}
              />
              <p className="text-xs text-muted-foreground">
                {contactReasonNoteCopy.hint}{" "}
                {contactReasonNote.length}/{CONTACT_REASON_NOTE_MAX_LENGTH}
              </p>
            </div>
          )}

          {isRefund && (
            <div className="grid gap-2">
              <Label htmlFor="edit-order-id">Número do pedido</Label>
              <Input
                id="edit-order-id"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                placeholder="Ex: 12345"
              />
              <p className="text-xs text-muted-foreground">
                Usado no registro da aba Reembolsos, que é criado e mantido em dia a partir deste atendimento.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSave} disabled={!canSave}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
