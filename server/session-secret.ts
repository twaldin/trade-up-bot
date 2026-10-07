// express-session signs with the first secret and verifies with every secret.

export const DEV_SESSION_SECRET = "trade-up-bot-dev-secret";
export const MIN_PRODUCTION_SESSION_SECRET_LENGTH = 32;

export class SessionSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionSecretError";
  }
}

export function productionSessionSecretRefusal(secret: string): string | null {
  const value = secret.trim();
  if (value.length === 0) return "Refusing to start: SESSION_SECRET is missing in production.";
  if (value === DEV_SESSION_SECRET) return "Refusing to start: SESSION_SECRET is the dev default in production.";
  if (value.length < MIN_PRODUCTION_SESSION_SECRET_LENGTH) {
    return `Refusing to start: SESSION_SECRET is shorter than ${MIN_PRODUCTION_SESSION_SECRET_LENGTH} characters in production.`;
  }
  return null;
}

/** Signing secret, or [current, previous] so existing cookies still verify. */
export function resolveSessionSecrets(env: NodeJS.ProcessEnv): string | string[] {
  const secret = (env.SESSION_SECRET ?? "").trim();
  const previous = (env.SESSION_SECRET_PREVIOUS ?? "").trim();
  if (env.NODE_ENV === "production") {
    const refusal = productionSessionSecretRefusal(secret);
    if (refusal) throw new SessionSecretError(refusal);
  }
  const signing = secret || DEV_SESSION_SECRET;
  if (!previous || previous === signing) return signing;
  return [signing, previous];
}

export function sessionSecretRotationWarning(env: NodeJS.ProcessEnv): string | null {
  const secret = (env.SESSION_SECRET ?? "").trim();
  const previous = (env.SESSION_SECRET_PREVIOUS ?? "").trim();
  const signing = secret || (env.NODE_ENV === "production" ? "" : DEV_SESSION_SECRET);
  if (!previous || previous === signing) return null;
  if (previous === DEV_SESSION_SECRET) {
    return "SESSION_SECRET_PREVIOUS is the dev default. Cookies signed with that known secret still verify until it is removed.";
  }
  return "SESSION_SECRET_PREVIOUS is set. Existing session cookies still verify. New cookies use SESSION_SECRET.";
}
