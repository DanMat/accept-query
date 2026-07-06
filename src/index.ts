/**
 * @danmat/accept-query
 *
 * Parse, build, and negotiate the `Accept-Query` HTTP response header from
 * RFC 10008 — the header a server uses to advertise which query-format media
 * types it accepts on a QUERY request. It shares the grammar of `Accept`:
 * a comma-separated list of media ranges, each with optional parameters and a
 * `q` weight.
 *
 * @see https://www.rfc-editor.org/rfc/rfc10008#name-the-accept-query-header-field
 */

/** Error thrown for programmer misuse (e.g. formatting an invalid media range). */
export class AcceptQueryError extends Error {
  override name = "AcceptQueryError";

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, AcceptQueryError.prototype);
  }
}

/** A single parsed media range from an `Accept-Query` value. */
export interface MediaRange {
  /** Primary type, lowercased. `"*"` for a wildcard. */
  type: string;
  /** Subtype, lowercased. `"*"` for a wildcard. */
  subtype: string;
  /** Quality weight in the range `0`–`1`. Defaults to `1`. */
  quality: number;
  /** Media-type parameters other than `q`, with lowercased keys. */
  params: Record<string, string>;
}

/** Accepted by {@link formatAcceptQuery}: a raw string or a structured range. */
export type MediaRangeInput =
  | string
  | (Pick<MediaRange, "type" | "subtype"> &
      Partial<Omit<MediaRange, "type" | "subtype">>);

/** Split a header value on `sep`, ignoring separators inside double quotes. */
function splitOutsideQuotes(value: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      cur += ch;
    } else if (ch === "\\" && inQuotes) {
      cur += ch + (value[i + 1] ?? "");
      i++;
    } else if (ch === sep && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function unquote(value: string): string {
  const t = value.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return t;
}

/** How specific a range is; higher wins. Exact beats `type/*` beats `*​/*`. */
function specificity(range: MediaRange): number {
  if (range.type === "*") return 0;
  if (range.subtype === "*") return 1;
  return 2 + Object.keys(range.params).length;
}

/** Parse one media range. Returns `null` for a malformed token (lenient). */
function parseRange(token: string): MediaRange | null {
  const parts = splitOutsideQuotes(token, ";")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const mediaType = parts[0]!;
  const slash = mediaType.indexOf("/");
  if (slash === -1) return null;

  const type = mediaType.slice(0, slash).trim().toLowerCase();
  const subtype = mediaType
    .slice(slash + 1)
    .trim()
    .toLowerCase();
  if (!type || !subtype) return null;

  let quality = 1;
  const params: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i]!.indexOf("=");
    if (eq === -1) continue;
    const key = parts[i]!.slice(0, eq).trim().toLowerCase();
    const rawVal = parts[i]!.slice(eq + 1);
    if (key === "q") {
      const q = Number.parseFloat(unquote(rawVal));
      quality = Number.isFinite(q) ? Math.min(1, Math.max(0, q)) : 1;
    } else if (key) {
      params[key] = unquote(rawVal);
    }
  }

  return { type, subtype, quality, params };
}

/**
 * Parse an `Accept-Query` header value into a list of media ranges, sorted by
 * quality (descending) and then specificity. Malformed entries are skipped —
 * header parsing is deliberately lenient.
 *
 * @example
 * ```ts
 * parseAcceptQuery("application/sql;q=0.8, application/json");
 * // → [{ type: "application", subtype: "json", quality: 1, params: {} },
 * //    { type: "application", subtype: "sql",  quality: 0.8, params: {} }]
 * ```
 */
export function parseAcceptQuery(value: string): MediaRange[] {
  if (!value?.trim()) return [];

  const ranges: Array<{ range: MediaRange; index: number }> = [];
  let index = 0;
  for (const token of splitOutsideQuotes(value, ",")) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    const range = parseRange(trimmed);
    if (range) ranges.push({ range, index: index++ });
  }

  return ranges
    .sort((a, b) => {
      if (b.range.quality !== a.range.quality) {
        return b.range.quality - a.range.quality;
      }
      const spec = specificity(b.range) - specificity(a.range);
      if (spec !== 0) return spec;
      return a.index - b.index; // stable
    })
    .map((entry) => entry.range);
}

function formatQuality(quality: number): string {
  // Up to 3 decimal places, trailing zeros trimmed (RFC 9110 qvalue syntax).
  return Number.parseFloat(quality.toFixed(3)).toString();
}

const TOKEN_SAFE = /^[!#$%&'*+.^_`|~0-9a-z-]+$/i;

function formatParamValue(value: string): string {
  return TOKEN_SAFE.test(value)
    ? value
    : `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

function formatOne(input: MediaRangeInput): string {
  if (typeof input === "string") return input.trim();

  const { type, subtype, quality = 1, params = {} } = input;
  if (!type || !subtype) {
    throw new AcceptQueryError(
      `A media range requires both a type and a subtype (got "${type}/${subtype}").`,
    );
  }

  let out = `${type.toLowerCase()}/${subtype.toLowerCase()}`;
  for (const [key, value] of Object.entries(params)) {
    out += `;${key.toLowerCase()}=${formatParamValue(value)}`;
  }
  if (quality < 1) out += `;q=${formatQuality(quality)}`;
  return out;
}

/**
 * Build an `Accept-Query` header value from strings and/or structured ranges.
 *
 * @example
 * ```ts
 * formatAcceptQuery([
 *   "application/json",
 *   { type: "application", subtype: "sql", quality: 0.8 },
 * ]);
 * // → "application/json, application/sql;q=0.8"
 * ```
 */
export function formatAcceptQuery(ranges: MediaRangeInput[]): string {
  return ranges.map(formatOne).filter(Boolean).join(", ");
}

/** Does `range` (which may contain wildcards) match a concrete media type? */
function matches(range: MediaRange, offer: MediaRange): boolean {
  const typeOk = range.type === "*" || range.type === offer.type;
  const subOk = range.subtype === "*" || range.subtype === offer.subtype;
  return typeOk && subOk;
}

/** The quality assigned to `offer` by the most specific matching range. */
function qualityFor(offer: MediaRange, ranges: MediaRange[]): number {
  let bestSpec = -1;
  let quality = 0;
  for (const range of ranges) {
    if (!matches(range, offer)) continue;
    const spec = specificity(range);
    if (spec > bestSpec) {
      bestSpec = spec;
      quality = range.quality;
    }
  }
  return bestSpec >= 0 ? quality : 0;
}

/**
 * Given a server's `Accept-Query` value and the media types your client can
 * produce (in preference order), pick the best format to send — or `null` if
 * the server accepts none of them.
 *
 * @example
 * ```ts
 * negotiateQuery("application/sql;q=0.9, application/json;q=0.4", [
 *   "application/json",
 *   "application/sql",
 * ]);
 * // → "application/sql"  (higher server quality wins)
 * ```
 */
export function negotiateQuery(
  acceptQuery: string,
  offered: string[],
): string | null {
  const ranges = parseAcceptQuery(acceptQuery);
  if (ranges.length === 0) return null;

  let best: { offer: string; quality: number } | null = null;
  for (const offer of offered) {
    const parsed = parseRange(offer);
    if (!parsed) continue;
    const quality = qualityFor(parsed, ranges);
    if (quality <= 0) continue;
    // Strictly-greater keeps the client's preference order on ties.
    if (!best || quality > best.quality) {
      best = { offer, quality };
    }
  }
  return best?.offer ?? null;
}
