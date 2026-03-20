// Steam OpenID authentication + session management.

import passport from "passport";
import { Strategy as SteamStrategy } from "passport-steam";
import session from "express-session";
import type { Express, Request, Response, NextFunction } from "express";
import pg from "pg";
// SQLite only for session store — sessions stay in SQLite for simplicity
import Database from "better-sqlite3";
import { DB_PATH } from "./db.js";

// SQLite session store extending express-session.Store (provides regenerate/save/etc)
class SqliteSessionStore extends session.Store {
  private sessionDb: Database.Database;
  constructor(dbPath: string) {
    super();
    // Separate DB file for sessions — never contends with daemon writes
    const sessionPath = dbPath.replace(/[^/\\]+$/, "sessions.db");
    this.sessionDb = new Database(sessionPath);
    this.sessionDb.pragma("journal_mode = WAL");
    this.sessionDb.pragma("busy_timeout = 2000");
    this.sessionDb.exec(`CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expired INTEGER NOT NULL)`);
    this.sessionDb.exec("CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired)");
    try { this.sessionDb.exec("DELETE FROM sessions WHERE expired < " + Math.floor(Date.now() / 1000)); } catch { /* ignore */ }
  }
  get(sid: string, cb: (err: any, sess?: session.SessionData | null) => void) {
    try {
      const row = this.sessionDb.prepare("SELECT sess FROM sessions WHERE sid = ? AND expired > ?").get(sid, Math.floor(Date.now() / 1000)) as { sess: string } | undefined;
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch { cb(null, null); }
  }
  set(sid: string, sess: session.SessionData, cb?: (err?: any) => void) {
    try {
      const maxAge = sess.cookie?.maxAge || 30 * 24 * 60 * 60 * 1000;
      const expired = Math.floor((Date.now() + maxAge) / 1000);
      this.sessionDb.prepare("INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)").run(sid, JSON.stringify(sess), expired);
      cb?.();
    } catch (e) { cb?.(e); }
  }
  destroy(sid: string, cb?: (err?: any) => void) {
    try { this.sessionDb.prepare("DELETE FROM sessions WHERE sid = ?").run(sid); cb?.(); } catch (e) { cb?.(e); }
  }
  touch(sid: string, sess: session.SessionData, cb?: (err?: any) => void) {
    try {
      const maxAge = sess.cookie?.maxAge || 30 * 24 * 60 * 60 * 1000;
      const expired = Math.floor((Date.now() + maxAge) / 1000);
      this.sessionDb.prepare("UPDATE sessions SET expired = ? WHERE sid = ?").run(expired, sid);
      cb?.();
    } catch { cb?.(); }
  }
}

export interface User {
  steam_id: string;
  display_name: string;
  avatar_url: string;
  tier: "free" | "basic" | "pro";
  is_admin: boolean;
  stripe_customer_id: string | null;
  discord_id: string | null;
  discord_tag: string | null;
  created_at: string;
  last_login_at: string;
}

// Extend Express Request with our user type
declare global {
  namespace Express {
    interface User {
      steam_id: string;
      display_name: string;
      avatar_url: string;
      tier: string;
      is_admin: boolean;
    }
  }
}

// Extend express-session with custom fields
declare module "express-session" {
  interface SessionData {
    returnTo?: string;
    discordState?: string;
  }
}

export function isAdmin(user: Express.User | User | undefined): boolean {
  if (!user) return false;
  return !!user.is_admin;
}

// Module-level ref to the user cache inside setupAuth (set during init)
let _userCacheRef: Map<string, { user: User | null; cachedAt: number }> | null = null;

/** Invalidate the in-memory user cache for a specific user.
 *  Call after tier changes (admin set-tier, Stripe webhook) so the next
 *  request reads the fresh tier from PG instead of stale cache. */
export function invalidateUserCache(steamId: string): void {
  _userCacheRef?.delete(steamId);
}

/** Invalidate all cached users (e.g., after bulk tier changes). */
export function invalidateAllUserCache(): void {
  _userCacheRef?.clear();
}

export async function setupAuth(app: Express, pool: pg.Pool) {
  const steamApiKey = process.env.STEAM_API_KEY;
  const sessionSecret = process.env.SESSION_SECRET || "trade-up-bot-dev-secret";
  const baseUrl = process.env.BASE_URL || "http://localhost:3001";

  // Trust nginx proxy (needed for secure cookies behind reverse proxy)
  app.set("trust proxy", 1);

  // Create users table (also created in createTables, but safe as IF NOT EXISTS)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      steam_id TEXT PRIMARY KEY,
      display_name TEXT,
      avatar_url TEXT,
      tier TEXT NOT NULL DEFAULT 'free',
      is_admin BOOLEAN NOT NULL DEFAULT false,
      stripe_customer_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Migration: add is_admin column if missing + set admin flag
  const adminSteamId = process.env.ADMIN_STEAM_ID;
  try {
    const { rows: cols } = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'users'"
    );
    if (!cols.find((c: { column_name: string }) => c.column_name === "is_admin")) {
      await pool.query("ALTER TABLE users ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT false");
    }
    if (adminSteamId) {
      await pool.query("UPDATE users SET is_admin = true WHERE steam_id = $1", [adminSteamId]);
      await pool.query("UPDATE users SET tier = 'pro' WHERE steam_id = $1 AND tier = 'admin'", [adminSteamId]);
    }
  } catch (e: unknown) {
    // Non-critical — admin flag will be set on next login
    console.error("Admin migration deferred:", (e as Error).message);
  }

