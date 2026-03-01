# Rolodexter — Integration Wishlist

Requests from the **email.v8.2** project integration. Priority ordered.

---

## 1. Upgrade `PhoneNormalizer` to use `phonenumbers` (libphonenumber)

**Current:** strips non-digits with regex, prepends `+` if >10 digits — produces garbage for non-US numbers.

**Wanted:** E.164 output via Google's libphonenumber, regex strip fallback if parsing fails.

```python
# suggested implementation in core.py
import phonenumbers
from phonenumbers import NumberParseException

class PhoneNormalizer:
    @classmethod
    def normalize(cls, value: str) -> str:
        if not value or not isinstance(value, str):
            return value
        try:
            parsed = phonenumbers.parse(value.strip(), None)
            if phonenumbers.is_valid_number(parsed):
                return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
        except NumberParseException:
            pass
        # fallback: strip to digits/+
        import re
        cleaned = re.sub(r"[^\d+]", "", value.strip())
        return cleaned if 7 <= len(cleaned) <= 16 else value
```

Make `phonenumbers` an **optional** dep: `pip install rolodexter[phone]`

---

## 2. Recursive / nested payload support in `map_payload()`

**Current:** `map_payload()` only handles flat dicts. Real API responses are nested:
- Stripe wraps addresses under `{"address": {"line1": ..., "city": ...}}`
- HubSpot wraps everything under `{"properties": {...}}`
- Mailchimp merge fields are under `{"merge_fields": {"FNAME": ...}}`

**Wanted:** a `depth` parameter (default `1` = current behaviour, `2` = one level of recursion):

```python
mapper.map_payload(payload, service="stripe", depth=2)
```

At `depth=2`, for any value that is itself a `dict`, recurse and prefix the canonical results (e.g. `address.line1` → `address_line1`). The existing address field aliases in `patterns.json` should handle the mapping naturally.

---

## 3. Missing service profiles in `patterns.json`

Add these to the `"services"` block. Field → canonical mappings:

### `mailgun`
```json
{
  "address": "email",
  "name": "full_name",
  "subscribed": "email_opt_out",
  "created_at": "created_at"
}
```

### `mailersend`
```json
{
  "email": "email",
  "name": "full_name",
  "first_name": "first_name",
  "last_name": "last_name",
  "created_at": "created_at"
}
```

### `postmark`
```json
{
  "Email": "email",
  "Name": "full_name",
  "BouncedAt": "created_at",
  "Description": "notes"
}
```

### `moosend`
```json
{
  "Email": "email",
  "Name": "full_name",
  "FirstName": "first_name",
  "LastName": "last_name",
  "Phone": "phone",
  "MobilePhone": "phone",
  "Company": "company",
  "Country": "country",
  "City": "city",
  "Zip": "postal_code",
  "CreatedOn": "created_at"
}
```

### `getresponse`
```json
{
  "email": "email",
  "name": "full_name",
  "dayOfBirth": "birthday",
  "createdOn": "created_at",
  "tags": "tags",
  "ipAddress": "metadata"
}
```

### `campaignmonitor`
```json
{
  "EmailAddress": "email",
  "Name": "full_name",
  "Date": "created_at",
  "State": "lead_status",
  "CustomFields": "metadata"
}
```

### `elasticemail`
```json
{
  "email": "email",
  "firstName": "first_name",
  "lastName": "last_name",
  "phone": "phone",
  "status": "lead_status",
  "dateAdded": "created_at"
}
```

### `smtp2go`
```json
{
  "to": "email",
  "sender": "email",
  "subject": "subject",
  "date": "created_at"
}
```

---

## 4. `extract_values_from_dict()` utility — pull phone numbers out of values, not just keys

**Current:** rolodexter resolves *field names*. It does not scan *field values* for embedded phone numbers (e.g. a `notes` field containing `"call me at +44 20 7946 0958"`).

**Not asking rolodexter to do this** — that belongs to `phonenumbers.PhoneNumberMatcher`. But a documented composability note in the README showing how to chain both would be useful for downstream consumers:

```python
# suggested README example
import phonenumbers
from rolodexter import ContactMapper

mapper = ContactMapper()
result = mapper.map_payload(payload, service="hubspot")

# extract phone numbers from any unresolved free-text fields
for key, value in result.unmapped.items():
    for match in phonenumbers.PhoneNumberMatcher(str(value), None):
        e164 = phonenumbers.format_number(match.number, phonenumbers.PhoneNumberFormat.E164)
        print(f"  found phone in '{key}': {e164}")
```

---

## 5. TypeScript / npm port

For public npm release the lib needs a TS port. Architecture is clean enough to port directly.

**Suggested repo structure** for a mono-repo public release:

```
rolodexter/
├── packages/
│   ├── python/          # current src/rolodexter/
│   └── js/              # new TypeScript port
├── data/
│   └── patterns.json    # shared single source of truth for both packages
├── README.md
└── ...
```

Key notes for the TS port:
- `patterns.json` is already language-agnostic — ship it in both packages as a bundled asset
- `CanonicalField` → `const enum` in TS
- `ContactMapper`, `PatternRegistry`, 4 strategies all port 1:1 — they're pure computation, no I/O
- `PhoneNormalizer` → use [`libphonenumber-js`](https://www.npmjs.com/package/libphonenumber-js) (same underlying data as the Python `phonenumbers` package)
- `FuzzyMatchStrategy` → use [`fuse.js`](https://fusejs.io/) or [`fastest-levenshtein`](https://www.npmjs.com/package/fastest-levenshtein) as the optional fuzzy dep
- Export as both ESM and CJS with full `.d.ts` types

**Minimum npm API surface** to match the Python package:

```ts
import { ContactMapper, CanonicalField } from 'rolodexter';

const mapper = new ContactMapper();
const result = mapper.mapPayload({ fname: 'Jane', surname: 'Doe' });
// result.normalized → { first_name: 'Jane', last_name: 'Doe' }
```

---

## 6. `CanonicalField` additions

Fields used in the email project not currently in the enum:

| Field            | Notes                                                       |
| ---------------- | ----------------------------------------------------------- |
| `source_id`      | original ID from source system (e.g. Stripe customer ID)    |
| `source_service` | which service the record came from                          |
| `subscribed`     | boolean subscription status (distinct from `email_opt_out`) |
| `verified`       | boolean email verified flag                                 |

---

*Generated from email.v8.2 contact_extractor integration — March 2026*
