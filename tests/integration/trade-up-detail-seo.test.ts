import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSeoHtml, escapeHtml, loadTradeUpDetailPage } from "../../server/seo.js";
import {
  tradeUpDescription,
  tradeUpDocumentTitle,
  tradeUpH1,
  tradeUpOgTitle,
} from "../../shared/copy.js";
import { createTestApp, type TestContext } from "./setup.js";

interface Fixture {
  type: string;
  profit: number;
  cost: number;
  roi: number;
  chance: number;
  outcomes: { skin_name: string; probability: number; predicted_condition: string; estimated_price_cents: number }[];
  inputs: { skin_name: string; collection_name: string }[];
}

async function insertTradeUp(ctx: TestContext, fixture: Fixture): Promise<number> {
  const { rows } = await ctx.pool.query(
    `INSERT INTO trade_ups (total_cost_cents, expected_value_cents, profit_cents, roi_percentage, chance_to_profit, type, listing_status, outcomes_json)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7) RETURNING id`,
    [fixture.cost, fixture.cost + fixture.profit, fixture.profit, fixture.roi, fixture.chance, fixture.type, JSON.stringify(fixture.outcomes)],
  );
  const id = rows[0].id as number;
  for (const [index, input] of fixture.inputs.entries()) {
    await ctx.pool.query(
      `INSERT INTO trade_up_inputs (trade_up_id, listing_id, skin_id, skin_name, collection_name, price_cents, float_value, condition)
       VALUES ($1, $2, $3, $4, $5, $6, 0.2, 'Field-Tested')`,
      [id, `listing-${id}-${index}`, `skin-${id}-${index}`, input.skin_name, input.collection_name, Math.round(fixture.cost / fixture.inputs.length)],
    );
  }
  return id;
}

describe("GET /trade-ups/:id crawler HTML", () => {
  let ctx: TestContext;
  const ids = new Map<string, number>();

  const fixtures: Record<string, Fixture> = {
    recoil: {
      type: "classified_covert",
      profit: 4120,
      cost: 25000,
      roi: 16.5,
      chance: 0.32,
      outcomes: [{ skin_name: "AWP | Gungnir", probability: 0.32, predicted_condition: "Field-Tested", estimated_price_cents: 40000 }],
      inputs: [{ skin_name: "AK-47 | Redline", collection_name: "The Recoil Collection" }],
    },
    asiimov: {
      type: "classified_covert",
      profit: 320,
      cost: 8000,
      roi: 4,
      chance: 0.62,
      outcomes: [{ skin_name: "★ AK-47 | Asiimov", probability: 0.62, predicted_condition: "Field-Tested", estimated_price_cents: 9000 }],
      inputs: [{ skin_name: "M4A1-S | Decimator", collection_name: "The Chroma Collection" }],
    },
    knife: {
      type: "covert_knife",
      profit: -1234,
      cost: 90000,
      roi: -1.4,
      chance: 0.996,
      outcomes: [{ skin_name: "★ Butterfly Knife | Fade", probability: 1, predicted_condition: "Factory New", estimated_price_cents: 80000 }],
      inputs: [{ skin_name: "AK-47 | Nightwish", collection_name: "The Dreams & Nightmares Collection" }],
    },
    milspec: {
      type: "milspec_restricted",
      profit: 500,
      cost: 400,
      roi: 125,
      chance: 0.2,
      outcomes: [{ skin_name: "P250 | Sand Dune", probability: 0.2, predicted_condition: "Field-Tested", estimated_price_cents: 100 }],
      inputs: [
        { skin_name: "MAC-10 | Acid Hex", collection_name: "The Prisma 2 Collection" },
        { skin_name: "Negev | Ultralight", collection_name: "The Fracture Collection" },
      ],
    },
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    const app = express();
    app.get("/trade-ups/:id", async (req, res) => {
      const page = await loadTradeUpDetailPage(ctx.pool, String(req.params.id));
      if (page.status !== 200) {
        res.status(page.status).send(page.status === 410 ? "gone" : "missing");
        return;
      }
      res.type("html").send(buildSeoHtml(page.meta));
    });
    ctx.app = app;
    for (const [key, fixture] of Object.entries(fixtures)) {
      ids.set(key, await insertTradeUp(ctx, fixture));
    }
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function rendered(key: string) {
    const fixture = fixtures[key];
    const id = ids.get(key);
    const res = await request(ctx.app).get(`/trade-ups/${id}`).set("User-Agent", "Googlebot").expect(200);
    const collections = fixture.inputs.map((row) => row.collection_name);
    const title = tradeUpDocumentTitle(fixture.type, fixture.outcomes, collections);
    const description = tradeUpDescription({
      type: fixture.type,
      profitCents: fixture.profit,
      costCents: fixture.cost,
      chanceToProfit: fixture.chance,
      outcomes: fixture.outcomes,
      inputNames: fixture.inputs.map((row) => row.skin_name),
    });
    const h1 = tradeUpH1(fixture.type, fixture.profit, fixture.roi, fixture.outcomes);
    const og = tradeUpOgTitle(fixture.type, fixture.profit, fixture.outcomes);
    expect(res.text).toContain(`<title>${escapeHtml(title)}</title>`);
    expect(res.text).toContain(`<meta name="description" content="${escapeHtml(description)}"`);
    expect(res.text).toContain(`<meta property="og:title" content="${escapeHtml(og)}"`);
    expect(res.text).toContain(`<h1>${escapeHtml(h1)}</h1>`);
    expect(res.text).not.toMatch(/<title>[^<]*%/);
    return { title, description, h1, og };
  }

  it("renders a collection descriptor when the likeliest output is under 0.5", async () => {
    const page = await rendered("recoil");
    expect(page.title).toBe("Classified to Covert Trade-Up: Recoil | TradeUpBot");
  });

  it("renders the likeliest output name at or above 0.5", async () => {
    const page = await rendered("asiimov");
    expect(page.title).toBe("Classified to Covert Trade-Up: AK-47 Asiimov | TradeUpBot");
  });

  it("renders a knife trade-up with the collection, not the knife name", async () => {
    const page = await rendered("knife");
    expect(page.title).toBe("Covert to Knife Trade-Up: Dreams & Nightmares | TradeUpBot");
    expect(page.description).toContain(">99% of outcomes above cost");
  });

  it("renders the shortened pair when two collections do not fit", async () => {
    const page = await rendered("milspec");
    expect(page.title).toBe("Mil-Spec to Restricted: Prisma 2 + Fracture | TradeUpBot");
  });
});
