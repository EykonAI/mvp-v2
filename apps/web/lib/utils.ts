import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Class-name combiner for the shadcn/ui component layer (components/ui/*).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
