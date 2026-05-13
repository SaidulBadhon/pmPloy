import { sign, verify } from "hono/jwt";
import { env } from "../env.ts";

const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7;

export type JwtPayload = {
  sub: string;
  email: string;
  exp: number;
  iat: number;
};

export async function issueToken(user: { id: string; email: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      sub: user.id,
      email: user.email,
      iat: now,
      exp: now + SEVEN_DAYS_SECONDS,
    } satisfies JwtPayload,
    env.JWT_SECRET,
  );
}

export async function readToken(token: string): Promise<JwtPayload | null> {
  try {
    const payload = (await verify(token, env.JWT_SECRET, "HS256")) as JwtPayload;
    return payload;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = "pmploy_session";
export const SESSION_MAX_AGE = SEVEN_DAYS_SECONDS;
