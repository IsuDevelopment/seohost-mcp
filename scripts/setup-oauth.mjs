import { randomBytes, scryptSync } from "node:crypto";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

// Run in a terminal: passwords are never printed, written in plaintext or sent elsewhere.
if (!process.stdin.isTTY)
  throw new Error("Run setup:oauth in an interactive terminal");
const file = process.argv[2] || ".env";
let muted = false;
const output = new Writable({
  write(chunk, _encoding, callback) {
    if (!muted) process.stdout.write(chunk);
    callback();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: true });
try {
  const original = await readFile(file, "utf8");
  const username = (await rl.question("Owner username: ")).trim();
  if (!/^[a-zA-Z0-9_.@-]{1,100}$/.test(username))
    throw new Error("Invalid username");
  const redirects = (
    await rl.question("Exact HTTPS OAuth callback URI(s), comma-separated: ")
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    !redirects.length ||
    redirects.some((value) => {
      const u = new URL(value);
      return (
        u.protocol !== "https:" ||
        u.hash ||
        u.username ||
        u.password ||
        /[\r\n]/.test(value)
      );
    })
  )
    throw new Error("Invalid callback URI");
  process.stdout.write("New owner password (minimum 16 characters): ");
  muted = true;
  const password = await rl.question("");
  muted = false;
  process.stdout.write("\nRepeat password: ");
  muted = true;
  const confirmation = await rl.question("");
  muted = false;
  process.stdout.write("\n");
  if (
    password.length < 16 ||
    password.length > 1024 ||
    password !== confirmation
  )
    throw new Error("Passwords must match and contain 16–1024 characters");
  const salt = randomBytes(16).toString("hex");
  const hash = salt + ":" + scryptSync(password, salt, 64).toString("hex");
  const vars = {
    MCP_LOCAL_OAUTH: "true",
    MCP_OWNER_USERNAME: username,
    MCP_OWNER_PASSWORD_HASH: hash,
    MCP_OAUTH_REDIRECT_URIS: redirects.join(","),
    MCP_OAUTH_STATE_FILE: "data/oauth.sqlite",
  };
  const replaced = new Set([
    ...Object.keys(vars),
    "MCP_OAUTH_ISSUER",
    "MCP_OAUTH_AUDIENCE",
    "MCP_OAUTH_SUBJECTS",
  ]);
  const clean = original
    .split("\n")
    .filter((line) => !replaced.has(line.split("=")[0]?.trim()))
    .join("\n")
    .trimEnd();
  await writeFile(
    file,
    clean +
      "\n" +
      Object.entries(vars)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n") +
      "\n",
    { mode: 0o600 },
  );
  await chmod(file, 0o600);
  console.error(
    `Owner configuration saved in ${file}; plaintext password was not saved. Restart the MCP application after deployment.`,
  );
} finally {
  muted = false;
  rl.close();
}
