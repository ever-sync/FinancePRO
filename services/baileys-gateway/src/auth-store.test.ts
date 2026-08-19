import { describe, expect, it } from "vitest";
import { decryptAuthValue, encryptAuthValue } from "./auth-store.js";

describe("encrypted auth values", () => {
  it("preserves Baileys buffer values", () => {
    const key = Buffer.alloc(32, 3);
    const original = {
      registrationId: 42,
      signedIdentityKey: Buffer.from("private-auth-material"),
    };
    const encrypted = encryptAuthValue(original, key);
    const decrypted = decryptAuthValue(encrypted, key) as typeof original;

    expect(encrypted.ciphertext.toString("utf8")).not.toContain(
      "private-auth-material"
    );
    expect(decrypted.registrationId).toBe(42);
    expect(Buffer.from(decrypted.signedIdentityKey)).toEqual(
      original.signedIdentityKey
    );
  });

  it("rejects the wrong key", () => {
    const encrypted = encryptAuthValue({ secret: true }, Buffer.alloc(32, 1));
    expect(() => decryptAuthValue(encrypted, Buffer.alloc(32, 2))).toThrow();
  });
});
