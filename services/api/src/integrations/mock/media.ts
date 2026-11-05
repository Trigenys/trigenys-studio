import type { MediaObject, MediaStore } from "../types.ts";

// In-memory store for tests and local development: not durable, by design.
export class MemoryMediaStore implements MediaStore {
  readonly name = "memory";
  objects: Map<string, MediaObject>;
  constructor() {
    this.objects = new Map();
  }
  async put(key: string, bytes: Uint8Array, mime: string): Promise<void> {
    this.objects.set(key, { bytes, mime });
  }
  async get(key: string): Promise<MediaObject | null> {
    return this.objects.get(key) ?? null;
  }
}
