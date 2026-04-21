import type { NextRequest } from "next/server";
import { cookies } from "next/headers";

export const AUTH_COOKIE_NAME = "almatrace_unlock";
const AUTH_COOKIE_TTL_SECONDS = 24 * 60 * 60;

interface UnlockPayload {
  exp: number;
}

function getPin() {
  return process.env.ALMATRACE_PIN ?? "085213";
}

function getAuthSecret() {
  return process.env.ALMATRACE_AUTH_SECRET ?? "almatrace-local-auth-secret";
}

function encodeBase64Url(input: string | Uint8Array) {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(`${normalized}${padding}`);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function importHmacKey() {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getAuthSecret()),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign", "verify"]
  );
}

async function signPayload(payload: string) {
  const key = await importHmacKey();
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );

  return encodeBase64Url(new Uint8Array(signature));
}

async function verifySignature(payload: string, signature: string) {
  const key = await importHmacKey();
  return crypto.subtle.verify(
    "HMAC",
    key,
    decodeBase64Url(signature),
    new TextEncoder().encode(payload)
  );
}

export function getPinCookieMaxAge() {
  return AUTH_COOKIE_TTL_SECONDS;
}

export function isValidPin(pin: string) {
  return pin === getPin();
}

export async function createUnlockToken() {
  const payload: UnlockPayload = {
    exp: Date.now() + AUTH_COOKIE_TTL_SECONDS * 1000
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = await signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function verifyUnlockToken(token?: string | null) {
  if (!token) {
    return false;
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return false;
  }

  const isValid = await verifySignature(encodedPayload, signature);
  if (!isValid) {
    return false;
  }

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(encodedPayload))
    ) as UnlockPayload;

    return typeof payload.exp === "number" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

export async function isUnlockedRequest(request: Pick<NextRequest, "cookies">) {
  return verifyUnlockToken(request.cookies.get(AUTH_COOKIE_NAME)?.value);
}

export async function isUnlockedSession() {
  return verifyUnlockToken(cookies().get(AUTH_COOKIE_NAME)?.value);
}
