import { timingSafeEqual } from "node:crypto";

export function isStrongSecret(secret: string | null | undefined) {
  return Boolean(secret && Buffer.byteLength(secret) >= 32);
}

export function secretsMatch(
  received: string | null | undefined,
  expected: string | null | undefined
) {
  if (!received || !expected) return false;

  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(receivedBuffer, expectedBuffer);
}
