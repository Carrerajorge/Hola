import { describe, expect, it } from "vitest";
import { parseWhatsAppCommand, stripIliaMentionPrefix } from "../../server/integrations/whatsappWebCommands";

describe("whatsappWebCommands", () => {
  it("strips ILIA mention prefix", () => {
    expect(stripIliaMentionPrefix("ILIA help")).toEqual({ mentioned: true, cleanedText: "help" });
    expect(stripIliaMentionPrefix("@ILIA: status")).toEqual({ mentioned: true, cleanedText: "status" });
    expect(stripIliaMentionPrefix("hola")).toEqual({ mentioned: false, cleanedText: "hola" });
  });

  it("parses pairing", () => {
    expect(parseWhatsAppCommand("PAIR ABCD1234EF56")).toEqual({ type: "pair", code: "ABCD1234EF56" });
    expect(parseWhatsAppCommand("ilia pair abcd1234")).toEqual({ type: "pair", code: "ABCD1234" });
    expect(parseWhatsAppCommand("/vincular 00FF")).toEqual({ type: "pair", code: "00FF" });
  });

  it("parses basic commands", () => {
    expect(parseWhatsAppCommand("HELP")).toEqual({ type: "help" });
    expect(parseWhatsAppCommand("estado")).toEqual({ type: "status" });
    expect(parseWhatsAppCommand("STOP")).toEqual({ type: "stop" });
    expect(parseWhatsAppCommand("continuar")).toEqual({ type: "start" });
    expect(parseWhatsAppCommand("desvincular")).toEqual({ type: "unpair" });
  });

  it("parses indexed/list commands", () => {
    expect(parseWhatsAppCommand("CHATS")).toEqual({ type: "chats", limit: undefined });
    expect(parseWhatsAppCommand("CHATS 15")).toEqual({ type: "chats", limit: 15 });
    expect(parseWhatsAppCommand("OPEN 3")).toEqual({ type: "open", index: 3 });
    expect(parseWhatsAppCommand("PIN 2")).toEqual({ type: "pin", index: 2 });
    expect(parseWhatsAppCommand("UNPIN 2")).toEqual({ type: "unpin", index: 2 });
    expect(parseWhatsAppCommand("ARCHIVE 9")).toEqual({ type: "archive", index: 9 });
    expect(parseWhatsAppCommand("UNARCHIVE 9")).toEqual({ type: "unarchive", index: 9 });
  });
});

