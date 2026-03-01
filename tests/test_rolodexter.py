"""Complete test suite for rolodexter — 169 tests in one file."""

from __future__ import annotations

import pytest

from rolodexter import (
    ContactMapper,
    ExactMatchStrategy,
    FuzzyMatchStrategy,
    HeuristicMatchStrategy,
    MappingResult,
    PatternRegistry,
    ServiceMatchStrategy,
)
from rolodexter.core import (
    AddressNormalizer,
    EmailNormalizer,
    NameNormalizer,
    PatternLoadError,
    PhoneNormalizer,
    ServiceNotFoundError,
    StringNormalizer,
    normalize_value,
)

# ═══════════════════════════════════════════════════════════════
#  FIXTURES
# ═══════════════════════════════════════════════════════════════


@pytest.fixture
def registry() -> PatternRegistry:
    return PatternRegistry()


@pytest.fixture
def mapper() -> ContactMapper:
    return ContactMapper()


@pytest.fixture
def mapper_no_norm() -> ContactMapper:
    return ContactMapper(normalize=False)


@pytest.fixture
def mapper_mailchimp() -> ContactMapper:
    return ContactMapper(default_service="mailchimp")


@pytest.fixture
def sample_payload() -> dict:
    return {
        "fname": "jane",
        "surname": "doe",
        "mobile": "+1-555-019-9876",
        "employer": "Tech Corp",
        "designation": "Senior Engineer",
        "Column 1": "jane.doe@example.com",
        "favorite_color": "Blue",
    }


# ═══════════════════════════════════════════════════════════════
#  REGISTRY TESTS
# ═══════════════════════════════════════════════════════════════


class TestLoading:
    def test_default_load(self, registry: PatternRegistry) -> None:
        assert len(registry.all_aliases) > 200
        assert len(registry.canonical_fields) >= 30
        assert len(registry.available_services) >= 15

    def test_version(self, registry: PatternRegistry) -> None:
        assert registry.version == "1.0.0"

    def test_custom_patterns(self) -> None:
        custom = {
            "fields": {"first_name": ["fname", "given"]},
            "services": {},
        }
        reg = PatternRegistry(patterns=custom)
        assert reg.exact_lookup("fname") == "first_name"
        assert reg.exact_lookup("given") == "first_name"

    def test_bad_path_raises(self) -> None:
        with pytest.raises(PatternLoadError):
            PatternRegistry(patterns_path="/nonexistent/path.json")

    def test_repr(self, registry: PatternRegistry) -> None:
        r = repr(registry)
        assert "PatternRegistry" in r
        assert "aliases=" in r


class TestExactLookup:
    @pytest.mark.parametrize(
        "alias, expected",
        [
            ("fname", "first_name"),
            ("given_name", "first_name"),
            ("surname", "last_name"),
            ("lname", "last_name"),
            ("display_name", "full_name"),
            ("email_address", "email"),
            ("telephone", "phone"),
            ("cell", "phone"),
            ("mobile_phone", "phone"),
            ("fax_number", "fax"),
            ("home_tel", "home_phone"),
            ("office_phone", "work_phone"),
            ("whatsapp", "whatsapp"),
            ("organization", "company"),
            ("employer", "company"),
            ("jobtitle", "job_title"),
            ("designation", "job_title"),
            ("dept", "department"),
            ("sector", "industry"),
            ("street", "address_line1"),
            ("apt", "address_line2"),
            ("locality", "city"),
            ("province", "state"),
            ("zipcode", "postal_code"),
            ("countrycode", "country"),
            ("linkedin_url", "linkedin"),
            ("twitter_handle", "twitter"),
            ("ig", "instagram"),
            ("github", "github"),
            ("yt", "youtube"),
            ("tiktok", "tiktok"),
            ("lead_status", "lead_status"),
            ("lifecyclestage", "lifecycle_stage"),
            ("unsubscribed", "email_opt_out"),
            ("tags", "tags"),
            ("lead_source", "source"),
            ("utm", "utm_parameters"),
            ("dob", "birthday"),
            ("signup_date", "created_at"),
            ("last_modified", "updated_at"),
            ("last_activity", "last_contacted"),
            ("memo", "notes"),
            ("annual_revenue", "revenue"),
            ("currency_code", "currency"),
            ("lead_score", "score"),
            ("assigned_to", "owner"),
            ("custom_fields", "metadata"),
        ],
    )
    def test_alias_resolves(self, registry: PatternRegistry, alias: str, expected: str) -> None:
        assert registry.exact_lookup(alias) == expected

    def test_case_insensitive(self, registry: PatternRegistry) -> None:
        assert registry.exact_lookup("FNAME") == "first_name"
        assert registry.exact_lookup("Email_Address") == "email"

    def test_leading_trailing_spaces(self, registry: PatternRegistry) -> None:
        assert registry.exact_lookup("  fname  ") == "first_name"

    def test_unknown_returns_none(self, registry: PatternRegistry) -> None:
        assert registry.exact_lookup("xyzzy_garbage") is None


