import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        open: "border-transparent bg-status-open text-status-open-foreground hover:bg-status-open/90",
        new: "border-transparent bg-status-new text-status-new-foreground hover:bg-status-new/90",
        success: "border-transparent bg-status-success text-status-success-foreground hover:bg-status-success/90",
        "in-progress": "border-transparent bg-status-in-progress text-status-in-progress-foreground hover:bg-status-in-progress/90",
        done: "border-transparent bg-status-done text-status-done-foreground hover:bg-status-done/90",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "border-line-strong text-ink-secondary",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
