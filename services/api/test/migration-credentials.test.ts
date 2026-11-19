import { describe, expect, it } from "vitest";
import { migrationCredentials } from "../src/db/migration-credentials.ts";

// The AppFactory lease strips `sslmode`: migrations must still use verified TLS.

describe("migration credentials", () => {
  it("enforces verified TLS for a leased Neon URL without sslmode", () => {
    expect(migrationCredentials("postgresql://trigenys_studio_owner:p%40ss@ep-x.eu-central-1.aws.neon.tech/trigenys_studio")).toEqual({
      host: "ep-x.eu-central-1.aws.neon.tech",
      port: 5432,
      user: "trigenys_studio_owner",
      password: "p@ss",
      database: "trigenys_studio",
      ssl: "verify-full",
    });
  });

  it("keeps verified TLS even when the URL asks for a weaker mode", () => {
    expect(migrationCredentials("postgres://u:p@db.example:6543/app?sslmode=prefer")).toMatchObject({ port: 6543, ssl: "verify-full" });
  });

  it("allows plain TCP only locally or with an explicit sslmode=disable", () => {
    expect(migrationCredentials("postgresql://u:p@localhost:5432/app").ssl).toBe(false);
    expect(migrationCredentials("postgresql://u:p@127.0.0.1/app").ssl).toBe(false);
    expect(migrationCredentials("postgresql://u:p@postgres/app?sslmode=disable").ssl).toBe(false);
  });

  it("rejects malformed URLs without echoing the password", () => {
    for (const raw of ["not a url secret", "mysql://u:secret@h/db", "postgresql://u:secret@h/", "postgresql://h/db"]) {
      expect(() => migrationCredentials(raw)).toThrow(/DATABASE_URL/);
      expect(() => migrationCredentials(raw)).not.toThrow(/secret/);
    }
  });
});
