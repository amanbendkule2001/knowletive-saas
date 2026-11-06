import "server-only";

import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileKind } from "@prisma/client";

/**
 * Private object storage with two interchangeable backends:
 *
 * - `s3`: any S3-compatible service (AWS S3, Cloudflare R2, MinIO, Backblaze).
 *   Activated by STORAGE_BUCKET + STORAGE_ACCESS_KEY_ID + STORAGE_SECRET_ACCESS_KEY.
 * - `local`: development fallback under `.data/uploads`. Files are streamed by
 *   an authenticated route and never served from /public.
 *
 * Uploads go server-side through a server action; downloads either redirect to a
 * short-lived signed URL (S3) or stream from disk (local). No bucket is public.
 */

export type StorageProvider = "s3" | "local";

const LOCAL_ROOT = process.env.STORAGE_LOCAL_DIR
  ? path.resolve(process.env.STORAGE_LOCAL_DIR)
  : path.join(process.cwd(), ".data", "uploads");

export function storageProvider(): StorageProvider {
  return process.env.STORAGE_BUCKET &&
    process.env.STORAGE_ACCESS_KEY_ID &&
    process.env.STORAGE_SECRET_ACCESS_KEY
    ? "s3"
    : "local";
}

export function storageProviderName() {
  return storageProvider() === "s3"
    ? (process.env.STORAGE_ENDPOINT?.includes("r2.cloudflarestorage.com") ? "cloudflare-r2" : "s3")
    : "local";
}

export function buildStorageKey(tenantId: string, kind: FileKind, filename: string) {
  const safe = filename
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-80) || "file";
  return `${tenantId}/${kind.toLowerCase()}/${randomUUID()}-${safe}`;
}

// ─────────────────────────────── Local backend ───────────────────────────────

function localPath(key: string) {
  const resolved = path.resolve(LOCAL_ROOT, key);
  if (!resolved.startsWith(path.resolve(LOCAL_ROOT) + path.sep)) {
    throw new Error("Invalid storage key");
  }
  return resolved;
}

async function localPut(key: string, body: Buffer) {
  const target = localPath(key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
}

export async function localRead(key: string) {
  return readFile(localPath(key));
}

export async function localRemove(key: string) {
  await rm(localPath(key), { force: true });
}

// ─────────────────────────────── S3 / R2 backend ───────────────────────────────

function s3Config() {
  const endpoint = (process.env.STORAGE_ENDPOINT ?? "https://s3.amazonaws.com").replace(/\/$/, "");
  return {
    endpoint,
    bucket: process.env.STORAGE_BUCKET!,
    region: process.env.STORAGE_REGION ?? "auto",
    accessKey: process.env.STORAGE_ACCESS_KEY_ID!,
    secretKey: process.env.STORAGE_SECRET_ACCESS_KEY!,
    host: new URL(endpoint).host,
  };
}

function sha256Hex(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function encodeRfc3986(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalPath(bucket: string, key: string) {
  return `/${bucket}/${key.split("/").map(encodeRfc3986).join("/")}`;
}

function signingKey(secretKey: string, dateStamp: string, region: string) {
  const dateKey = hmac(`AWS4${secretKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function amzNow() {
  const iso = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

async function s3Request(method: "PUT" | "DELETE", key: string, body?: Buffer, contentType?: string) {
  const config = s3Config();
  const { amzDate, dateStamp } = amzNow();
  const payloadHash = sha256Hex(body ?? "");
  const uri = canonicalPath(config.bucket, key);
  const headers: Record<string, string> = {
    host: config.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;
  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map((name) => `${name}:${headers[name]}\n`).join("");
  const canonicalRequest = [
    method,
    uri,
    "",
    canonicalHeaders,
    signedHeaders.join(";"),
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = createHmac("sha256", signingKey(config.secretKey, dateStamp, config.region))
    .update(stringToSign)
    .digest("hex");

  const response = await fetch(`${config.endpoint}${uri}`, {
    method,
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signedHeaders.join(";")}, Signature=${signature}`,
    },
    body: body ? new Uint8Array(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Storage ${method} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
}

export async function presignedDownloadUrl(key: string, expiresIn = 300) {
  const config = s3Config();
  const { amzDate, dateStamp } = amzNow();
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const uri = canonicalPath(config.bucket, key);
  const query = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKey}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresIn),
    "X-Amz-SignedHeaders": "host",
  });
  const canonicalQuery = [...query.entries()]
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .sort()
    .join("&");
  const canonicalRequest = [
    "GET",
    uri,
    canonicalQuery,
    `host:${config.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = createHmac("sha256", signingKey(config.secretKey, dateStamp, config.region))
    .update(stringToSign)
    .digest("hex");
  return `${config.endpoint}${uri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// ─────────────────────────────── Public API ───────────────────────────────

export async function putObject(key: string, body: Buffer, contentType: string) {
  if (storageProvider() === "s3") {
    await s3Request("PUT", key, body, contentType);
    return;
  }
  await localPut(key, body);
}

export async function removeObject(key: string) {
  if (storageProvider() === "s3") {
    await s3Request("DELETE", key);
    return;
  }
  await localRemove(key);
}

export async function objectDownload(key: string) {
  if (storageProvider() === "s3") {
    return { kind: "redirect" as const, url: await presignedDownloadUrl(key) };
  }
  return { kind: "stream" as const, body: await localRead(key) };
}
