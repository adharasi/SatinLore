import { createHash, randomBytes } from "node:crypto";

const username = process.argv[2];
if (!['Dilan', 'Sadie'].includes(username) || process.argv.length !== 3) {
  console.error("Run locally: node scripts/create-alpha-credentials.mjs Dilan (or Sadie)");
  process.exitCode = 2;
} else {
  const password = randomBytes(32).toString("base64url");
  const verifier = createHash("sha256").update(password, "utf8").digest("hex");
  console.log(`Username: ${username}\nPassword: ${password}\nALPHA_${username.toUpperCase()}_VERIFIER: ${verifier}`);
}
