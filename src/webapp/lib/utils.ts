import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Adds an optional `ref` field to a props type. Used by shadcn-svelte
 * components so callers can `bind:ref`. (Standard shadcn-svelte helper.)
 */
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
  ref?: U | null
}

/** Adds optional `ref` and `children` slot for components that wrap content. */
export type WithoutChildrenOrChild<T> = Omit<T, 'children' | 'child'>

/** Standard shadcn-svelte helper: omit `child` snippet from props. */
export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, 'child'> : T

/** Standard shadcn-svelte helper: omit `children` snippet from props. */
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, 'children'> : T
