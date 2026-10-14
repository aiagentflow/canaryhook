import { randomToken, type Decoy } from "./state.js";

interface Template {
  path: string;
  kind: string;
  /** Builds the decoy's unique canary string. */
  token: () => string;
  body: (token: string) => string;
}

/**
 * Decoys are chosen so that no build, test, lint or runtime path in a normal
 * project has any reason to open them. That is what keeps false positives near
 * zero: a hit means something went looking for credentials.
 */
const TEMPLATES: Template[] = [
  {
    path: ".env.backup",
    kind: "env",
    token: () => `AKIA${randomToken(16)}`,
    body: (token) =>
      [
        "# superseded 2026-03-11, kept until the rotation is signed off",
        "AWS_ACCESS_KEY_ID=" + token,
        "AWS_SECRET_ACCESS_KEY=" + randomToken(40),
        "AWS_REGION=ap-southeast-1",
        "",
      ].join("\n"),
  },
  {
    path: "credentials.json.bak",
    kind: "json",
    token: () => `sk_live_${randomToken(24)}`,
    body: (token) =>
      `${JSON.stringify(
        {
          provider: "stripe",
          mode: "live",
          secret_key: token,
          rotated_at: "2026-03-11T09:14:22Z",
        },
        null,
        2,
      )}\n`,
  },
  {
    path: "deploy_key.old",
    kind: "sshkey",
    token: () => randomToken(32),
    body: (token) =>
      [
        "-----BEGIN OPENSSH PRIVATE KEY-----",
        `b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2${token}`,
        randomToken(64),
        randomToken(64),
        "-----END OPENSSH PRIVATE KEY-----",
        "",
      ].join("\n"),
  },
  {
    path: "db_dump_2026.sql",
    kind: "sql",
    token: () => randomToken(28),
    body: (token) =>
      [
        "-- partial dump, staging replica",
        "INSERT INTO service_accounts (name, api_token) VALUES",
        `  ('billing-worker', '${token}');`,
        "",
      ].join("\n"),
  },
];

export function buildDecoys(): { decoy: Decoy; body: string }[] {
  return TEMPLATES.map((template) => {
    const token = template.token();
    return {
      decoy: { path: template.path, token, kind: template.kind },
      body: template.body(token),
    };
  });
}
