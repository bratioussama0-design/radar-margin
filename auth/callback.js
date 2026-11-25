export default async function handler(req, res) {
  const { code, shop: rawShop } = req.query || {};
  const shop = String(rawShop || "").trim().toLowerCase();

  if (!code || !shop || !shop.endsWith(".myshopify.com")) {
    return res.status(400).send("Missing code or invalid shop parameter");
  }

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const supabaseUrl = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appUrl = (process.env.APP_URL || "https://radar-margin.vercel.app")
    .trim()
    .replace(/\/+$/, "");

  if (!clientId || !clientSecret) {
    return res.status(500).send("Missing SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET");
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).send("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      return res.status(502).send(`Token exchange failed: ${JSON.stringify(tokenData)}`);
    }

    const dbRes = await fetch(`${supabaseUrl}/rest/v1/shopify_stores?on_conflict=shop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify([
        {
          shop,
          access_token: tokenData.access_token,
          scope: tokenData.scope || ""
        }
      ])
    });

    if (!dbRes.ok) {
      const dbErr = await dbRes.text();
      return res.status(502).send(`Supabase save failed: ${dbErr}`);
    }

    const redirectTarget = `${appUrl}/?shop=${encodeURIComponent(shop)}`;
    return res.redirect(302, redirectTarget);
  } catch (err) {
    return res.status(500).send(`Callback error: ${err?.message || "Unknown error"}`);
  }
}
