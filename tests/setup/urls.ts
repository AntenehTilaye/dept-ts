/** Returns the connection string with the `schema` search-path parameter replaced. */
export function withSchema(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  url.searchParams.set("schema", schema);
  return url.toString();
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set (see compose.yaml test/e2e services)`);
  return value;
}
