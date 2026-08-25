import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Table primitives.
 *
 * Authored here rather than ported from the template — Google Drive had
 * it locked when this landed — but follows the same conventions as the
 * rest of components/ui (data-slot, cn(), token-driven colour) and adds
 * the eYKON house styling the admin surfaces had been hand-rolling:
 * mono uppercase headers, hairline row rules, and a row hover state.
 *
 * That hover is the point. Every admin table repeated the same th/td
 * style objects inline, and an inline style cannot express :hover, so
 * scanning a wide row had no visual anchor at all.
 */

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    // The wrapper owns the horizontal scroll, so a wide table never makes
    // the whole page scroll sideways.
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn("w-full caption-bottom border-collapse text-[13px]", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn(className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={cn(className)} {...props} />
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("border-t border-eykon-rule-soft font-medium", className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-eykon-rule-soft transition-colors",
        "hover:bg-eykon-bg-raised/60 data-[state=selected]:bg-eykon-bg-raised",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "whitespace-nowrap border-b border-eykon-rule-soft px-3.5 py-2.5 text-left align-middle",
        "font-mono text-[9.5px] font-normal uppercase tracking-[0.16em] text-eykon-ink-faint",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("px-3.5 py-2.5 align-middle", className)}
      {...props}
    />
  )
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-3 text-[12px] text-eykon-ink-faint", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
