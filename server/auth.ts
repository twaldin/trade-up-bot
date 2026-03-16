// Steam OpenID authentication + session management.

import passport from "passport";
import { Strategy as SteamStrategy } from "passport-steam";
import session from "express-session";
import { EventEmitter } from "events";
import type { Express, Request, Response, NextFunction } from "express";
import Database from "better-sqlite3";

export interface User {
  steam_id: string;
  display_name: string;
  avatar_url: string;
  tier: "free" | "basic" | "pro" | "admin";
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
    }
  }
}

export function setupAuth(app: Express, db: Database.Database) {
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
      stripe_customer_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Session store in SQLite (persists across PM2 restarts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expired INTEGER NOT NULL
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired)");

  // Clean expired sessions on startup
  db.exec("DELETE FROM sessions WHERE expired < " + Math.floor(Date.now() / 1000));

  const SqliteStore = Object.assign(new EventEmitter(), {
    get: (sid: string, cb: (err: any, sess?: any) => void) => {
      try {
        const row = db.prepare("SELECT sess FROM sessions WHERE sid = ? AND expired > ?").get(sid, Math.floor(Date.now() / 1000)) as { sess: string } | undefined;
        cb(null, row ? JSON.parse(row.sess) : null);
      } catch (e) { cb(e); }
    },
    set: (sid: string, sess: any, cb: (err?: any) => void) => {
      try {
        const maxAge = sess?.cookie?.maxAge || 30 * 24 * 60 * 60 * 1000;
        const expired = Math.floor((Date.now() + maxAge) / 1000);
        db.prepare("INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)").run(sid, JSON.stringify(sess), expired);
        cb();
      } catch (e) { cb(e); }
    },
    destroy: (sid: string, cb: (err?: any) => void) => {
      try { db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid); cb(); } catch (e) { cb(e); }
    },
    touch: (sid: string, sess: any, cb: (err?: any) => void) => {
      try {
        const maxAge = sess?.cookie?.maxAge || 30 * 24 * 60 * 60 * 1000;
        const expired = Math.floor((Date.now() + maxAge) / 1000);
        db.prepare("UPDATE sessions SET expired = ? WHERE sid = ?").run(expired, sid);
        cb();
      } catch (e) { cb(e); }
    },
  });

  app.use(session({
    store: SqliteStore as any,
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

  // Passport 0.6+ requires session.regenerate() and session.save()
  // Our custom SQLite store doesn't add these — patch them on each request
  app.use((req, _res, next) => {
    if (req.session && !req.session.regenerate) {
      (req.session as any).regenerate = (cb: any) => cb();
    }
    if (req.session && !req.session.save) {
      (req.session as any).save = (cb: any) => cb();
    }
    next();
  });

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

      // Upsert user — auto-promote admin if ADMIN_STEAM_ID matches
      const adminSteamId = process.env.ADMIN_STEAM_ID;
      const tier = steamId === adminSteamId ? "admin" : "free";

      db.prepare(`
        INSERT INTO users (steam_id, display_name, avatar_url, tier, last_login_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(steam_id) DO UPDATE SET
          display_name = excluded.display_name,
          avatar_url = excluded.avatar_url,
          tier = CASE WHEN excluded.tier = 'admin' THEN 'admin' ELSE users.tier END,
          last_login_at = datetime('now')
      `).run(steamId, displayName, avatar, tier);

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
      console.log(`Auth check: ${u.display_name} (${u.tier})`);
      res.json({ steam_id: u.steam_id, display_name: u.display_name, avatar_url: u.avatar_url, tier: u.tier });
    } else {
      res.json(null);
    }
  });
}

// Middleware: require login
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.user) return next();
  res.status(401).json({ error: "Login required" });
}

// Middleware: require specific tier
export function requireTier(...tiers: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Login required" });
    const user = req.user as User;
    if (tiers.includes(user.tier) || user.tier === "admin") return next();
    res.status(403).json({ error: `Requires ${tiers.join(" or ")} tier` });
  };
}

// Middleware: apply tier-based filtering to trade-up queries.
// Admins can pass ?view_as=free|basic|pro to preview other tiers.
export function getTierConfig(req: Request): { delay: number; limit: number; showListingIds: boolean } {
  const user = req.user as User | undefined;
  let tier = user?.tier || "free";

  // Admin "view as" override
  const viewAs = req.query.view_as as string | undefined;
  if (viewAs && user?.tier === "admin" && ["free", "basic", "pro"].includes(viewAs)) {
    tier = viewAs as typeof tier;
  }

  switch (tier) {
    case "admin":
    case "pro":
      return { delay: 0, limit: 0, showListingIds: true };      // real-time, unlimited
    case "basic":
      return { delay: 5 * 60, limit: 0, showListingIds: true }; // 5-min delay, unlimited
    default:
      return { delay: 30 * 60, limit: 10, showListingIds: false }; // 30-min delay, 10 per type
  }
}
