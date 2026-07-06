# @danmat/accept-query

[![CI](https://github.com/DanMat/accept-query/actions/workflows/ci.yml/badge.svg)](https://github.com/DanMat/accept-query/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@danmat/accept-query.svg)](https://www.npmjs.com/package/@danmat/accept-query)
[![minified + gzip size](https://img.shields.io/bundlejs/size/@danmat/accept-query)](https://bundlejs.com/?q=@danmat/accept-query)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Parse, build, and content-negotiate the **`Accept-Query`** HTTP header ([RFC 10008](https://www.rfc-editor.org/rfc/rfc10008)) — the response header a server uses to advertise which query-format media types it accepts on a [QUERY](https://www.rfc-editor.org/rfc/rfc10008) request.

**Zero dependencies. Fully typed. Isomorphic** (Node, Deno, Bun, browsers, edge).

```ts
import { negotiateQuery } from "@danmat/accept-query";

// The server told us what it accepts; we pick the best format we can produce.
const format = negotiateQuery(response.headers.get("accept-query") ?? "", [
  "application/json",
  "application/sql",
]);
// → "application/sql"
```

## Why?

RFC 10008 introduces the QUERY method — a safe, idempotent request with a body. To tell clients *how* to shape that body, a server answers with an `Accept-Query` response header:

```http
Accept-Query: application/sql;q=0.9, application/json;q=0.4, application/graphql
```

It's the `Accept` grammar (media ranges + `q` weights + parameters), but for *query* payloads. This library gives you the three things you actually need for it: **parse** it, **negotiate** against it, and **build** it (for servers).

## Install

```sh
npm install @danmat/accept-query
```

## API

### `parseAcceptQuery(value: string): MediaRange[]`

Parses a header value into media ranges, **sorted by quality then specificity**. Parsing is lenient — malformed entries are skipped, quoted parameter values are respected, and types/subtypes/param keys are lowercased.

```ts
parseAcceptQuery("application/sql;q=0.8, application/json");
// [
//   { type: "application", subtype: "json", quality: 1,   params: {} },
//   { type: "application", subtype: "sql",  quality: 0.8, params: {} },
// ]
```

### `negotiateQuery(acceptQuery: string, offered: string[]): string | null`

Given the server's `Accept-Query` value and the media types **your client can produce** (in your preference order), returns the best one to send — or `null` if the server accepts none of them. Wildcards (`application/*`, `*/*`) and `q=0` exclusions are handled per HTTP content-negotiation rules; the most specific matching range decides an offer's quality.

```ts
negotiateQuery("application/sql;q=0.9, application/json;q=0.4", [
  "application/json",
  "application/sql",
]);
// → "application/sql"   (higher server quality wins)

negotiateQuery("application/json", ["text/csv"]);
// → null                (server accepts none of ours)
```

### `formatAcceptQuery(ranges: MediaRangeInput[]): string`

Builds a header value from strings and/or structured ranges — for servers advertising what they accept. Omits `q` when it's `1`, trims trailing zeros, and quotes non-token parameter values.

```ts
formatAcceptQuery([
  "application/json",
  { type: "application", subtype: "sql", quality: 0.8 },
]);
// → "application/json, application/sql;q=0.8"
```

### Types & errors

```ts
interface MediaRange {
  type: string; // lowercased, "*" for wildcard
  subtype: string; // lowercased, "*" for wildcard
  quality: number; // 0–1, defaults to 1
  params: Record<string, string>; // non-q params, lowercased keys
}
```

`AcceptQueryError` is thrown only for programmer misuse (e.g. `formatAcceptQuery` on a range missing its type/subtype). Parsing never throws — it's deliberately liberal in what it accepts.

## Related

- [`@danmat/query-fetch`](https://github.com/DanMat/query-fetch) — a tiny client for the HTTP QUERY method itself.

## License

[MIT](./LICENSE) © Dan Matthew
