import type * as React from "react";
import { cn } from "@/lib/utils";

/** A grid of label/value pairs. */
function StatGrid({ className, ...props }: React.ComponentProps<"dl">) {
  return <dl data-slot="stat-grid" className={cn("my-3 grid grid-cols-2 gap-x-3 gap-y-2", className)} {...props} />;
}

/** One label/value pair; put it in a StatGrid (it renders dt/dd). */
function Stat({ label, labelTitle, className, children, ...props }: Omit<React.ComponentProps<"div">, "children"> & { label: React.ReactNode; labelTitle?: string; children: React.ReactNode }) {
  return (
    <div data-slot="stat" className={cn("min-w-0", className)} {...props}>
      <dt className="caps text-muted-foreground" title={labelTitle}>
        {label}
      </dt>
      <dd className="m-0 text-sm wrap-anywhere">{children}</dd>
    </div>
  );
}

/** A labelled block of text: a small caption over a paragraph. */
function Detail({ label, className, children, ...props }: Omit<React.ComponentProps<"div">, "children"> & { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div data-slot="detail" className={cn("my-3", className)} {...props}>
      <div className="caps mb-0.5 text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

export { StatGrid, Stat, Detail };
