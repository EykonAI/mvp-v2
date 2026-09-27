/**
 * On-demand VHR "look" requests (Imagery IMG-11, mig 194) — the pure half.
 *
 * The client sends WHAT it wants (provider, product, resolution, looks, a
 * point). It never sends a price: the price is the provider's LIST price,
 * read by imagery_order_request() from imagery_price_list. Every gate —
 * founder-bought look delivered first, Desk/Enterprise only, licence ok,
 * listed product, account and all-accounts monthly caps — is enforced in
 * the database, fail-closed, and a refusal is recorded with its reason.
 */

export interface OrderInput {
  provider: string;
  product: string;
  resolution_m: number;
  looks: number;
  lat: number;
  lon: number;
  note: string | null;
}

export type OrderParse = { ok: true; input: OrderInput } | { ok: false; error: string };

export function parseOrderBody(body: unknown): OrderParse {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid_body' };
  const b = body as Record<string, unknown>;
  if ('price' in b || 'price_usd' in b) return { ok: false, error: 'price_is_not_client_supplied' };
  const provider = typeof b.provider === 'string' && b.provider ? b.provider : 'umbra';
  const product = typeof b.product === 'string' && b.product ? b.product : 'spotlight';
  const resolution_m = Number(b.resolution_m);
  const looks = Number(b.looks ?? 1);
  const lat = Number(b.lat);
  const lon = Number(b.lon);
  if (!/^[a-z0-9_]{2,40}$/.test(provider) || !/^[a-z0-9_]{2,40}$/.test(product)) return { ok: false, error: 'invalid_product' };
  if (!Number.isFinite(resolution_m) || resolution_m <= 0) return { ok: false, error: 'invalid_resolution' };
  if (!Number.isInteger(looks) || looks < 1 || looks > 20) return { ok: false, error: 'invalid_looks' };
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { ok: false, error: 'invalid_point' };
  }
  const note = typeof b.note === 'string' ? b.note.slice(0, 500) : null;
  return { ok: true, input: { provider, product, resolution_m, looks, lat, lon, note } };
}
