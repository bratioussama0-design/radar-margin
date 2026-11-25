"use strict";

function normalizeShop(raw) {
  const s = String(raw || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s) ? s : "";
}

module.exports = function handler(req, res) {
  const shop = normalizeShop(req.query?.shop);
  const clientId = String(process.env.SHOPIFY_CLIENT_ID || "").trim();
  const appUrl = String(process.env.APP_URL || "https://radar-margin.vercel.app").trim().replace(/\/+$/, "");

  if (!shop || !clientId) {
    return res.status(400).json({ ok: false, error: "Missing valid shop or SHOPIFY_CLIENT_ID" });
  }

  const scopes = "read_orders,read_products";
  const redirectUri = `${appUrl}/api/auth/callback`;
  const state = Buffer.from(JSON.stringify({ shop, ts: Date.now() })).toString("base64url");

  const installUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;

  res.writeHead(302, { Location: installUrl });
  res.end();
};
