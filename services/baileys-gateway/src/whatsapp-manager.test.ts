import { describe, expect, it } from "vitest";
import { hasLinkedWhatsAppCredentials } from "./whatsapp-manager.js";

describe("hasLinkedWhatsAppCredentials", () => {
  it("recognizes a pairing-code session", () => {
    expect(hasLinkedWhatsAppCredentials({ registered: true })).toBe(true);
  });

  it("recognizes a QR-linked Baileys 7 session", () => {
    expect(
      hasLinkedWhatsAppCredentials({
        registered: false,
        me: { id: "5511999999999:1@s.whatsapp.net" },
        account: {},
      })
    ).toBe(true);
  });

  it("does not treat a provisional pairing-code identity as linked", () => {
    expect(
      hasLinkedWhatsAppCredentials({
        registered: false,
        me: { id: "5511999999999@s.whatsapp.net" },
      })
    ).toBe(false);
  });
});
