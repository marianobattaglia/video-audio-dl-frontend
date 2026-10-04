import { cp, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);

export async function build({ local = false } = {}) {
  const raw = process.env.API_BASE_URL || (local ? "http://localhost:3000" : "");
  if (!raw) throw new Error("Set API_BASE_URL to the backend origin before building.");
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || !["http:", "https:"].includes(url.protocol)) {
    throw new Error("API_BASE_URL must be an HTTP/HTTPS origin without credentials, path, query or fragment.");
  }
  if (!local && url.protocol !== "https:") throw new Error("Deployed API_BASE_URL must use HTTPS.");
  const output = new URL("dist/", root);
  await mkdir(output, { recursive: true });
  await cp(new URL("public/", root), output, { recursive: true });
  // Only this public setting is serialized. Never serialize process.env.
  await writeFile(new URL("config.js", output), `window.APP_CONFIG = Object.freeze(${JSON.stringify({ apiBaseUrl: url.origin })});\n`);
  return fileURLToPath(output);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await build();
  process.stdout.write("Static frontend built in dist/\n");
}