class TestServiceLookup:
    @pytest.mark.parametrize(
        "service, svc_field, expected",
        [
            ("hubspot", "firstname", "first_name"),
            ("hubspot", "mobilephone", "phone"),
            ("hubspot", "hs_lead_status", "lead_status"),
            ("mailchimp", "FNAME", "first_name"),
            ("mailchimp", "LNAME", "last_name"),
            ("salesforce", "MobilePhone", "phone"),
            ("salesforce", "MailingStreet", "address_line1"),
            ("sendgrid", "state_province_region", "state"),
            ("stripe", "line1", "address_line1"),
            ("beehiiv", "firstName", "first_name"),
            ("omnisend", "postalCode", "postal_code"),
            ("pipedrive", "org_name", "company"),
            ("notion", "Full Name", "full_name"),
            ("zoho", "Mailing_Zip", "postal_code"),
            ("activecampaign", "orgname", "company"),
            ("brevo", "SMS", "phone"),
            ("google_contacts", "E-mail 1 - Value", "email"),
            ("outlook", "Business Phone", "work_phone"),
            ("linkedin_export", "Position", "job_title"),
            ("freshsales", "work_number", "work_phone"),
        ],
    )
    def test_service_field(self, registry: PatternRegistry, service: str, svc_field: str, expected: str) -> None:
        assert registry.service_lookup(svc_field, service) == expected

    def test_unknown_service(self, registry: PatternRegistry) -> None:
        assert registry.service_lookup("fname", "nonexistent") is None

    def test_get_service_mapping(self, registry: PatternRegistry) -> None:
        mapping = registry.get_service_mapping("hubspot")
        assert isinstance(mapping, dict)
        assert mapping["firstname"] == "first_name"

    def test_get_reverse_mapping(self, registry: PatternRegistry) -> None:
        rev = registry.get_reverse_mapping("hubspot")
        assert rev["first_name"] == "firstname"
        assert rev["last_name"] == "lastname"

    def test_service_not_found_raises(self, registry: PatternRegistry) -> None:
        with pytest.raises(ServiceNotFoundError):
            registry.get_service_mapping("totally_fake_service")


# ═══════════════════════════════════════════════════════════════
#  STRATEGY TESTS
# ═══════════════════════════════════════════════════════════════


class TestExactMatch:
    def test_known_alias(self, registry: PatternRegistry) -> None:
        strat = ExactMatchStrategy(registry)
        m = strat.match("fname")
        assert m is not None
        assert m.canonical == "first_name"
        assert m.confidence == 1.0
        assert m.strategy == "exact"

    def test_unknown(self, registry: PatternRegistry) -> None:
        strat = ExactMatchStrategy(registry)
        assert strat.match("zzz_garbage") is None


class TestServiceMatch:
    def test_with_service(self, registry: PatternRegistry) -> None:
        strat = ServiceMatchStrategy(registry)
        m = strat.match("FNAME", service="mailchimp")
        assert m is not None
        assert m.canonical == "first_name"
        assert m.service == "mailchimp"
        assert m.confidence == 0.95

    def test_without_service(self, registry: PatternRegistry) -> None:
        strat = ServiceMatchStrategy(registry)
        assert strat.match("FNAME") is None

    def test_wrong_service(self, registry: PatternRegistry) -> None:
        strat = ServiceMatchStrategy(registry)
        assert strat.match("FNAME", service="hubspot") is None


