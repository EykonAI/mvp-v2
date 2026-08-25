import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Form label. Authored here rather than ported from the template
 * because Google Drive had the template locked when this landed;
 * it follows the same conventions as the other primitives in this
 * directory (data-slot, cn(), token-driven colours) and needs no
 * Radix dependency.
 */
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none",
        "group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
