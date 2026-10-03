import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isValidMetaSignature, parseMetaWebhook } from "../src/lib/meta/webhook";

describe("Meta webhook signature", () => {
  const secret = "test-app-secret";
  const body = JSON.stringify({ object: "page", entry: [] });
  const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

  it("accepts a correctly signed body", () => {
    expect(isValidMetaSignature(body, sig, secret)).toBe(true);
  });
  it("rejects a tampered body, wrong secret, missing header, or missing secret", () => {
    expect(isValidMetaSignature(body + " ", sig, secret)).toBe(false);
    expect(isValidMetaSignature(body, sig, "other")).toBe(false);
    expect(isValidMetaSignature(body, null, secret)).toBe(false);
    expect(isValidMetaSignature(body, sig, undefined)).toBe(false);
  });
});

describe("parseMetaWebhook", () => {
  it("parses a Messenger DM and ignores echoes and the page's own messages", () => {
    const events = parseMetaWebhook({
      object: "page",
      entry: [
        {
          id: "PAGE1",
          messaging: [
            { sender: { id: "U1" }, message: { mid: "m1", text: "Hi, price?" } },
            { sender: { id: "PAGE1" }, message: { mid: "m2", text: "our reply" } },
            { sender: { id: "U2" }, message: { mid: "m3", text: "echo", is_echo: true } },
            { sender: { id: "U3" }, message: { mid: "m4", attachments: [{ type: "image" }] } },
          ],
        },
      ],
    });
    expect(events).toEqual([
      { kind: "message", platform: "facebook", accountId: "PAGE1", senderId: "U1", text: "Hi, price?", id: "m1" },
      { kind: "message", platform: "facebook", accountId: "PAGE1", senderId: "U3", text: "[attachment]", id: "m4" },
    ]);
  });

  it("parses Facebook comments (new ones from others only) and lead ads", () => {
    const events = parseMetaWebhook({
      object: "page",
      entry: [
        {
          id: "PAGE1",
          changes: [
            { field: "feed", value: { item: "comment", verb: "add", comment_id: "c1", from: { id: "U1", name: "Ada" }, message: "Interested!" } },
            { field: "feed", value: { item: "comment", verb: "add", comment_id: "c2", from: { id: "PAGE1", name: "Us" }, message: "thanks" } },
            { field: "feed", value: { item: "comment", verb: "edited", comment_id: "c3", from: { id: "U1" }, message: "x" } },
            { field: "feed", value: { item: "post", verb: "add" } },
            { field: "leadgen", value: { leadgen_id: "L1", page_id: "PAGE1", form_id: "F1" } },
          ],
        },
      ],
    });
    expect(events).toEqual([
      { kind: "comment", platform: "facebook", accountId: "PAGE1", senderId: "U1", senderName: "Ada", text: "Interested!", id: "c1" },
      { kind: "leadgen", accountId: "PAGE1", leadgenId: "L1" },
    ]);
  });

  it("parses Instagram DMs and comments", () => {
    const events = parseMetaWebhook({
      object: "instagram",
      entry: [
        {
          id: "IG1",
          messaging: [{ sender: { id: "S1" }, message: { mid: "im1", text: "hello" } }],
          changes: [{ field: "comments", value: { id: "ic1", text: "how much?", from: { id: "S2", username: "bola" } } }],
        },
      ],
    });
    expect(events).toEqual([
      { kind: "message", platform: "instagram", accountId: "IG1", senderId: "S1", text: "hello", id: "im1" },
      { kind: "comment", platform: "instagram", accountId: "IG1", senderId: "S2", senderName: "bola", text: "how much?", id: "ic1" },
    ]);
  });

  it("returns nothing for garbage or unrelated objects", () => {
    expect(parseMetaWebhook(null)).toEqual([]);
    expect(parseMetaWebhook({ object: "whatsapp_business_account", entry: [] })).toEqual([]);
    expect(parseMetaWebhook({ object: "page", entry: [{ messaging: [{}] }] })).toEqual([]);
  });
});
