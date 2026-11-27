// BI_SERVER_ENGAGEMENT_v1
import { describe, expect, it } from "vitest";
import { classifyReply, replyBody } from "../classifyReply";

describe("classifyReply", () => {
  it.each([
    ["Please remove me from your list", "unsubscribe"],
    ["I am no longer with the company, please contact Jo", "wrong_person"],
    ["Not interested, thanks", "not_interested"],
    ["Not at this time - check back next quarter", "not_now"],
    ["Sounds interesting, let's set up a call", "interested"],
    ["What does it cover and how do you price it?", "question"],
    ["Thanks", "other"],
  ])("%s -> %s", (body, kind) => expect(classifyReply("RE: hello", body)).toBe(kind));
  it("reads only the new words, not the quoted email", () => {
    expect(replyBody("Yes please\n\nOn Mon, Andrew wrote:\n> Are you interested?")).toBe("Yes please");
    expect(classifyReply("RE: x", "Yes please\n\nOn Mon, Andrew wrote:\n> are you interested?")).toBe("other");
  });
});