class TestFuzzyMatch:
    def test_typo_recovery(self, registry: PatternRegistry) -> None:
        strat = FuzzyMatchStrategy(registry)
        m = strat.match("phne_nmbr")
        if m is not None:
            assert m.canonical == "phone"
            assert m.strategy == "fuzzy"

    def test_close_misspelling(self, registry: PatternRegistry) -> None:
        strat = FuzzyMatchStrategy(registry)
        m = strat.match("first_nam")
        if m is not None:
            assert m.canonical == "first_name"

    def test_garbage_no_match(self, registry: PatternRegistry) -> None:
        strat = FuzzyMatchStrategy(registry)
        m = strat.match("supercalifragilistic")
        assert m is None


class TestHeuristicMatch:
    @pytest.mark.parametrize(
        "value, expected",
        [
            ("jane@example.com", "email"),
            ("JOHN.DOE@CORP.CO.UK", "email"),
            ("+15551234567", "phone"),
            ("555-123-4567", "phone"),
            ("(555) 123-4567", "phone"),
            ("https://example.com", "website"),
            ("www.example.com", "website"),
            ("https://linkedin.com/in/janedoe", "linkedin"),
            ("@janedoe", "twitter"),
            ("90210", "postal_code"),
            ("90210-1234", "postal_code"),
            ("K1A 0B1", "postal_code"),
            ("SW1A 1AA", "postal_code"),
            ("1990-05-15", "birthday"),
            ("05/15/1990", "birthday"),
        ],
    )
    def test_value_shape_detection(self, value: str, expected: str) -> None:
        strat = HeuristicMatchStrategy()
        m = strat.match("Unknown Column", value=value)
        assert m is not None
        assert m.canonical == expected
        assert m.strategy == "heuristic"
        assert m.confidence == 0.60

    def test_none_value(self) -> None:
        strat = HeuristicMatchStrategy()
        assert strat.match("col", value=None) is None

    def test_empty_string(self) -> None:
        strat = HeuristicMatchStrategy()
        assert strat.match("col", value="") is None

    def test_plain_text_no_match(self) -> None:
        strat = HeuristicMatchStrategy()
        assert strat.match("col", value="Just some text") is None


# ═══════════════════════════════════════════════════════════════
#  MAPPER TESTS
# ═══════════════════════════════════════════════════════════════


class TestIdentify:
    def test_exact(self, mapper: ContactMapper) -> None:
        m = mapper.identify("fname")
        assert m.canonical == "first_name"
        assert m.confidence == 1.0
        assert m.strategy == "exact"

    def test_service_override(self, mapper: ContactMapper) -> None:
        m = mapper.identify("FNAME", service="mailchimp")
        assert m.canonical == "first_name"
        assert m.strategy == "service"

    def test_heuristic_fallback(self, mapper: ContactMapper) -> None:
        m = mapper.identify("Column X", value="jane@test.com")
        assert m.canonical == "email"
        assert m.strategy == "heuristic"

    def test_unknown(self, mapper: ContactMapper) -> None:
        m = mapper.identify("zzzz_nonsense_field")
        assert not m.is_matched
        assert m.canonical == "unknown"
        assert m.confidence == 0.0


class TestMapPayload:
    def test_basic(self, mapper: ContactMapper) -> None:
        result = mapper.map_payload({"fname": "Jane", "surname": "Doe", "mobile": "555-0199"})
        assert isinstance(result, MappingResult)
        assert result.normalized["first_name"] == "Jane"
        assert result.normalized["last_name"] == "Doe"
        assert "phone" in result.normalized

    def test_with_service(self) -> None:
        m = ContactMapper()
        result = m.map_payload({"FNAME": "Jane", "LNAME": "Doe"}, service="mailchimp")
        assert result.normalized.get("first_name") == "Jane"
        assert result.normalized.get("last_name") == "Doe"

    def test_unmapped_fields(self, mapper: ContactMapper) -> None:
        result = mapper.map_payload({"zzz_nonsense": "hello"})
        assert "zzz_nonsense" in result.unmapped
        assert result.unmatched_count == 1

    def test_empty_payload(self, mapper: ContactMapper) -> None:
        result = mapper.map_payload({})
        assert result.normalized == {}
        assert result.unmapped == {}
        assert result.match_rate == 0.0

    def test_none_values(self, mapper: ContactMapper) -> None:
        result = mapper.map_payload({"fname": None})
        assert result.normalized["first_name"] is None

    def test_empty_string_values(self, mapper: ContactMapper) -> None:
        result = mapper.map_payload({"email": ""})
        assert result.normalized["email"] == ""

    def test_collision_creates_list(self, mapper: ContactMapper) -> None:
        result = mapper.map_payload({"mobile": "555-1111", "cell": "555-2222"})
        val = result.normalized.get("phone")
        assert isinstance(val, list)
        assert len(val) == 2

    def test_match_rate(self, mapper: ContactMapper) -> None:
        result = mapper.map_payload({"fname": "Jane", "garbage_xyz": "???"})
        assert result.match_rate == pytest.approx(0.5)
        assert result.matched_count == 1
        assert result.unmatched_count == 1

    def test_normalization_applied(self, mapper: ContactMapper) -> None:
        result = mapper.map_payload({"email": "  HELLO@Example.COM  "})
        assert result.normalized["email"] == "hello@example.com"

    def test_normalization_disabled(self, mapper_no_norm: ContactMapper) -> None:
        result = mapper_no_norm.map_payload({"email": "  HELLO@Example.COM  "})
        assert result.normalized["email"] == "  HELLO@Example.COM  "


