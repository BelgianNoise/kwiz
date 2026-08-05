import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** The shadcn/ui class merge helper. Generated components import this from `@/lib/utils`. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
