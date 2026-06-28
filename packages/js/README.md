# RoloDexter for JavaScript and TypeScript

This package is the parallel NPM implementation of RoloDexter, the universal
contact field mapper. It shares the Python package's `patterns.json` truth table
and currently targets the high-value mapper surface:

- exact alias matching
- normalized header matching
- value-shape heuristics for email, phone, URL, postal code, social URL, and date fields
- value normalization for phones, emails, names, addresses, postal codes, booleans, and tags
- `ContactMapper`, `mapPayload`, `mapBatch`, `mapStream`, and `compileSchema`

Fuzzy matching and generated i18n alias caches are intentionally deferred until
they can be implemented with behavior parity tests against Python.

```ts
import { ContactMapper } from "rolodexter";

const result = new ContactMapper().mapPayload({
  fname: "jane",
  surname: "doe",
  mobile: "(202) 555-0143",
  employer: "Tech Corp",
  Mystery: "jane@example.com",
});

console.log(result.normalized);
// {
//   first_name: "Jane",
//   last_name: "Doe",
//   phone: "+12025550143",
//   company: "Tech Corp",
//   email: "jane@example.com"
// }
```

## Development

```bash
npm install
npm test
```

`npm run sync:patterns` copies `../../src/rolodexter/patterns.json` into this
package before every build so the NPM package does not maintain a drifting alias
table.