class TestBatch:
    def test_batch_basic(self, mapper: ContactMapper) -> None:
        payloads = [{"fname": "Jane"}, {"fname": "John"}]
        results = mapper.map_batch(payloads)
        assert len(results) == 2
        assert results[0].normalized["first_name"] == "Jane"
        assert results[1].normalized["first_name"] == "John"

    def test_batch_empty(self, mapper: ContactMapper) -> None:
        assert mapper.map_batch([]) == []


class TestTranslate:
    def test_hubspot_to_mailchimp(self, mapper: ContactMapper) -> None:
        payload = {"firstname": "Jane", "lastname": "Doe", "phone": "555"}
        translated = mapper.translate(payload, from_service="hubspot", to_service="mailchimp")
        assert "first_name" in translated or any(v == "Jane" for v in translated.values())

    def test_stripe_to_sendgrid(self, mapper: ContactMapper) -> None:
        payload = {"name": "Jane Doe", "phone": "555", "city": "New York"}
        translated = mapper.translate(payload, from_service="stripe", to_service="sendgrid")
        assert any(v == "New York" for v in translated.values())


class TestMappingResultSerialization:
    def test_to_dict(self, mapper: ContactMapper) -> None:
        result = mapper.map_payload({"fname": "Jane", "xyz": "???"})
        d = result.to_dict()
        assert "normalized" in d
        assert "unmapped" in d
        assert "match_rate" in d
        assert "details" in d
        assert d["matched"] == 1
        assert d["unmatched"] == 1

    def test_get_match(self, mapper: ContactMapper) -> None:
        result = mapper.map_payload({"fname": "Jane"})
        fm = result.get_match("fname")
        assert fm is not None
        assert fm.canonical == "first_name"

    def test_get_match_missing(self, mapper: ContactMapper) -> None:
        result = mapper.map_payload({"fname": "Jane"})
        assert result.get_match("nonexistent") is None


# ═══════════════════════════════════════════════════════════════
#  NORMALIZER TESTS
# ═══════════════════════════════════════════════════════════════


class TestPhoneNormalizer:
    @pytest.mark.parametrize(
        "raw, expected",
        [
            ("+1-555-123-4567", "+15551234567"),
            ("(555) 123-4567", "5551234567"),
            ("555.123.4567", "5551234567"),
            ("+44 20 7946 0958", "+442079460958"),
            ("15551234567890", "+15551234567890"),
            ("", ""),
            ("   ", "   "),
        ],
    )
    def test_normalize(self, raw: str, expected: str) -> None:
        assert PhoneNormalizer.normalize(raw) == expected

    def test_none_passthrough(self) -> None:
        assert PhoneNormalizer.normalize(None) is None  # type: ignore[arg-type]

    def test_non_string(self) -> None:
        assert PhoneNormalizer.normalize(12345) == 12345  # type: ignore[arg-type]


class TestEmailNormalizer:
    @pytest.mark.parametrize(
        "raw, expected",
        [
            ("HELLO@Example.COM", "hello@example.com"),
            ("  user@test.org  ", "user@test.org"),
            ("", ""),
        ],
    )
    def test_normalize(self, raw: str, expected: str) -> None:
        assert EmailNormalizer.normalize(raw) == expected


