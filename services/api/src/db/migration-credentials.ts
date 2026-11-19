// Connection options for drizzle-kit migrations, derived from DATABASE_URL.
// The AppFactory database lease returns a URL without `sslmode`, so TLS with
// certificate verification is enforced here for every non-local host. Errors
// never echo the URL: it carries the database password.

export type MigrationCredentials = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: "verify-full" | false;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function migrationCredentials(raw: string): MigrationCredentials {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL is not a valid PostgreSQL URL.");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must use the postgresql:// scheme.");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!url.hostname || !url.username || !database) {
    throw new Error("DATABASE_URL must include a host, a user and a database.");
  }
  // Plain TCP only for a local server or an explicit `sslmode=disable`
  // (for example a Postgres container reached by its service name).
  const plain = LOCAL_HOSTS.has(url.hostname) || url.searchParams.get("sslmode") === "disable";
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    ssl: plain ? false : "verify-full",
  };
}
