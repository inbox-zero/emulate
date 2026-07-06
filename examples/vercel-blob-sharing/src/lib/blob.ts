// The @vercel/blob SDK reads its API endpoint and token from the environment
// on every call. Point it at the emulator embedded in this app unless the
// caller has already configured a real store.
const port = process.env.PORT ?? "3000";
process.env.VERCEL_BLOB_API_URL ??= `http://localhost:${port}/emulate/vercel/api/blob`;
// Any token of the form vercel_blob_rw_<storeId>_<secret> is accepted by the
// emulator; the storeId segment must not contain underscores.
process.env.BLOB_READ_WRITE_TOKEN ??= "vercel_blob_rw_devstore_devsecret";

export { put, head, list, del, BlobNotFoundError } from "@vercel/blob";
