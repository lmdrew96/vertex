import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { R2NotConfiguredError, presignGetUrl, presignPutUrl } from "./r2";

const ENV = {
  R2_ACCOUNT_ID: "acct123",
  R2_ACCESS_KEY_ID: "AKIDEXAMPLE",
  R2_SECRET_ACCESS_KEY: "secretexample",
  R2_BUCKET_NAME: "vertex",
};

beforeEach(() => Object.assign(process.env, ENV));
afterEach(() => {
  for (const k of Object.keys(ENV)) delete process.env[k];
});

describe("presignPutUrl", () => {
  it("signs Content-Type into a query-signed URL on the bucket", async () => {
    const url = new URL(await presignPutUrl("vertex/g1/att1/psac agenda.pdf", "application/pdf", 900));
    expect(url.origin).toBe("https://acct123.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/vertex/vertex/g1/att1/psac%20agenda.pdf");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("presignGetUrl", () => {
  it("signs only host for downloads", async () => {
    const url = new URL(await presignGetUrl("vertex/g1/att1/a.png"));
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });

  it("fails clearly when R2 isn't configured", async () => {
    delete process.env.R2_BUCKET_NAME;
    await expect(presignGetUrl("x")).rejects.toBeInstanceOf(R2NotConfiguredError);
  });
});