  // Migration: add discord_id/discord_tag columns for Discord account linking
  try {
    const { rows: cols2 } = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'users'"
    );
    if (!cols2.find((c: { column_name: string }) => c.column_name === "discord_id")) {
      await pool.query("ALTER TABLE users ADD COLUMN discord_id TEXT UNIQUE");
      await pool.query("ALTER TABLE users ADD COLUMN discord_tag TEXT");
      console.log("Migration: added discord_id, discord_tag columns to users");
    }
  } catch (e: unknown) {
    console.error("Discord column migration deferred:", (e as Error).message);
  }

  const store = new SqliteSessionStore(DB_PATH);

  app.use(session({
    store,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      httpOnly: true,
      secure: baseUrl.startsWith("https"),
      sameSite: "lax",
    },
  }));

  app.use(passport.initialize());
  app.use(passport.session());

  // Serialize: store steam_id in session
  passport.serializeUser((user: Express.User, done) => done(null, user.steam_id));

  // User cache: avoid DB hits on every request.
  // Exported via invalidateUserCache() so set-tier and Stripe webhooks can clear it.
  const userCache = new Map<string, { user: User | null; cachedAt: number }>();
  const USER_CACHE_TTL = 60_000; // 1 min
  _userCacheRef = userCache;

  passport.deserializeUser((steamId: string, done) => {
    // Check in-memory cache first
    const cached = userCache.get(steamId);
    if (cached && Date.now() - cached.cachedAt < USER_CACHE_TTL) {
      done(null, cached.user);
      return;
    }

    pool.query("SELECT * FROM users WHERE steam_id = $1", [steamId])
      .then(({ rows }) => {
        const user = rows[0] as User | undefined;
        userCache.set(steamId, { user: user ?? null, cachedAt: Date.now() });
        done(null, user ?? null);
      })
      .catch(() => {
        // DB query failed — return stale cache or null
        if (cached) {
          done(null, cached.user);
        } else {
          done(null, null);
        }
      });
  });

  // Steam strategy (only if API key configured)
  if (steamApiKey) {
    passport.use(new SteamStrategy({
      returnURL: `${baseUrl}/auth/steam/callback`,
      realm: baseUrl,
      apiKey: steamApiKey,
    }, (_identifier: string, profile: any, done: any) => {
      const steamId = profile.id;
      const displayName = profile.displayName || `User ${steamId}`;
      const avatar = profile.photos?.[2]?.value || profile.photos?.[0]?.value || "";

      // Upsert user — set is_admin flag if ADMIN_STEAM_ID matches
      const isAdminUser = steamId === adminSteamId;

      pool.query(`
        INSERT INTO users (steam_id, display_name, avatar_url, is_admin, last_login_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT(steam_id) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          avatar_url = EXCLUDED.avatar_url,
          is_admin = GREATEST(users.is_admin, EXCLUDED.is_admin),
          last_login_at = NOW()
      `, [steamId, displayName, avatar, isAdminUser])
        .then(() => pool.query("SELECT * FROM users WHERE steam_id = $1", [steamId]))
        .then(({ rows }) => {
          done(null, rows[0] as User);
        })
        .catch((err: Error) => {
          console.error("User upsert failed:", err.message);
          done(err);
        });
    }));

    // Auth routes
    app.get("/auth/steam", (req, res, next) => {
      // Save return URL so we can redirect back after auth
      if (req.query.return) req.session.returnTo = req.query.return as string;
      passport.authenticate("steam")(req, res, next);
    });
    app.get("/auth/steam/callback", (req, res, next) => {
      // Fix for nginx proxy stripping query params from req.url
      req.url = req.originalUrl;
      passport.authenticate("steam", (err: any, user: any, info: any) => {
        if (err || !user) {
          console.error("Steam auth failed:", err?.message || err || "no user", info || "");
          return res.redirect("/?auth=failed");
        }
        req.logIn(user, (loginErr) => {
          if (loginErr) {
            console.error("Session login failed:", loginErr.message);
            return res.redirect("/?auth=failed");
          }
          console.log(`Steam login: ${user.display_name} (${user.steam_id})`);
          const returnTo = req.session.returnTo || "/";
          delete req.session.returnTo;
          res.redirect(returnTo);
        });
      })(req, res, next);
    });
  }

  // Logout
  app.get("/auth/logout", (req, res) => {
    req.logout(() => res.redirect("/"));
  });

  // Current user API
  app.get("/api/auth/me", (req, res) => {
    if (req.user) {
      const u = req.user as User;
      res.json({
        steam_id: u.steam_id,
        display_name: u.display_name,
        avatar_url: u.avatar_url,
        tier: u.tier,
        is_admin: isAdmin(u),
        discord_id: u.discord_id || null,
        discord_tag: u.discord_tag || null,
      });
    } else {
      res.json(null);
    }
  });

  // Admin: set any user's tier (protected by ADMIN_STEAM_ID)
  app.post("/api/admin/set-tier", async (req, res) => {
    if (!req.user || !isAdmin(req.user as User)) {
      res.status(403).json({ error: "Admin only" });
      return;
    }
    const { steam_id, tier } = req.body as { steam_id?: string; tier?: string };
    if (!tier || !["free", "basic", "pro"].includes(tier)) {
      res.status(400).json({ error: "Invalid tier. Use 'free', 'basic', or 'pro'." });
      return;
    }
    const targetId = steam_id || (req.user as User).steam_id;
    await pool.query("UPDATE users SET tier = $1 WHERE steam_id = $2", [tier, targetId]);
    // Invalidate user cache so next request reads fresh tier from DB
    invalidateUserCache(targetId);
    console.log(`Admin set tier: ${targetId} → ${tier}`);
    res.json({ success: true, steam_id: targetId, tier });
  });
}

// Middleware: require login
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.user) return next();
  res.status(401).json({ error: "Login required" });
}

// Middleware: require specific tier (admin flag does NOT auto-pass — admin uses their real tier)
export function requireTier(...tiers: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Login required" });
    const user = req.user as User;
    if (tiers.includes(user.tier)) return next();
    res.status(403).json({ error: `Requires ${tiers.join(" or ")} tier` });
  };
}

// Get tier config for the current user's actual tier (no view_as override)
export function getTierConfig(req: Request): { delay: number; limit: number; showListingIds: boolean } {
  const user = req.user as User | undefined;
  const tier = user?.tier || "free";

  switch (tier) {
    case "pro":
      return { delay: 0, limit: 0, showListingIds: true };
    case "basic":
      return { delay: 30 * 60, limit: 0, showListingIds: true };
    default:
      return { delay: 3 * 60 * 60, limit: 0, showListingIds: true };
  }
}
