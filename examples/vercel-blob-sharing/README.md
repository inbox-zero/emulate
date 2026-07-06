# File Sharing with Vercel Blob

A Next.js app demonstrating file uploads with [Vercel Blob](https://vercel.com/docs/vercel-blob), powered by the emulated Vercel Blob API from `emulate`.

No real blob store is touched. The emulator keeps every file in-memory, so you can upload, share, download, and delete files entirely locally using the official `@vercel/blob` SDK.

## How it works

1. Drop a file on the upload zone (or click to browse) — uploads are capped at 50 MB
2. A server action uploads it with `put()` from `@vercel/blob`, using `addRandomSuffix` so repeated filenames never collide
3. You're redirected to a share page that loads metadata with `head()` — size, content type, ETag, cache control — with an inline preview for images
4. The download button uses the blob's `downloadUrl`, which serves the bytes with an attachment disposition
5. The home page lists everything in the store via `list()` and deletes files via `del()`

The `@vercel/blob` SDK reads `VERCEL_BLOB_API_URL` and `BLOB_READ_WRITE_TOKEN` from the environment on every call. `src/lib/blob.ts` points them at the emulator embedded in this app (`/emulate/vercel/api/blob`) and re-exports the SDK, so the rest of the code imports from `@/lib/blob` and otherwise uses the SDK exactly as it would in production.

The emulator accepts any token of the form `vercel_blob_rw_<storeId>_<secret>` (the storeId segment must not contain underscores) — this example uses `vercel_blob_rw_devstore_devsecret`. Uploads go through a server action because the emulator implements the server-side blob API (`put`, `head`, `list`, `del`, `copy`); client/browser uploads and multipart uploads are not supported yet.

## Getting started

The dev script uses [portless](https://github.com/vercel-labs/portless), so install it once if you haven't: `npm i -g portless`.

From the repository root:

```bash
pnpm install
pnpm build   # builds the workspace emulator packages once
pnpm --filter vercel-blob-sharing dev
```

Open [https://vercel-blob-sharing.emulate.localhost](https://vercel-blob-sharing.emulate.localhost) (or the `http://localhost:<port>` URL printed by portless).

Files live in-memory, so restarting the dev server clears the store. Blob URLs embed the origin of the first request to reach the emulator, so stick to one of the two URLs.

## Talking to the emulator directly

Upload a file:

```bash
curl -X PUT "https://vercel-blob-sharing.emulate.localhost/emulate/vercel/api/blob?pathname=docs/hello.txt" \
  -H "Authorization: Bearer vercel_blob_rw_devstore_devsecret" \
  -d "hello blob"
```

List stored blobs:

```bash
curl "https://vercel-blob-sharing.emulate.localhost/emulate/vercel/api/blob" \
  -H "Authorization: Bearer vercel_blob_rw_devstore_devsecret"
```

Fetch a blob's public content (no auth required):

```bash
curl "https://vercel-blob-sharing.emulate.localhost/emulate/vercel/blob/devstore/docs/hello.txt"
```

Delete blobs:

```bash
curl -X POST "https://vercel-blob-sharing.emulate.localhost/emulate/vercel/api/blob/delete" \
  -H "Authorization: Bearer vercel_blob_rw_devstore_devsecret" \
  -H "Content-Type: application/json" \
  -d '{"urls": ["docs/hello.txt"]}'
```

## Project structure

```
src/
  app/
    page.tsx                    Upload zone + recent uploads (list/del)
    upload-zone.tsx             Client component: drag-and-drop upload
    actions.ts                  Server actions (put, del)
    f/
      [...pathname]/
        page.tsx                Share page: metadata via head(), download
    emulate/
      [...path]/route.ts        Embedded emulator (Vercel)
  components/
    copy-link-button.tsx        Client component: copy share link
    file-row.tsx                Client component: upload row with delete
    share-link-field.tsx        Client component: share URL + copy button
  lib/
    blob.ts                     @vercel/blob configured for the emulator
    format.ts                   Byte/date formatting helpers
    limits.ts                   Upload size cap shared with next.config.ts
    share-url.ts                Share route encoding helpers
```
