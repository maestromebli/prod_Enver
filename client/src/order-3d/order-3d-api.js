import { getStoredToken } from "../api.js";

export function order3dFileUrl(orderId, assetId, kind) {
  const token = getStoredToken();
  const q = token ? `?access_token=${encodeURIComponent(token)}` : "";
  return `/api/orders/${orderId}/3d/${assetId}/${kind}${q}`;
}
