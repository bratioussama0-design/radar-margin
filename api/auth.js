export default function handler(req, res) {
  const rawShop = String(req.query?.shop || "").trim().toLowerCase();
  const shop = rawShop.endsWith(".myshopify.com")
    ? rawShop
    : `${rawShop.replace(/[^a-z0-9-]/g, "")}.myshopify.com`;

  if (!shop || shop === ".myshopify.com") {
    return res.status(400).send("Missing or invalid shop parameter");
  }

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const appUrl = (process.env.APP_URL || "https://radar-margin.vercel.app")
    .trim()
    .replace(/\/+$/, "");

  if (!clientId) {
    return res.status(500).send("Missing SHOPIFY_CLIENT_ID");
  }

  const scopes = "read_orders,read_products";
  const redirectUri = `${appUrl}/api/auth/callback`;

  const installUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;

  return res.redirect(302, installUrl);
}