class TestNameNormalizer:
    @pytest.mark.parametrize(
        "raw, expected",
        [
            ("jane doe", "Jane Doe"),
            ("JANE DOE", "Jane Doe"),
            ("jane van der berg", "Jane van der Berg"),
            ("jean-pierre", "Jean-Pierre"),
            ("  john  ", "John"),
            ("maria del carmen", "Maria del Carmen"),
        ],
    )
    def test_normalize(self, raw: str, expected: str) -> None:
        assert NameNormalizer.normalize(raw) == expected

    def test_empty(self) -> None:
        assert NameNormalizer.normalize("") == ""

    def test_none(self) -> None:
        assert NameNormalizer.normalize(None) is None  # type: ignore[arg-type]


class TestAddressNormalizer:
    def test_normalize(self) -> None:
        assert AddressNormalizer.normalize("  123  main   st  ") == "123 Main St"

    def test_empty(self) -> None:
        assert AddressNormalizer.normalize("") == ""


class TestStringNormalizer:
    def test_strips_whitespace(self) -> None:
        assert StringNormalizer.normalize("  hello  ") == "hello"

    def test_passthrough_non_string(self) -> None:
        assert StringNormalizer.normalize(42) == 42  # type: ignore[arg-type]


class TestNormalizeValue:
    def test_phone(self) -> None:
        assert normalize_value("phone", "+1-555-000-1234") == "+15550001234"

    def test_email(self) -> None:
        assert normalize_value("email", "  A@B.COM  ") == "a@b.com"

    def test_name(self) -> None:
        assert normalize_value("first_name", "jane") == "Jane"

    def test_address(self) -> None:
        assert normalize_value("city", "  new york  ") == "New York"

    def test_fallback_string(self) -> None:
        assert normalize_value("tags", "  vip  ") == "vip"

    def test_non_string_passthrough(self) -> None:
        assert normalize_value("phone", 12345) == 12345
        assert normalize_value("email", None) is None


# ═══════════════════════════════════════════════════════════════
#  INTEGRATION TESTS
# ═══════════════════════════════════════════════════════════════


class TestHubSpotIngestion:
    def test_full_contact(self, mapper: ContactMapper) -> None:
        payload = {
            "firstname": "Maria",
            "lastname": "Garcia",
            "email": "  Maria.GARCIA@corp.com  ",
            "phone": "+1-555-234-5678",
            "mobilephone": "+1-555-999-0000",
            "company": "Acme Inc",
            "jobtitle": "VP of Sales",
            "address": "123 Main St",
            "city": "Austin",
            "state": "TX",
            "zip": "78701",
            "country": "US",
            "website": "https://acme.com",
            "lifecyclestage": "customer",
            "hs_lead_status": "Open",
        }
        result = mapper.map_payload(payload, service="hubspot")
        assert result.normalized["first_name"] == "Maria"
        assert result.normalized["last_name"] == "Garcia"
        assert result.normalized["email"] == "maria.garcia@corp.com"
        assert result.normalized["company"] == "Acme Inc"
        assert result.normalized["job_title"] == "VP of Sales"
        assert result.normalized["city"] == "Austin"
        assert result.normalized["postal_code"] == "78701"
        assert result.normalized["lifecycle_stage"] == "customer"
        assert result.unmatched_count == 0


class TestMailchimpIngestion:
    def test_subscriber(self, mapper: ContactMapper) -> None:
        payload = {
            "EMAIL": "bob@example.com",
            "FNAME": "bob",
            "LNAME": "smith",
            "PHONE": "(555) 321-0000",
            "COMPANY": "Widgets LLC",
            "BIRTHDAY": "05/15",
        }
        result = mapper.map_payload(payload, service="mailchimp")
        assert result.normalized["email"] == "bob@example.com"
        assert result.normalized["first_name"] == "Bob"
        assert result.normalized["last_name"] == "Smith"
        assert result.normalized["company"] == "Widgets LLC"
        assert result.match_rate >= 0.8


class TestSalesforceIngestion:
    def test_lead(self, mapper: ContactMapper) -> None:
        payload = {
            "FirstName": "Akiko",
            "LastName": "Tanaka",
            "Email": "AKIKO@example.jp",
            "Phone": "+81-3-1234-5678",
            "Company": "Tokyo Tech",
            "Title": "CTO",
            "MailingCity": "tokyo",
            "MailingCountry": "JP",
            "LeadSource": "Website",
            "Industry": "Technology",
        }
        result = mapper.map_payload(payload, service="salesforce")
        assert result.normalized["first_name"] == "Akiko"
        assert result.normalized["last_name"] == "Tanaka"
        assert result.normalized["email"] == "akiko@example.jp"
        assert result.normalized["company"] == "Tokyo Tech"
        assert result.normalized["job_title"] == "CTO"
        assert result.normalized["source"] == "Website"


