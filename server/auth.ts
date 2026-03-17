// Steam OpenID authentication + session management.

import passport from "passport";
import { Strategy as SteamStrategy } from "passport-steam";
import session from "express-session";
import type { Express, Request, Response, NextFunction } from "express";
import Database from "better-sqlite3";

// SQLite session store extending express-session.Store (provides regenerate/save/etc)
class SqliteSessionStore extends session.Store {
  private db: Database.Database;
  private readDb: Database.Database;
  constructor(db: Database.Database, readDb?: Database.Database) {
    super();
    this.db = db;
    this.readDb = readDb ?? db;
    // Retry schema init — daemon may hold a write lock at startup
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        db.exec(`CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expired INTEGER NOT NULL)`);
        db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired)");
        db.exec("DELETE FROM sessions WHERE expired < " + Math.floor(Date.now() / 1000));
        break;
      } catch (e: unknown) {
        if (attempt < 9 && (e as any)?.code === "SQLITE_BUSY") {
          const delay = (attempt + 1) * 500;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
          continue;
        }
        throw e;
      }
    }
  }
  get(sid: string, cb: (err: any, sess?: session.SessionData | null) => void) {
    try {
      // Use read-only connection — never blocked by daemon writes
      const row = this.readDb.prepare("SELECT sess FROM sessions WHERE sid = ? AND expired > ?").get(sid, Math.floor(Date.now() / 1000)) as { sess: string } | undefined;
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (e) { cb(e); }
  }
  set(sid: string, sess: session.SessionData, cb?: (err?: any) => void) {
    try {
      const maxAge = (sess as any)?.cookie?.maxAge || 30 * 24 * 60 * 60 * 1000;
      const expired = Math.floor((Date.now() + maxAge) / 1000);
      this.db.prepare("INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)").run(sid, JSON.stringify(sess), expired);
      cb?.();
    } catch (e) { cb?.(e); }
  }
  destroy(sid: string, cb?: (err?: any) => void) {
    try { this.db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid); cb?.(); } catch (e) { cb?.(e); }
  }
  touch(sid: string, sess: session.SessionData, cb?: (err?: any) => void) {
    try {
      const maxAge = (sess as any)?.cookie?.maxAge || 30 * 24 * 60 * 60 * 1000;
      const expired = Math.floor((Date.now() + maxAge) / 1000);
      this.db.prepare("UPDATE sessions SET expired = ? WHERE sid = ?").run(expired, sid);
      cb?.();
    } catch { cb?.(); } // Silently ignore lock errors — touch is non-critical
  }
}

export interface User {
  steam_id: string;
  display_name: string;
  avatar_url: string;
  tier: "free" | "basic" | "pro";
  is_admin: boolean;
  stripe_customer_id: string | null;
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

export function isAdmin(user: Express.User | User | undefined): boolean {
  if (!user) return false;
  return (user as any).is_admin === 1 || (user as any).is_admin === true;
}

export function setupAuth(app: Express, db: Database.Database, readDb?: Database.Database) {
  const steamApiKey = process.env.STEAM_API_KEY;
  const sessionSecret = process.env.SESSION_SECRET || "trade-up-bot-dev-secret";
  const baseUrl = process.env.BASE_URL || "http://localhost:3001";

  // Trust nginx proxy (needed for secure cookies behind reverse proxy)
  app.set("trust proxy", 1);

  // Create users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      steam_id TEXT PRIMARY KEY,
      display_name TEXT,
      avatar_url TEXT,
      tier TEXT NOT NULL DEFAULT 'free',
      is_admin INTEGER NOT NULL DEFAULT 0,
      stripe_customer_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Migration: add is_admin column if missing + set admin flag
  const adminSteamId = process.env.ADMIN_STEAM_ID;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const cols = db.pragma("table_info(users)") as { name: string }[];
      if (!cols.find(c => c.name === "is_admin")) {
        db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
      }
      if (adminSteamId) {
        db.prepare("UPDATE users SET is_admin = 1 WHERE steam_id = ?").run(adminSteamId);
        db.prepare("UPDATE users SET tier = 'pro' WHERE steam_id = ? AND tier = 'admin'").run(adminSteamId);
      }
      break;
    } catch (e: unknown) {
      if (attempt < 9 && (e as any)?.code === "SQLITE_BUSY") {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, (attempt + 1) * 500);
        continue;
      }
      // Non-critical — admin flag will be set on next login
      console.error("Admin migration deferred:", (e as Error).message);
      break;
    }
  }

  const store = new SqliteSessionStore(db, readDb);

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
  passport.deserializeUser((steamId: string, done) => {
    const user = db.prepare("SELECT * FROM users WHERE steam_id = ?").get(steamId) as User | undefined;
    done(null, user ?? null);
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
      const isAdminUser = steamId === adminSteamId ? 1 : 0;

      db.prepare(`
        INSERT INTO users (steam_id, display_name, avatar_url, is_admin, last_login_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(steam_id) DO UPDATE SET
          display_name = excluded.display_name,
          avatar_url = excluded.avatar_url,
          is_admin = MAX(users.is_admin, excluded.is_admin),
          last_login_at = datetime('now')
      `).run(steamId, displayName, avatar, isAdminUser);

      const user = db.prepare("SELECT * FROM users WHERE steam_id = ?").get(steamId) as User;
      done(null, user);
    }));

    // Auth routes
    app.get("/auth/steam", passport.authenticate("steam"));
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
          res.redirect("/");
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
      console.log(`Auth check: ${u.display_name} (${u.tier}${isAdmin(u) ? ", admin" : ""})`);
      res.json({
        steam_id: u.steam_id,
        display_name: u.display_name,
        avatar_url: u.avatar_url,
        tier: u.tier,
        is_admin: isAdmin(u),
      });
    } else {
      res.json(null);
    }
  });

  // Admin: set any user's tier (protected by ADMIN_STEAM_ID)
  app.post("/api/admin/set-tier", (req, res) => {
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
    db.prepare("UPDATE users SET tier = ? WHERE steam_id = ?").run(tier, targetId);
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
      return { delay: 30 * 60, limit: 10, showListingIds: false };
  }
}
