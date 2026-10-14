import { AwsClient } from "aws4fetch";

/**
 * Private R2 bucket access, following ChaosPatch's lib/r2.ts (presigned PUT for upload,
 * presigned GET for every read, no public access), but on aws4fetch instead of the AWS
 * SDK: it's SigV4 over fetch + Web Crypto, so it runs on the edge MCP route and on
 * Cloudflare Workers unchanged.
 */

export class R2NotConfiguredError extends Error {
  constructor() {
    super(
      "Attachments aren't set up on the server yet (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME).",
    );
  }
}

// Read env per call so a missing var fails the attachment tools, not the whole route.
const r2 = (): { client: AwsClient; base: string } => {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) throw new R2NotConfiguredError();
  return {
    client: new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" }),
    base: `https://${accountId}.r2.cloudflarestorage.com/${bucket}`,
  };
};

const objectUrl = (base: string, key: string): URL =>
  new URL(`${base}/${key.split("/").map(encodeURIComponent).join("/")}`);

/**
 * Presign a short-lived PUT URL. Content-Type is signed into the URL (aws4fetch skips it
 * unless allHeaders is set), so the uploader must send exactly that type.
 */
export const presignPutUrl = async (
  key: string,
  contentType: string,
  expiresSeconds = 15 * 60,
): Promise<string> => {
  const { client, base } = r2();
  const url = objectUrl(base, key);
  url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
  const signed = await client.sign(
    new Request(url, { method: "PUT", headers: { "Content-Type": contentType } }),
    { aws: { signQuery: true, allHeaders: true } },
  );
  return signed.url;
};

/** Presign a short-lived GET URL. Every read goes through this; the bucket isn't public. */
export const presignGetUrl = async (key: string, expiresSeconds = 60 * 60): Promise<string> => {
  const { client, base } = r2();
  const url = objectUrl(base, key);
  url.searchParams.set("X-Amz-Expires", String(expiresSeconds));
  const signed = await client.sign(new Request(url, { method: "GET" }), {
    aws: { signQuery: true },
  });
  return signed.url;
};

/** An uploaded object's type and size, or null if it isn't there (never uploaded, or expired PUT). */
export const headObject = async (
  key: string,
): Promise<{ contentType: string | null; size: number | null } | null> => {
  const { client, base } = r2();
  const res = await client.fetch(objectUrl(base, key), { method: "HEAD" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 HEAD failed (${res.status}) for ${key}`);
  const length = res.headers.get("content-length");
  return {
    contentType: res.headers.get("content-type"),
    size: length === null ? null : Number(length),
  };
};

/** Delete an object. Already gone counts as success. */
export const deleteObject = async (key: string): Promise<void> => {
  const { client, base } = r2();
  const res = await client.fetch(objectUrl(base, key), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE failed (${res.status}) for ${key}`);
};
