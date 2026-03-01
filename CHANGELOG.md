# Changelog

All notable changes to **rolodexter** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-03-01

### Added

- **ContactMapper** — multi-layer strategy pipeline (exact → service → fuzzy → heuristic).
- **PatternRegistry** — O(1) indexed lookup over 300+ field aliases across 40+ canonical fields.
- **20 service profiles** — Mailchimp, HubSpot, Salesforce, SendGrid, Stripe, Beehiiv, Resend, Omnisend, Pipedrive, Notion, Zoho, ActiveCampaign, Intercom, Brevo, ConvertKit, Airtable, Google Contacts, Apple Contacts, Outlook, LinkedIn export, Close CRM, Freshsales.
- **4 matching strategies** — `ExactMatchStrategy`, `ServiceMatchStrategy`, `FuzzyMatchStrategy`, `HeuristicMatchStrategy`.
- **5 value normalizers** — Phone, Email, Name (with surname particle awareness), Address, String.
- **Cross-service translation** via `mapper.translate()`.
- **Batch processing** via `mapper.map_batch()`.
- **Confidence scoring** on every match (0.0–1.0).
- **MappingResult diagnostics** — match rate, per-field details, JSON serialisation.
- **CanonicalField enum** — 50+ standardised fields with `str` mixin for easy JSON compat.
- Full type annotations + PEP 561 `py.typed` marker.
- Comprehensive test suite (90+ test cases).
- GitHub Actions CI + PyPI publish workflows.
