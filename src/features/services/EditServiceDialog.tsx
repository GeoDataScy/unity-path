import { useMemo, useState } from "react";
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
import type { ServiceItem } from "@/features/services/useMyServicesQuery";
import { CONTACT_REASONS, type ContactReasonCode } from "@/features/services/contact-reasons";

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
] as const;

const CHANNELS = ["Nenhum", "Clickbank", "Email", "SMS"] as const;

type Props = {
  service: ServiceItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (next: { client_email: string; product: string; platform: string; channel: string; contact_reason: string | null }) => Promise<void>;
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

  const canSave = useMemo(() => {
    return Boolean(clientEmail) && Boolean(product) && Boolean(platform) && !saving;
  }, [clientEmail, product, platform, saving]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        client_email: clientEmail,
        product,
        platform,
        channel,
        contact_reason: contactReason || null,
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
            <Select value={product} onValueChange={setProduct}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {PRODUCTS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              onValueChange={(v) => setContactReason(v as ContactReasonCode)}
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
