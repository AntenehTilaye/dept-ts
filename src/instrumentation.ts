// Next 16 instrumentation hook: runs once per server process before any request.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootstrap } = await import("./lib/bootstrap");
    bootstrap();
  }
}
