import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ZENDESK_STATUS_LABEL, type ZendeskTicketStatus } from "../types";

const STATUS_CLASS: Record<ZendeskTicketStatus, string> = {
  new: "bg-warning-soft text-warning",
  open: "bg-coral-soft text-destructive",
  pending: "bg-ice-soft text-info",
  hold: "bg-inverse text-ink-inverse",
  solved: "bg-signal-soft text-success",
  closed: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status }: { status: ZendeskTicketStatus }) {
  return (
    <Badge variant="secondary" className={cn("text-[10px]", STATUS_CLASS[status])}>
      {ZENDESK_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}
