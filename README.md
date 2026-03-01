<div align="center">

# 📇 Rolodexter

**The universal contact field mapper.**

Route messy, inconsistent contact data from *any* source to a clean, canonical schema.

[![CI](https://github.com/rolodexter/rolodexter/actions/workflows/ci.yml/badge.svg)](https://github.com/rolodexter/rolodexter/actions/workflows/ci.yml)
[![PyPI](https://img.shields.io/pypi/v/rolodexter)](https://pypi.org/project/rolodexter/)
[![Python](https://img.shields.io/pypi/pyversions/rolodexter)](https://pypi.org/project/rolodexter/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

## The Problem

Every CRM, email platform, and CSV export uses different field names for the same data:

| Service    | First Name   | Phone             | Company                 |
| ---------- | ------------ | ----------------- | ----------------------- |
| HubSpot    | `firstname`  | `mobilephone`     | `company`               |
| Salesforce | `FirstName`  | `MobilePhone`     | `Company`               |
| Mailchimp  | `FNAME`      | `PHONE`           | `COMPANY`               |
| Google CSV | `Given Name` | `Phone 1 - Value` | `Organization 1 - Name` |
| Random CSV | `Column A`   | `Column B`        | `Column C`              |

## The Solution

```python
from rolodexter import ContactMapper

mapper = ContactMapper()

result = mapper.map_payload({
    "fname": "jane",
    "surname": "doe",
    "mobile": "+1-555-019-9876",
    "employer": "Tech Corp",
    "Column 1": "jane.doe@example.com",  # auto-detected by shape
})

print(result.normalized)
# {
#     "first_name": "Jane",
#     "last_name": "Doe",
#     "phone": "+15550199876",
#     "company": "Tech Corp",
#     "email": "jane.doe@example.com"
# }
```

## Installation

```bash
# Core (zero dependencies)
pip install rolodexter

# With fuzzy matching for typo recovery
pip install rolodexter[fuzzy]

# Everything
pip install rolodexter[all]

# Development
pip install rolodexter[dev]
```

## Features

### 🎯 Four-Layer Matching Pipeline

Every field runs through the strategy chain in priority order:

1. **Service Match** — instant lookup against 20+ platform-specific dictionaries
2. **Exact Match** — O(1) hit against 300+ known aliases
3. **Fuzzy Match** — `rapidfuzz` catches typos like `"phne_nmbr"` → `phone`
4. **Heuristic Match** — regex detects emails, phones, URLs, postal codes by *data shape*

### 📊 Confidence Scoring

Every match comes with a confidence score (0.0–1.0):

```python
match = mapper.identify("fname")
# FieldMatch(original='fname', canonical='first_name', confidence=1.0, strategy='exact')

match = mapper.identify("phne")
# FieldMatch(original='phne', canonical='phone', confidence=0.85, strategy='fuzzy')

match = mapper.identify("Column X", value="jane@test.com")
# FieldMatch(original='Column X', canonical='email', confidence=0.6, strategy='heuristic')
```

### 🔌 20+ Service Profiles

Built-in mappings for:

| CRM / Sales | Email / Marketing  | Productivity    | Other    |
| ----------- | ------------------ | --------------- | -------- |
| HubSpot     | Mailchimp          | Google Contacts | Stripe   |
| Salesforce  | SendGrid           | Apple Contacts  | Notion   |
| Pipedrive   | Brevo (Sendinblue) | Outlook         | Airtable |
| Zoho        | ConvertKit (Kit)   | LinkedIn Export | —        |
| Close CRM   | ActiveCampaign     | —               | —        |
| Freshsales  | Omnisend           | —               | —        |
| —           | Beehiiv            | —               | —        |
| —           | Resend             | —               | —        |
| —           | Intercom           | —               | —        |

### 🔄 Cross-Service Translation

```python
# Translate HubSpot data directly to Salesforce schema
salesforce_data = mapper.translate(
    hubspot_payload,
    from_service="hubspot",
    to_service="salesforce",
)
```

### 🧹 Value Normalization

Automatic cleanup on matched fields:

- **Phone** → strips formatting, adds `+` for international
- **Email** → lowercase, trimmed
- **Names** → title case with particle awareness (`"jane van der berg"` → `"Jane van der Berg"`)
- **Addresses** → excess whitespace collapsed, title-cased

### 📦 Batch Processing

```python
results = mapper.map_batch([contact1, contact2, contact3, ...])
```

### 📈 Rich Diagnostics

```python
result = mapper.map_payload(data)

print(result.match_rate)      # 0.857
print(result.matched_count)   # 6
print(result.unmatched_count)  # 1
print(result.to_dict())       # Full JSON-serializable report
```

## API Reference

### `ContactMapper`

```python
ContactMapper(
    *,
    patterns=None,           # Custom pattern dict
    patterns_path=None,      # Path to custom patterns.json
    default_service=None,    # Default service profile
    normalize=True,          # Apply value normalization
    strategies=None,         # Override strategy pipeline
)
```

**Methods:**

| Method                                            | Description                   |
| ------------------------------------------------- | ----------------------------- |
| `identify(header, *, value, service)`             | Resolve a single field header |
| `map_payload(payload, *, service)`                | Normalize an entire dict      |
| `map_batch(payloads, *, service)`                 | Process multiple payloads     |
| `translate(payload, *, from_service, to_service)` | Cross-service translation     |

### `CanonicalField`

Enum of all 50+ canonical fields. Inherits from `str` for JSON compatibility:

```python
from rolodexter import CanonicalField

assert CanonicalField.EMAIL == "email"
assert CanonicalField.PHONE.value == "phone"
```

### Custom Patterns

```python
custom = {
    "fields": {
        "first_name": ["fname", "given", "nombre"],
        "loyalty_tier": ["tier", "vip_level", "membership"],
    },
    "services": {
        "my_crm": {
            "contact_first": "first_name",
            "loyalty": "loyalty_tier",
        }
    }
}

mapper = ContactMapper(patterns=custom)
```

## Architecture

```
rolodexter/
├── __init__.py          # Public API
├── mapper.py            # ContactMapper orchestrator
├── registry.py          # PatternRegistry (O(1) indexes)
├── strategies.py        # 4 pluggable matching strategies
├── normalizers.py       # Value normalizers
├── models.py            # FieldMatch, MappingResult
├── constants.py         # CanonicalField enum, thresholds
├── exceptions.py        # Exception hierarchy
└── _data/
    └── patterns.json    # Master truth table (300+ aliases, 20+ services)
```

## Contributing

```bash
git clone https://github.com/rolodexter/rolodexter.git
cd rolodexter
pip install -e ".[dev]"
pytest
```

## License

MIT — see [LICENSE](LICENSE).
