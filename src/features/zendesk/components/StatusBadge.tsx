import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ZENDESK_STATUS_LABEL, type ZendeskTicketStatus } from "../types";

const STATUS_CLASS: Record<ZendeskTicketStatus, string> = {
  new: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  open: "bg-red-500/15 text-red-700 dark:text-red-300",
  pending: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  hold: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  solved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  closed: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status }: { status: ZendeskTicketStatus }) {
  return (
    <Badge variant="secondary" className={cn("text-[10px]", STATUS_CLASS[status])}>
      {ZENDESK_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}
