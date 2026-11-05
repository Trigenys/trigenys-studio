import type { MediaObject, MediaStore } from "../types.ts";

// Private R2 bucket: objects are only ever served through the API, after RBAC.
export class R2MediaStore implements MediaStore {
  readonly name = "r2";
  bucket: R2Bucket;
  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }
  async put(key: string, bytes: Uint8Array, mime: string): Promise<void> {
    await this.bucket.put(key, bytes as unknown as ArrayBuffer, { httpMetadata: { contentType: mime } });
  }
  async get(key: string): Promise<MediaObject | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;
    return { bytes: new Uint8Array(await object.arrayBuffer()), mime: object.httpMetadata?.contentType ?? "application/octet-stream" };
  }
}
