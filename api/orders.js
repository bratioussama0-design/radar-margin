"use strict";

function normalizeShop(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  const clean = s.replace(/^https?:\/\//, "").split("/")[0];
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(clean)) return "";
  return clean;
}

function resolveAccessToken(shop) {
  // Optional JSON map in env: {"store1.myshopify.com":"shpat_..."}
  if (process.env.SHOPIFY_STORE_TOKENS) {
    try {
      const map = JSON.parse(process.env.SHOPIFY_STORE_TOKENS);
      if (map && typeof map === "object" && typeof map[shop] === "string" && map[shop].trim()) {
        return map[shop].trim();
      }
    } catch (_) {
      // Ignore malformed JSON map and fall back to single token
    }
  }
  const single = String(process.env.SHOPIFY_ACCESS_TOKEN || "").trim();
  return single || "";
}

function daysBetween(isoDate) {
  if (!isoDate) return 0;
  const t = Date.parse(isoDate);
  if (!Number.isFinite(t)) return 0;
  const diffDays = Math.floor((Date.now() - t) / 86400000);
  return diffDays > 0 ? diffDays : 0;
}

function mapShopifyOrder(node, idx) {
  const totalPrice = parseFloat(node?.totalPriceSet?.shopMoney?.amount || "0") || 0;
  const totalDiscounts = parseFloat(node?.totalDiscountsSet?.shopMoney?.amount || "0") || 0;
  const totalShipping = parseFloat(node?.totalShippingPriceSet?.shopMoney?.amount || "0") || 0;

  const lineItems = Array.isArray(node?.lineItems?.nodes) ? node.lineItems.nodes : [];
  const firstItem = lineItems[0] || {};
  const productTitle = firstItem.title || "Shopify Order Item";
  const sku = firstItem.sku || `SKU-${idx + 1}`;
  const vendor = firstItem.vendor || "Shopify Store";

  let unitCostSum = 0;
  let hasUnitCost = false;
  lineItems.forEach(li => {
    const qty = Math.max(1, Number(li?.quantity || 1));
    const unitCostRaw = li?.variant?.inventoryItem?.unitCost?.amount;
    if (unitCostRaw != null && unitCostRaw !== "") {
      const uc = parseFloat(unitCostRaw);
      if (Number.isFinite(uc)) {
        unitCostSum += uc * qty;
        hasUnitCost = true;
      }
    }
  });

  // Fallback estimated COGS only when Shopify inventory unitCost is not set
  const cogs = hasUnitCost ? unitCostSum : Number((totalPrice * 0.28).toFixed(2));
  // Default ad spend estimate editable later in UI per order
  const ads = Number((totalPrice * 0.22).toFixed(2));

  const fulfillments = Array.isArray(node?.fulfillments) ? node.fulfillments : [];
  const latestFulfillment = fulfillments[0] || null;
  const rawStatus = latestFulfillment?.displayStatus || node?.displayFulfillmentStatus || "UNFULFILLED";

  let status = "Processing";
  let daysLate = 0;
  let trackingChecks = 0;
  let refundRisk = 8;

  if (rawStatus === "DELIVERED") {
    status = "Delivered";
    refundRisk = 5;
  } else if (rawStatus === "IN_TRANSIT" || rawStatus === "OUT_FOR_DELIVERY") {
    status = "In transit";
    daysLate = daysBetween(latestFulfillment?.updatedAt || node?.createdAt);
    if (daysLate > 5) status = "Delayed";
    trackingChecks = Math.min(8, Math.max(1, Math.floor(daysLate / 2)));
    refundRisk = Math.min(85, 10 + daysLate * 6);
  } else {
    status = "Awaiting pickup";
    daysLate = daysBetween(node?.createdAt);
    if (daysLate > 4) status = "Delayed";
    trackingChecks = Math.min(6, Math.max(0, Math.floor(daysLate / 2)));
    refundRisk = Math.min(80, 12 + daysLate * 5);
  }

  return {
    id: node?.name || `#ORD-${idx + 1}`,
    product: productTitle,
    sku,
    supplier: vendor,
    revenue: Number(totalPrice.toFixed(2)),
    cogs: Number(cogs.toFixed(2)),
    shipping: Number(totalShipping.toFixed(2)),
    discount: Number(totalDiscounts.toFixed(2)),
    ads,
    status,
    daysLate,
    trackingChecks,
    refundRisk
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const shop = normalizeShop(req.query?.shop);
  if (!shop) {
    return res.status(400).json({ ok: false, error: "Valid ?shop=store.myshopify.com is required" });
  }

  const accessToken = resolveAccessToken(shop);
  if (!accessToken) {
    return res.status(200).json({
      ok: false,
      source: "unconfigured",
      shop,
      orders: [],
      message: "No Shopify Admin access token configured yet for this store."
    });
  }

  const query = `
    query RecentOrders($first: Int!) {
      orders(first: $first, sortKey: CREATED_AT, reverse: true) {
        nodes {
          id
          name
          createdAt
          displayFulfillmentStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          totalDiscountsSet { shopMoney { amount currencyCode } }
          totalShippingPriceSet { shopMoney { amount currencyCode } }
          fulfillments(first: 3) {
            displayStatus
            updatedAt
          }
          lineItems(first: 10) {
            title
            sku
            vendor
            quantity
            variant {
              inventoryItem {
                unitCost { amount currencyCode }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const endpoint = `https://${shop}/admin/api/2026-10/graphql.json`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken
      },
      body: JSON.stringify({ query, variables: { first: 25 } })
    });

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        source: "shopify_error",
        shop,
        orders: [],
        error: `Shopify API responded with status ${response.status}`
      });
    }

    const json = await response.json();
    if (Array.isArray(json.errors) && json.errors.length > 0) {
      return res.status(502).json({
        ok: false,
        source: "graphql_error",
        shop,
        orders: [],
        error: json.errors[0]?.message || "GraphQL error"
      });
    }

    const rawNodes = json?.data?.orders?.nodes;
    const orders = Array.isArray(rawNodes) ? rawNodes.map(mapShopifyOrder) : [];

    return res.status(200).json({
      ok: true,
      source: "shopify_live",
      shop,
      orders
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      source: "network_error",
      shop,
      orders: [],
      error: err?.message || "Failed to fetch Shopify orders"
    });
  }
};
