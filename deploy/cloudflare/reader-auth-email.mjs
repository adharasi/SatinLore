const encode = value => new TextEncoder().encode(value);
const hex = value => Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, "0")).join("");
const sha256 = async value => hex(await crypto.subtle.digest("SHA-256", encode(value)));

async function hmac(key, value) {
  const signingKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", signingKey, encode(value));
}

/** Send a single transactional message via the regional SES v2 endpoint using SigV4. */
export async function sendReaderCode(config, recipient, code, fetcher = fetch) {
  const { region, from, accessKey, secretKey, sessionToken } = config;
  const host = `email.${region}.amazonaws.com`;
  const path = "/v2/email/outbound-emails";
  const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = timestamp.slice(0, 8);
  const content = JSON.stringify({
    FromEmailAddress: from,
    Destination: { ToAddresses: [recipient] },
    Content: { Simple: {
      Subject: { Charset: "UTF-8", Data: "Your SatinLore sign-in code" },
      Body: { Text: {
        Charset: "UTF-8",
        Data: `Your SatinLore sign-in code is ${code}. It expires in 10 minutes. Enter it on app.satinlore.com to continue. If you did not request this code, you can ignore this email.`,
      } },
    } },
  });
  const hash = await sha256(content);
  const headers = {
    "content-type": "application/json",
    host,
    "x-amz-content-sha256": hash,
    "x-amz-date": timestamp,
    ...(sessionToken ? { "x-amz-security-token": sessionToken } : {}),
  };
  const names = Object.keys(headers).sort();
  const signed = names.join(";");
  const canonicalHeaders = names.map(name => `${name}:${headers[name]}\n`).join("");
  const canonicalRequest = ["POST", path, "", canonicalHeaders, signed, hash].join("\n");
  const scope = `${date}/${region}/ses/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", timestamp, scope, await sha256(canonicalRequest)].join("\n");
  const dateKey = await hmac(encode("AWS4" + secretKey), date);
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, "ses");
  const signingKey = await hmac(serviceKey, "aws4_request");
  const signature = hex(await hmac(signingKey, stringToSign));
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
  const response = await fetcher(`https://${host}${path}`, {
    method: "POST", headers, body: content, redirect: "manual", signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Sign-in email delivery failed.");
  }
  const accepted = await response.json();
  if (typeof accepted?.MessageId !== "string" || !accepted.MessageId) throw new Error("Sign-in email delivery was not confirmed.");
}
