import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Hono, serve } from "@emulators/core";
import { Store, WebhookDispatcher, authMiddleware, type TokenMap } from "@emulators/core";
import { put, head, list, del, copy, BlobNotFoundError, BlobAccessError } from "@vercel/blob";
import { vercelPlugin } from "../index.js";

const token = "vercel_blob_rw_teststore_secret";
const storeId = "teststore";

let emulatorUrl: string;
let apiUrl: string;
let closeServer: () => Promise<void>;

beforeAll(async () => {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const tokenMap: TokenMap = new Map();
  const app = new Hono();
  app.use("*", authMiddleware(tokenMap));

  const server = serve({ fetch: app.fetch, port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  emulatorUrl = `http://127.0.0.1:${port}`;
  apiUrl = `${emulatorUrl}/api/blob`;

  // Blob URLs embed the base URL, so register routes after the port is known.
  vercelPlugin.register(app as any, store, webhooks, emulatorUrl, tokenMap);
  vercelPlugin.seed?.(store, emulatorUrl);

  process.env.VERCEL_BLOB_API_URL = apiUrl;
  process.env.BLOB_READ_WRITE_TOKEN = token;

  closeServer = () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
});

afterAll(async () => {
  delete process.env.VERCEL_BLOB_API_URL;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  await closeServer();
});

describe("Vercel Blob via the @vercel/blob SDK", () => {
  it("put uploads bytes and the returned url serves them back", async () => {
    const data = randomBytes(1024);
    const result = await put("round-trip/data.bin", data, { access: "public", token });

    expect(result.pathname).toBe("round-trip/data.bin");
    expect(result.url).toBe(`${emulatorUrl}/blob/${storeId}/round-trip/data.bin`);
    expect(result.contentType).toBe("application/octet-stream");
    expect(result.contentDisposition).toBe('attachment; filename="data.bin"');

    const res = await fetch(result.url);
    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.equals(data)).toBe(true);
    expect(res.headers.get("etag")).toBe(result.etag);
    expect(res.headers.get("cache-control")).toBe("public, max-age=2592000");
  });

  it("put with addRandomSuffix appends a suffix before the extension", async () => {
    const result = await put("suffix/report.txt", "hello suffix", {
      access: "public",
      token,
      addRandomSuffix: true,
    });

    expect(result.pathname).toMatch(/^suffix\/report-[a-z0-9]+\.txt$/);
    expect(result.pathname).not.toBe("suffix/report.txt");

    const res = await fetch(result.url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello suffix");
    expect(res.headers.get("content-type")).toContain("text/plain");
  });

  it("put with allowOverwrite: false rejects when the blob already exists", async () => {
    await put("conflict/file.txt", "first", { access: "public", token });
    await expect(
      put("conflict/file.txt", "second", { access: "public", token, allowOverwrite: false }),
    ).rejects.toThrow(/allowOverwrite/);

    // The original content is untouched and allowOverwrite: true replaces it.
    const before = await fetch(`${emulatorUrl}/blob/${storeId}/conflict/file.txt`);
    expect(await before.text()).toBe("first");

    await put("conflict/file.txt", "second", { access: "public", token, allowOverwrite: true });
    const after = await fetch(`${emulatorUrl}/blob/${storeId}/conflict/file.txt`);
    expect(await after.text()).toBe("second");
  });

  it("head returns blob metadata", async () => {
    const uploaded = await put("meta/info.json", JSON.stringify({ ok: true }), {
      access: "public",
      token,
      cacheControlMaxAge: 60,
    });

    const meta = await head(uploaded.url, { token });
    expect(meta.pathname).toBe("meta/info.json");
    expect(meta.url).toBe(uploaded.url);
    expect(meta.downloadUrl).toBe(uploaded.downloadUrl);
    expect(meta.size).toBe(Buffer.byteLength(JSON.stringify({ ok: true })));
    expect(meta.contentType).toBe("application/json");
    expect(meta.contentDisposition).toBe('attachment; filename="info.json"');
    expect(meta.cacheControl).toBe("public, max-age=60");
    expect(meta.etag).toBe(uploaded.etag);
    expect(meta.uploadedAt).toBeInstanceOf(Date);
    expect(Number.isNaN(meta.uploadedAt.getTime())).toBe(false);
  });

  it("head falls back to BLOB_READ_WRITE_TOKEN when no token option is given", async () => {
    const uploaded = await put("meta/env-token.txt", "env token", { access: "public", token });
    const meta = await head(uploaded.url);
    expect(meta.pathname).toBe("meta/env-token.txt");
  });

  it("put accepts SDK OIDC auth with an explicit storeId", async () => {
    const uploaded = await put("auth/oidc.txt", "oidc token", {
      access: "public",
      oidcToken: "local-oidc-token",
      storeId,
    });

    expect(uploaded.url).toBe(`${emulatorUrl}/blob/${storeId}/auth/oidc.txt`);
    const res = await fetch(uploaded.url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("oidc token");
  });

  it("copy duplicates source content into the destination blob", async () => {
    const source = await put("copy/source.txt", "copy me", { access: "public", token });
    const copied = await copy(source.url, "copy/dest.txt", { access: "public", token });

    expect(copied.pathname).toBe("copy/dest.txt");
    const res = await fetch(copied.url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("copy me");

    const meta = await head(copied.url, { token });
    expect(meta.size).toBe("copy me".length);
    expect(meta.etag).toBe(source.etag);
  });

  it("list filters by prefix and returns metadata", async () => {
    await put("listing/a.txt", "a", { access: "public", token });
    await put("listing/b.txt", "b", { access: "public", token });
    await put("other/c.txt", "c", { access: "public", token });

    const result = await list({ prefix: "listing/", token });
    const pathnames = result.blobs.map((b) => b.pathname);
    expect(pathnames).toEqual(["listing/a.txt", "listing/b.txt"]);
    expect(result.hasMore).toBe(false);
    for (const blob of result.blobs) {
      expect(blob.url).toBe(`${emulatorUrl}/blob/${storeId}/${blob.pathname}`);
      expect(blob.size).toBe(1);
      expect(blob.uploadedAt).toBeInstanceOf(Date);
      expect(blob.etag).toMatch(/^"[0-9a-f]{64}"$/);
    }
  });

  it("list paginates with limit and cursor", async () => {
    await put("paging/1.txt", "1", { access: "public", token });
    await put("paging/2.txt", "2", { access: "public", token });
    await put("paging/3.txt", "3", { access: "public", token });

    const first = await list({ prefix: "paging/", limit: 2, token });
    expect(first.blobs.map((b) => b.pathname)).toEqual(["paging/1.txt", "paging/2.txt"]);
    expect(first.hasMore).toBe(true);
    expect(first.cursor).toBeDefined();

    const second = await list({ prefix: "paging/", cursor: first.cursor, token });
    expect(second.blobs.map((b) => b.pathname)).toEqual(["paging/3.txt"]);
    expect(second.hasMore).toBe(false);
  });

  it("del removes a blob and head then rejects with BlobNotFoundError", async () => {
    const uploaded = await put("deletion/gone.txt", "bye", { access: "public", token });
    await del(uploaded.url, { token });

    await expect(head(uploaded.url, { token })).rejects.toBeInstanceOf(BlobNotFoundError);
    const res = await fetch(uploaded.url);
    expect(res.status).toBe(404);
  });

  it("full blob URLs cannot target a different authenticated store", async () => {
    const otherToken = "vercel_blob_rw_otherstore_secret";
    const own = await put("store-scope/shared.txt", "own", { access: "public", token });
    const other = await put("store-scope/shared.txt", "other", { access: "public", token: otherToken });

    await expect(head(other.url, { token })).rejects.toBeInstanceOf(BlobNotFoundError);

    await del(other.url, { token });
    const ownRes = await fetch(own.url);
    const otherRes = await fetch(other.url);
    expect(ownRes.status).toBe(200);
    expect(await ownRes.text()).toBe("own");
    expect(otherRes.status).toBe(200);
    expect(await otherRes.text()).toBe("other");
  });

  it("downloadUrl serves the content with an attachment disposition", async () => {
    const uploaded = await put("downloads/manual.txt", "download me", { access: "public", token });

    const res = await fetch(uploaded.downloadUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="manual.txt"');
    expect(await res.text()).toBe("download me");

    // The plain url has no attachment disposition.
    const inline = await fetch(uploaded.url);
    expect(inline.headers.get("content-disposition")).toBeNull();
  });

  it("a bad token surfaces as BlobAccessError", async () => {
    await expect(list({ token: "not-a-blob-token" })).rejects.toBeInstanceOf(BlobAccessError);
  });
});

describe("Vercel Blob direct HTTP error shapes", () => {
  it("returns a 403 forbidden JSON body for a bad token", async () => {
    const res = await fetch(apiUrl, { headers: { authorization: "Bearer wrong" } });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("forbidden");
    expect(typeof body.error.message).toBe("string");
  });

  it("returns a 404 not_found JSON body when head misses", async () => {
    const res = await fetch(`${apiUrl}?url=${encodeURIComponent("missing/never-uploaded.txt")}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toBe("The requested blob does not exist");
  });
});

describe("Vercel Blob mounted under a path prefix", () => {
  // When embedded (e.g. the Next.js adapter serves the emulator at
  // /emulate/vercel), blob URLs carry the mount prefix and head/del/copy must
  // still resolve them.
  const prefixedBase = "http://app.example/emulate/vercel";
  const headers = { authorization: `Bearer ${token}` };

  function createPrefixedApp(): Hono {
    const store = new Store();
    const webhooks = new WebhookDispatcher();
    const app = new Hono();
    vercelPlugin.register(app as any, store, webhooks, prefixedBase);
    return app;
  }

  it("head resolves a blob URL that includes the mount prefix", async () => {
    const app = createPrefixedApp();
    const putRes = await app.request("/api/blob?pathname=prefixed/head.txt", {
      method: "PUT",
      headers,
      body: "head me",
    });
    const uploaded = (await putRes.json()) as { url: string };
    expect(uploaded.url).toBe(`${prefixedBase}/blob/${storeId}/prefixed/head.txt`);

    const headRes = await app.request(`/api/blob?url=${encodeURIComponent(uploaded.url)}`, { headers });
    expect(headRes.status).toBe(200);
    expect(((await headRes.json()) as { pathname: string }).pathname).toBe("prefixed/head.txt");
  });

  it("del resolves a blob URL that includes the mount prefix", async () => {
    const app = createPrefixedApp();
    const putRes = await app.request("/api/blob?pathname=prefixed/del.txt", {
      method: "PUT",
      headers,
      body: "delete me",
    });
    const uploaded = (await putRes.json()) as { url: string };

    const delRes = await app.request("/api/blob/delete", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ urls: [uploaded.url] }),
    });
    expect(delRes.status).toBe(200);

    const listRes = await app.request("/api/blob?prefix=prefixed/", { headers });
    expect(((await listRes.json()) as { blobs: unknown[] }).blobs).toHaveLength(0);
  });

  it("copy resolves a blob URL that includes the mount prefix", async () => {
    const app = createPrefixedApp();
    const putRes = await app.request("/api/blob?pathname=prefixed/source.txt", {
      method: "PUT",
      headers,
      body: "copy source",
    });
    const uploaded = (await putRes.json()) as { url: string };

    const copyRes = await app.request(
      `/api/blob?pathname=prefixed/copy.txt&fromUrl=${encodeURIComponent(uploaded.url)}`,
      {
        method: "PUT",
        headers,
      },
    );
    expect(copyRes.status).toBe(200);

    const headRes = await app.request(
      `/api/blob?url=${encodeURIComponent(`${prefixedBase}/blob/${storeId}/prefixed/copy.txt`)}`,
      { headers },
    );
    expect(headRes.status).toBe(200);
    expect(((await headRes.json()) as { size: number }).size).toBe("copy source".length);
  });

  it("does not strip the mount prefix from hosted Vercel Blob URLs", async () => {
    const app = createPrefixedApp();
    await app.request("/api/blob?pathname=emulate/vercel/hosted.txt", {
      method: "PUT",
      headers,
      body: "hosted path",
    });

    const hostedUrl = `https://${storeId}.public.blob.vercel-storage.com/emulate/vercel/hosted.txt`;
    const headRes = await app.request(`/api/blob?url=${encodeURIComponent(hostedUrl)}`, { headers });
    expect(headRes.status).toBe(200);
    expect(((await headRes.json()) as { pathname: string }).pathname).toBe("emulate/vercel/hosted.txt");
  });
});
