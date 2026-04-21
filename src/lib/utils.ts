import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeText(value: string) {
  return normalizeWhitespace(
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
      .toLowerCase()
  );
}

export function slugify(value: string) {
  return normalizeText(value).replace(/\s+/g, "-");
}

export function dedupe<T>(values: T[]) {
  return [...new Set(values)];
}

export function getInitials(value: string) {
  return normalizeWhitespace(value)
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function titleCase(value: string) {
  return normalizeWhitespace(value)
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function safeJsonParse<T>(input: string, fallback: T): T {
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

export function buildCacheKey(parts: Array<string | undefined>) {
  return parts
    .filter(Boolean)
    .map((part) => slugify(part as string))
    .join(":");
}
