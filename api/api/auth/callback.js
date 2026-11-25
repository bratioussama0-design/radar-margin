"use strict";

function normalizeShop(raw) {
  const s = String(raw || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s) ? s : "";
}

async function saveStoreToken(shop, accessToken) {
  const sbUrl = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const sbKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (sbUrl && sbKey) {
    const r = await fetch(`${sbUrl}/rest/v1/shopify_stores?on_conflict=shop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: sbKey,
        Authorization: `Bearer ${sbKey}`,
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify([{ shop, access_token: accessToken, updated_at: new Date().toISOString() }])
    });
    if (!r.ok) throw new Error(`Supabase save failed: ${r.status}`);
    return true;
  }

  const hook = String(process.env.N8N_TOKEN_SAVE_URL || "").trim();
  if (hook) {
    const r = await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop, access_token: accessToken })
    });
    if (!r.ok) throw new Error(`Webhook save failed: ${r.status}`);
    return true;
  }

  return false;
}

module.exports = async function handler(req, res) {
  const shop = normalizeShop(req.query?.shop);
  const code = String(req.query?.code || "").trim();
  const clientId = String(process.env.SHOPIFY_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.SHOPIFY_CLIENT_SECRET || "").trim();
  const appUrl = String(process.env.APP_URL || "https://radar-margin.vercel.app").trim().replace(/\/+$/, "");

  if (!shop || !code || !clientId || !clientSecret) {
    return res.status(400).send("Invalid OAuth callback parameters or missing app credentials.");
  }

  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code })
    });

    if (!tokenRes.ok) {
      return res.status(502).send(`Token exchange failed (${tokenRes.status}).`);
    }

    const tokenJson = await tokenRes.json();
    const accessToken = String(tokenJson?.access_token || "").trim();
    if (!accessToken) {
      return res.status(502).send("No access_token returned by Shopify.");
    }

    await saveStoreToken(shop, accessToken);

    const embeddedUrl = `https://${shop}/admin/apps/${encodeURIComponent(clientId)}`;
    res.writeHead(302, { Location: embeddedUrl || `${appUrl}/?shop=${encodeURIComponent(shop)}` });
    res.end();
  } catch (err) {
    return res.status(500).send(err?.message || "OAuth error");
  }
};