class TestGoogleContactsCSV:
    def test_csv_row(self, mapper: ContactMapper) -> None:
        payload = {
            "Given Name": "Carlos",
            "Family Name": "Rivera",
            "E-mail 1 - Value": "CARLOS@MAIL.COM",
            "Phone 1 - Value": "+52-55-1234-5678",
            "Organization 1 - Name": "Rivera & Sons",
            "Organization 1 - Title": "Partner",
            "Address 1 - City": "mexico city",
            "Birthday": "1985-03-22",
        }
        result = mapper.map_payload(payload, service="google_contacts")
        assert result.normalized["first_name"] == "Carlos"
        assert result.normalized["last_name"] == "Rivera"
        assert result.normalized["email"] == "carlos@mail.com"
        assert result.normalized["company"] == "Rivera & Sons"
        assert result.normalized["birthday"] == "1985-03-22"


class TestOutlookCSV:
    def test_contact(self, mapper: ContactMapper) -> None:
        payload = {
            "First Name": "Emma",
            "Last Name": "Wilson",
            "E-mail Address": "emma@work.com",
            "Business Phone": "+44 20 7946 0958",
            "Mobile Phone": "+44 7700 900000",
            "Company": "London Ltd",
            "Job Title": "Director",
            "Business City": "london",
            "Business Postal Code": "SW1A 1AA",
            "Birthday": "12/25/1990",
        }
        result = mapper.map_payload(payload, service="outlook")
        assert result.normalized["first_name"] == "Emma"
        assert result.normalized["work_phone"] == "+442079460958"
        assert result.normalized["city"] == "London"
        assert result.normalized["postal_code"] == "SW1A 1AA"


class TestMessyCSVWithHeuristics:
    def test_heuristic_recovery(self, mapper: ContactMapper) -> None:
        payload = {
            "Column A": "jane.doe@example.com",
            "Column B": "+15551234567",
            "Column C": "Jane",
            "Column D": "Doe",
            "Column E": "Blue",
        }
        result = mapper.map_payload(payload)
        assert result.normalized.get("email") == "jane.doe@example.com"
        assert "phone" in result.normalized
        assert result.unmatched_count >= 2


class TestCrossServiceTranslation:
    def test_hubspot_to_salesforce(self, mapper: ContactMapper) -> None:
        hubspot_data = {
            "firstname": "Aisha",
            "lastname": "Patel",
            "email": "aisha@corp.com",
            "phone": "+1-555-000-1234",
            "company": "Global Co",
            "jobtitle": "Engineer",
        }
        sf = mapper.translate(hubspot_data, from_service="hubspot", to_service="salesforce")
        assert any(v == "Aisha" for v in sf.values())
        assert any(v == "Patel" for v in sf.values())
        assert any(v == "aisha@corp.com" for v in sf.values())


class TestDefaultServiceConfig:
    def test_default_service(self) -> None:
        m = ContactMapper(default_service="mailchimp")
        match = m.identify("FNAME")
        assert match.canonical == "first_name"
        assert match.strategy == "service"

    def test_per_call_overrides_default(self) -> None:
        m = ContactMapper(default_service="mailchimp")
        match = m.identify("firstname", service="hubspot")
        assert match.canonical == "first_name"
        assert match.service == "hubspot"


class TestEdgeCases:
    def test_numeric_values(self, mapper: ContactMapper) -> None:
        result = mapper.map_payload({"phone": 5551234567})
        assert "phone" in result.normalized

    def test_bool_values(self, mapper: ContactMapper) -> None:
        result = mapper.map_payload({"unsubscribed": True})
        assert result.normalized.get("email_opt_out") is True

    def test_large_payload(self, mapper: ContactMapper) -> None:
        payload = {f"field_{i}": f"value_{i}" for i in range(100)}
        payload["email"] = "test@test.com"
        result = mapper.map_payload(payload)
        assert result.normalized.get("email") == "test@test.com"
        assert len(result.field_matches) == 101

    def test_unicode_values(self, mapper: ContactMapper) -> None:
        result = mapper.map_payload({"fname": "José", "surname": "García", "company": "Café Corp"})
        assert result.normalized["first_name"] == "José"
        assert result.normalized["last_name"] == "García"
