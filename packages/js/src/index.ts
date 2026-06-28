import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  findPhoneNumbersInText,
  parsePhoneNumberFromString,
} from "libphonenumber-js";
import type { CountryCode } from "libphonenumber-js";

export const EXACT_MATCH_CONFIDENCE = 1.0;
export const NORMALIZED_MATCH_CONFIDENCE = 0.95;
export const HEURISTIC_CONFIDENCE = 0.6;
export const EMBEDDED_PHONE_MAX_TEXT_CHARS = 8192;
export const EMBEDDED_PHONE_MAX_MATCHES_PER_FIELD = 5;
export const EMBEDDED_PHONE_MAX_MATCHES_PER_PAYLOAD = 20;

export class RolodexterError extends Error {}
export class PatternLoadError extends RolodexterError {}
export class NormalizationError extends RolodexterError {}

export interface FieldMatch {
  original: string;
  canonical: string;
  confidence: number;
  strategy: string;
  service?: string | null;
}

export interface PatternData {
  version?: string;
  fields?: Record<string, string[]>;
  expansion?: {
    form_prefixes?: string[];
    form_fields?: Record<string, string>;
    social_suffixes?: string[];
    social_fields?: string[];
  };
}

export interface ContactMapperOptions {
  patterns?: PatternData;
  normalize?: boolean;
  overrides?: Record<string, string>;
  defaultRegion?: string | null;
  strict?: boolean;
  confidenceThreshold?: number;
}

export interface MapPayloadOptions {
  depth?: number;
  defaultRegion?: string | null;
  extractEmbeddedPhones?: boolean;
  strict?: boolean;
  confidenceThreshold?: number;
}

export interface CompileSchemaOptions {
  defaultRegion?: string | null;
  strict?: boolean;
  confidenceThreshold?: number;
}

const UNKNOWN_MATCH = "unknown";
const PHONE_FIELDS = new Set(["phone", "home_phone", "work_phone", "fax", "whatsapp"]);
const NAME_FIELDS = new Set([
  "first_name",
  "last_name",
  "full_name",
  "middle_name",
  "nickname",
  "prefix",
  "suffix",
]);
const ADDRESS_FIELDS = new Set(["address_line1", "address_line2", "city", "full_address"]);
const BOOLEAN_FIELDS = new Set(["email_opt_out", "subscribed", "verified"]);
const LIST_FIELDS = new Set(["tags"]);
const SOCIAL_FIELDS = new Set([
  "website",
  "linkedin",
  "twitter",
  "facebook",
  "instagram",
  "github",
  "youtube",
  "tiktok",
  "discord",
  "telegram",
]);

const COMPANY_PREFIXES = new Set([
  "account",
  "accounts",
  "org",
  "organization",
  "organisations",
  "organizations",
  "organisation",
  "company",
  "companies",
  "firm",
  "business",
  "enterprise",
]);

const VENDOR_PREFIXES = [
  "hs_",
  "hubspot_",
  "sf_",
  "salesforce_",
  "sl_",
  "smartlead_",
];

const ADDRESS_PREFIXES = [
  "business_",
  "mailing_",
  "home_",
  "other_",
  "personal_",
  "shipping_",
  "billing_",
  "primary_",
  "secondary_",
];

function isMatched(match: FieldMatch): boolean {
  return match.canonical !== UNKNOWN_MATCH;
}

function unknown(header: string): FieldMatch {
  return {
    original: header,
    canonical: UNKNOWN_MATCH,
    confidence: 0,
    strategy: "none",
    service: null,
  };
}

function validateConfidenceThreshold(value: number): number {
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError("confidenceThreshold must be between 0.0 and 1.0");
  }
  return threshold;
}

function asCountryCode(region: string | null | undefined): CountryCode | undefined {
  return region ? (region.toUpperCase() as CountryCode) : undefined;
}

function valueForMatching(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function normalizeAlias(alias: string): string {
  return alias.toLowerCase().trim();
}

function loadDefaultPatterns(): PatternData {
  try {
    const path = fileURLToPath(new URL("./patterns.json", import.meta.url));
    return JSON.parse(readFileSync(path, "utf8")) as PatternData;
  } catch (error) {
    throw new PatternLoadError(`Failed to load bundled patterns: ${String(error)}`);
  }
}

export class PatternRegistry {
  readonly data: PatternData;
  private reverseIndex = new Map<string, string>();
  private aliasSet = new Set<string>();
  private aliases: string[] = [];
  private fields: string[] = [];

  constructor(options: { patterns?: PatternData; overrides?: Record<string, string> } = {}) {
    this.data = options.patterns ?? loadDefaultPatterns();
    this.buildIndexes();
    this.applyOverrides(options.overrides);
  }

  exactLookup(header: string): string | undefined {
    return this.reverseIndex.get(normalizeAlias(header));
  }

  get allAliases(): string[] {
    return [...this.aliases];
  }

  get canonicalFields(): string[] {
    return [...this.fields];
  }

  get version(): string {
    return this.data.version ?? "0.0.0";
  }

  private addAlias(alias: string, canonical: string): void {
    const key = normalizeAlias(alias);
    if (!this.reverseIndex.has(key)) {
      this.reverseIndex.set(key, canonical);
    }
    if (!this.aliasSet.has(key)) {
      this.aliasSet.add(key);
      this.aliases.push(key);
    }
  }

  private buildIndexes(): void {
    for (const [canonical, aliases] of Object.entries(this.data.fields ?? {})) {
      this.fields.push(canonical);
      for (const alias of aliases) {
        this.addAlias(alias, canonical);
      }
    }
    this.applyExpansionRules();
  }

  private applyExpansionRules(): void {
    const expansion = this.data.expansion;
    if (!expansion) {
      return;
    }

    for (const prefix of expansion.form_prefixes ?? []) {
      for (const [suffix, canonical] of Object.entries(expansion.form_fields ?? {})) {
        this.addAlias(`${prefix}${suffix}`, canonical);
      }
    }

    for (const platform of expansion.social_fields ?? []) {
      for (const suffix of expansion.social_suffixes ?? []) {
        this.addAlias(`${platform}${suffix}`, platform);
      }
    }
  }

  private applyOverrides(overrides?: Record<string, string>): void {
    if (!overrides) {
      return;
    }
    for (const [alias, canonical] of Object.entries(overrides)) {
      const key = normalizeAlias(alias);
      this.reverseIndex.set(key, canonical);
      if (!this.aliasSet.has(key)) {
        this.aliasSet.add(key);
        this.aliases.push(key);
      }
    }
  }
}

export class MappingResult {
  readonly normalized: Record<string, unknown>;
  readonly unmapped: Record<string, unknown>;
  readonly fieldMatches: FieldMatch[];
  readonly warnings: string[];
  private index?: Map<string, FieldMatch>;

  constructor(params: {
    normalized: Record<string, unknown>;
    unmapped: Record<string, unknown>;
    fieldMatches: FieldMatch[];
    warnings?: string[];
  }) {
    this.normalized = params.normalized;
    this.unmapped = params.unmapped;
    this.fieldMatches = params.fieldMatches;
    this.warnings = params.warnings ?? [];
  }

  get matchedCount(): number {
    return this.fieldMatches.filter(isMatched).length;
  }

  get unmatchedCount(): number {
    return this.fieldMatches.length - this.matchedCount;
  }

  get matchRate(): number {
    return this.fieldMatches.length === 0 ? 0 : this.matchedCount / this.fieldMatches.length;
  }

  getMatch(originalHeader: string): FieldMatch | undefined {
    if (!this.index) {
      this.index = new Map(this.fieldMatches.map((match) => [match.original, match]));
    }
    return this.index.get(originalHeader);
  }

  explain(): string {
    const lines = [
      `Mapping: ${this.matchedCount} matched, ${this.unmatchedCount} unmatched (match rate ${Math.round(this.matchRate * 100)}%)`,
    ];
    for (const match of this.fieldMatches) {
      const arrow = isMatched(match) ? "->" : "x";
      lines.push(
        `  ${JSON.stringify(match.original)} ${arrow} ${match.canonical} [${match.strategy}, conf=${match.confidence.toFixed(2)}]`,
      );
    }
    if (this.warnings.length > 0) {
      lines.push("Warnings:");
      for (const warning of this.warnings) {
        lines.push(`  ! ${warning}`);
      }
    }
    return lines.join("\n");
  }

  getAllPhones(): string[] {
    const phones: string[] = [];
    for (const key of PHONE_FIELDS) {
      const value = this.normalized[key];
      if (Array.isArray(value)) {
        phones.push(...value.map(String));
      } else if (value != null) {
        phones.push(String(value));
      }
    }
    return [...new Set(phones)];
  }

  toJSON(): Record<string, unknown> {
    const matched = this.matchedCount;
    const total = this.fieldMatches.length;
    return {
      normalized: { ...this.normalized },
      unmapped: { ...this.unmapped },
      match_rate: Number((total === 0 ? 0 : matched / total).toFixed(4)),
      matched,
      unmatched: total - matched,
      warnings: [...this.warnings],
      details: this.fieldMatches.map((match) => ({ ...match })),
    };
  }
}

export class MappingSchema {
  readonly matches: Map<string, FieldMatch>;
  private mapper: ContactMapper;
  private defaultRegion: string | null | undefined;

  constructor(params: {
    matches: Map<string, FieldMatch>;
    mapper: ContactMapper;
    defaultRegion?: string | null;
  }) {
    this.matches = params.matches;
    this.mapper = params.mapper;
    this.defaultRegion = params.defaultRegion;
  }

  columnMap(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [header, match] of this.matches) {
      if (isMatched(match)) {
        out[header] = match.canonical;
      }
    }
    return out;
  }

  unmatchedHeaders(): string[] {
    return [...this.matches.entries()]
      .filter(([, match]) => !isMatched(match))
      .map(([header]) => header);
  }

  apply(row: Record<string, unknown>, options: MapPayloadOptions = {}): MappingResult {
    return this.mapper.mapPayload(row, {
      defaultRegion: this.defaultRegion,
      ...options,
    });
  }
}

function splitCamel(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2");
}

function underscore(value: string): string {
  return value
    .replace(/[\s-]+/g, "_")
    .toLowerCase()
    .replace(/[^\w]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizedCandidates(header: string): string[] {
  const out: string[] = [];
  const h = header.trim();
  if (!h) {
    return out;
  }

  const uscore = underscore(h);
  if (uscore) {
    out.push(uscore);
  }

  if (/[A-Z]/.test(h.slice(1))) {
    const snake = splitCamel(h).toLowerCase().replace(/_+/g, "_").replace(/^_+|_+$/g, "");
    if (snake && snake !== uscore) {
      out.push(snake);
    }
  }

  if (h.includes(".")) {
    const dot = h.lastIndexOf(".");
    const prefixRaw = h.slice(0, dot).toLowerCase().trim();
    const suffixRaw = h.slice(dot + 1).trim();
    const suffixLower = suffixRaw.replace(/[\s-]+/g, "_").toLowerCase();
    const lastPrefix = prefixRaw.slice(prefixRaw.lastIndexOf(".") + 1);
    if (COMPANY_PREFIXES.has(lastPrefix) && ["name", "nombre"].includes(suffixLower)) {
      out.unshift("company");
    }
    if (suffixLower) {
      out.push(suffixLower);
    }
    if (/[A-Z]/.test(suffixRaw.slice(1))) {
      const snakeSuffix = splitCamel(suffixRaw).toLowerCase().replace(/_+/g, "_").replace(/^_+|_+$/g, "");
      if (snakeSuffix && snakeSuffix !== suffixLower) {
        out.push(snakeSuffix);
      }
    }
  }

  const indexed = /^(.+?)\s+\d+\s*(?:[-\u2013\u2014]\s*)?(.+)$/.exec(h);
  if (indexed) {
    const group = indexed[1]?.trim().replace(/[\s-]+/g, "_").toLowerCase();
    const prop = indexed[2]?.trim().replace(/[\s-]+/g, "_").toLowerCase();
    if (group && prop) {
      out.push(`${group}_${prop}`, prop, group);
    }
  }

  const numStripped = uscore.replace(/_\d+/g, "").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (numStripped && numStripped !== uscore) {
    out.push(numStripped);
  }

  for (const prefix of VENDOR_PREFIXES) {
    if (uscore.startsWith(prefix)) {
      out.push(uscore.slice(prefix.length));
    }
  }

  for (const prefix of ADDRESS_PREFIXES) {
    if (uscore.startsWith(prefix)) {
      out.push(uscore.slice(prefix.length));
    }
  }

  for (const candidate of [...out]) {
    if (candidate.endsWith("_id")) {
      const base = candidate.slice(0, -3);
      if (base && !out.includes(base)) {
        out.push(base);
      }
      for (const prefix of VENDOR_PREFIXES) {
        if (base.startsWith(prefix)) {
          const inner = base.slice(prefix.length);
          if (inner && !out.includes(inner)) {
            out.push(inner);
          }
        }
      }
    }
  }

  return out;
}

const SOCIAL_URL_PATTERNS: Array<[string, RegExp]> = [
  ["linkedin", /^https?:\/\/(www\.)?linkedin\.com\/(in|company|pub|school)\//i],
  ["twitter", /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/?$/i],
  ["instagram", /^https?:\/\/(www\.)?instagram\.com\/[a-zA-Z0-9_.]+\/?$/i],
  ["github", /^https?:\/\/(www\.)?github\.com\/[a-zA-Z0-9-]+\/?$/i],
  ["facebook", /^https?:\/\/(www\.)?(facebook\.com|fb\.com)\/[a-zA-Z0-9.]+\/?$/i],
  ["youtube", /^https?:\/\/(www\.)?youtube\.com\/((channel|c)\/[a-zA-Z0-9_-]+|@[a-zA-Z0-9_-]+)\/?$/i],
  ["tiktok", /^https?:\/\/(www\.)?tiktok\.com\/@[a-zA-Z0-9_.]+\/?$/i],
];

const HEURISTIC_PATTERNS: Array<[string, RegExp]> = [
  ["email", /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/],
  ["phone", /^\+?1?\s*[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/],
  ["phone", /^\+?[1-9]\d{6,14}$/],
  ...SOCIAL_URL_PATTERNS,
  ["website", /^https?:\/\/[^\s]+$/i],
  ["website", /^www\.[^\s]+\.[a-zA-Z]{2,}$/i],
  ["twitter", /^@[a-zA-Z0-9_]{1,15}$/],
  ["postal_code", /^\d{5}(-\d{4})?$/],
  ["postal_code", /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i],
  ["postal_code", /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i],
  ["birthday", /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/],
  ["birthday", /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/],
  ["birthday", /^\d{1,2}\.\d{1,2}\.\d{2,4}$/],
];

function heuristicMatch(header: string, value: string | undefined, defaultRegion: string | null | undefined): FieldMatch | undefined {
  if (!value) {
    return undefined;
  }
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > 512) {
    return undefined;
  }

  for (const [canonical, pattern] of HEURISTIC_PATTERNS) {
    if (!pattern.test(cleaned)) {
      continue;
    }
    if (canonical === "phone" && !isPossiblePhone(cleaned, defaultRegion)) {
      continue;
    }
    return {
      original: header,
      canonical,
      confidence: HEURISTIC_CONFIDENCE,
      strategy: "heuristic",
      service: null,
    };
  }
  return undefined;
}

function normalizePhone(value: unknown, defaultRegion: string | null | undefined): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const raw = value.trim();
  if (!raw) {
    return value;
  }
  try {
    const parsed = parsePhoneNumberFromString(raw, asCountryCode(defaultRegion));
    if (parsed?.isPossible()) {
      return parsed.number;
    }
  } catch {
    return value;
  }
  return value;
}

function isPossiblePhone(value: string, defaultRegion: string | null | undefined): boolean {
  try {
    return parsePhoneNumberFromString(value, asCountryCode(defaultRegion))?.isPossible() ?? false;
  } catch {
    return false;
  }
}

function titleWord(word: string): string {
  if (!word) {
    return word;
  }
  const lower = word.toLowerCase();
  if (/^\d+(st|nd|rd|th)$/.test(lower)) {
    return lower;
  }
  if (lower.startsWith("mc") && lower.length > 2) {
    return `Mc${lower[2]?.toUpperCase() ?? ""}${lower.slice(3)}`;
  }
  return `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`;
}

function smartTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => {
      if (word !== word.toUpperCase() && word !== word.toLowerCase() && /[A-Z]/.test(word.slice(1))) {
        return word;
      }
      if (word.includes("'")) {
        const [first = "", ...rest] = word.split("'");
        return [titleWord(first), ...rest.map((part) => (part.length > 1 ? titleWord(part) : part.toLowerCase()))].join("'");
      }
      return titleWord(word);
    })
    .join(" ");
}

export function normalizeValue(canonicalField: string, value: unknown, defaultRegion: string | null = "US"): unknown {
  if (PHONE_FIELDS.has(canonicalField)) {
    return normalizePhone(value, defaultRegion);
  }
  if (canonicalField === "email" && typeof value === "string") {
    return value.trim().toLowerCase();
  }
  if (NAME_FIELDS.has(canonicalField) && typeof value === "string") {
    const text = value.trim();
    return text ? smartTitleCase(text) : value;
  }
  if (ADDRESS_FIELDS.has(canonicalField) && typeof value === "string") {
    const text = value.trim().replace(/\s+/g, " ");
    return text ? smartTitleCase(text) : value;
  }
  if (canonicalField === "postal_code" && typeof value === "string") {
    const cleaned = value.trim().toUpperCase();
    return cleaned.replace(/^([A-Z]\d[A-Z])(\d[A-Z]\d)$/, "$1 $2");
  }
  if (BOOLEAN_FIELDS.has(canonicalField) && typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (["true", "yes", "1", "on", "y", "opted_in", "subscribed", "opt_in"].includes(lower)) {
      return true;
    }
    if (["false", "no", "0", "off", "n", "opted_out", "unsubscribed", "opt_out"].includes(lower)) {
      return false;
    }
    return value.trim();
  }
  if (LIST_FIELDS.has(canonicalField)) {
    if (Array.isArray(value)) {
      return value.map(String).map((item) => item.trim()).filter(Boolean);
    }
    if (typeof value !== "string") {
      return value;
    }
    const text = value.trim();
    if (!text) {
      return value;
    }
    if (text.startsWith("[")) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.map(String).map((item) => item.trim()).filter(Boolean);
        }
      } catch {
        // Fall through to separator-based parsing.
      }
    }
    const separator = text.includes(";") ? ";" : text.includes(",") ? "," : undefined;
    if (separator) {
      const items = text.split(separator).map((item) => item.trim()).filter(Boolean);
      if (items.length > 0) {
        return items;
      }
    }
    return [text];
  }
  if (SOCIAL_FIELDS.has(canonicalField) && typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return value;
}

function mergeValue(target: Record<string, unknown>, key: string, value: unknown): void {
  if (LIST_FIELDS.has(key)) {
    if (!(key in target)) {
      target[key] = Array.isArray(value) ? [...value] : value;
      return;
    }
    const incoming = Array.isArray(value) ? value : [value];
    const existing = Array.isArray(target[key]) ? target[key] : [target[key]];
    target[key] = [...existing, ...incoming.filter((item) => !existing.includes(item))];
    return;
  }

  if (!(key in target)) {
    target[key] = value;
    return;
  }
  const existing = target[key];
  if (Array.isArray(existing)) {
    if (!existing.includes(value)) {
      existing.push(value);
    }
  } else if (existing !== value) {
    target[key] = [existing, value];
  }
}

export class ContactMapper {
  readonly registry: PatternRegistry;
  private normalize: boolean;
  private defaultRegion: string | null;
  private strict: boolean;
  private confidenceThreshold: number;
  private headerCache = new Map<string, FieldMatch | undefined>();

  constructor(options: ContactMapperOptions = {}) {
    this.registry = new PatternRegistry({
      patterns: options.patterns,
      overrides: options.overrides,
    });
    this.normalize = options.normalize ?? true;
    this.defaultRegion = options.defaultRegion === undefined ? "US" : options.defaultRegion;
    this.strict = options.strict ?? false;
    this.confidenceThreshold = validateConfidenceThreshold(options.confidenceThreshold ?? 0);
  }

  identify(header: string, options: { value?: string; defaultRegion?: string | null } = {}): FieldMatch {
    const exact = this.registry.exactLookup(header);
    if (exact) {
      return {
        original: header,
        canonical: exact,
        confidence: EXACT_MATCH_CONFIDENCE,
        strategy: "exact",
        service: null,
      };
    }

    for (const candidate of normalizedCandidates(header)) {
      const canonical = this.registry.exactLookup(candidate);
      if (canonical) {
        return {
          original: header,
          canonical,
          confidence: NORMALIZED_MATCH_CONFIDENCE,
          strategy: "normalized",
          service: null,
        };
      }
    }

    const heuristic = heuristicMatch(header, options.value, options.defaultRegion ?? this.defaultRegion);
    return heuristic ?? unknown(header);
  }

  mapPayload(payload: Record<string, unknown>, options: MapPayloadOptions = {}): MappingResult {
    const depth = Math.max(1, Math.min(options.depth ?? 1, 5));
    const flat = depth > 1 ? flatten(payload, depth) : payload;
    const region = options.defaultRegion === undefined ? this.defaultRegion : options.defaultRegion;
    const threshold = validateConfidenceThreshold(options.confidenceThreshold ?? this.confidenceThreshold);
    const isStrict = options.strict ?? this.strict;

    const normalized: Record<string, unknown> = {};
    const unmapped: Record<string, unknown> = {};
    const fieldMatches: FieldMatch[] = [];
    const warnings: string[] = [];

    for (const [key, value] of Object.entries(flat)) {
      let match = this.resolve(key, value, region);

      if (isMatched(match) && match.confidence < threshold) {
        warnings.push(
          `${JSON.stringify(key)}: dropped low-confidence match to ${JSON.stringify(match.canonical)} (confidence ${match.confidence.toFixed(2)} < threshold ${threshold.toFixed(2)})`,
        );
        match = unknown(key);
      }

      fieldMatches.push(match);

      if (isMatched(match)) {
        const finalValue = this.normalize ? normalizeValue(match.canonical, value, region) : value;
        if (
          PHONE_FIELDS.has(match.canonical) &&
          typeof finalValue === "string" &&
          finalValue.trim() &&
          !finalValue.startsWith("+")
        ) {
          warnings.push(
            `${JSON.stringify(key)}: phone value ${JSON.stringify(finalValue)} could not be normalized to E.164 (set a matching defaultRegion?)`,
          );
        }
        mergeValue(normalized, match.canonical, finalValue);
      } else {
        unmapped[key] = value;
      }
    }

    if (options.extractEmbeddedPhones) {
      extractEmbeddedPhones(normalized, unmapped, fieldMatches, warnings, region);
    }

    if (warnings.length > 0 && isStrict) {
      throw new NormalizationError(warnings.join("; "));
    }

    return new MappingResult({ normalized, unmapped, fieldMatches, warnings });
  }

  mapBatch(payloads: Array<Record<string, unknown>>, options: MapPayloadOptions = {}): MappingResult[] {
    return payloads.map((payload) => this.mapPayload(payload, options));
  }

  *mapStream(payloads: Iterable<Record<string, unknown>>, options: MapPayloadOptions = {}): Generator<MappingResult> {
    for (const payload of payloads) {
      yield this.mapPayload(payload, options);
    }
  }

  compileSchema(headers: Iterable<string>, options: CompileSchemaOptions = {}): MappingSchema {
    const region = options.defaultRegion === undefined ? this.defaultRegion : options.defaultRegion;
    const threshold = validateConfidenceThreshold(options.confidenceThreshold ?? this.confidenceThreshold);
    const isStrict = options.strict ?? this.strict;
    const matches = new Map<string, FieldMatch>();
    const warnings: string[] = [];

    for (const header of headers) {
      let match = this.resolve(header, undefined, region);
      if (isMatched(match) && match.confidence < threshold) {
        warnings.push(
          `${JSON.stringify(header)}: dropped low-confidence match to ${JSON.stringify(match.canonical)} (confidence ${match.confidence.toFixed(2)} < threshold ${threshold.toFixed(2)})`,
        );
        match = unknown(header);
      }
      matches.set(header, match);
    }

    if (warnings.length > 0 && isStrict) {
      throw new NormalizationError(warnings.join("; "));
    }

    return new MappingSchema({ matches, mapper: this, defaultRegion: region });
  }

  private resolve(header: string, value: unknown, region: string | null | undefined): FieldMatch {
    if (this.headerCache.has(header)) {
      const cached = this.headerCache.get(header);
      if (cached) {
        return cached;
      }
    } else {
      const match = this.identify(header, { defaultRegion: region });
      const headerOnlyMatch = isMatched(match) ? match : undefined;
      this.headerCache.set(header, headerOnlyMatch);
      if (headerOnlyMatch) {
        return headerOnlyMatch;
      }
    }

    return heuristicMatch(header, valueForMatching(value), region) ?? unknown(header);
  }
}

function flatten(payload: Record<string, unknown>, depth: number, prefix = "", current = 1): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const fullKey = prefix ? `${prefix}${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value) && current < depth) {
      Object.assign(result, flatten(value as Record<string, unknown>, depth, `${fullKey}.`, current + 1));
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

function extractEmbeddedPhones(
  normalized: Record<string, unknown>,
  unmapped: Record<string, unknown>,
  fieldMatches: FieldMatch[],
  warnings: string[],
  defaultRegion: string | null | undefined,
): void {
  const candidates: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(unmapped)) {
    if (typeof value === "string" && value.length > 6) {
      candidates.push([key, value]);
    }
  }
  for (const [key, value] of Object.entries(normalized)) {
    if (!PHONE_FIELDS.has(key) && typeof value === "string" && value.length > 6) {
      candidates.push([key, value]);
    }
  }

  let foundTotal = 0;
  let warnedPayloadLimit = false;

  for (const [key, text] of candidates) {
    if (foundTotal >= EMBEDDED_PHONE_MAX_MATCHES_PER_PAYLOAD) {
      if (!warnedPayloadLimit) {
        warnings.push(
          `embedded phone extraction stopped after ${EMBEDDED_PHONE_MAX_MATCHES_PER_PAYLOAD} matches for this payload`,
        );
      }
      break;
    }

    let scanText = text;
    if (scanText.length > EMBEDDED_PHONE_MAX_TEXT_CHARS) {
      warnings.push(
        `${JSON.stringify(key)}: embedded phone scan truncated at ${EMBEDDED_PHONE_MAX_TEXT_CHARS} characters`,
      );
      scanText = scanText.slice(0, EMBEDDED_PHONE_MAX_TEXT_CHARS);
    }

    const remainingPayload = EMBEDDED_PHONE_MAX_MATCHES_PER_PAYLOAD - foundTotal;
    const fieldLimit = Math.min(EMBEDDED_PHONE_MAX_MATCHES_PER_FIELD, remainingPayload);
    const foundNumbers = findPhoneNumbersInText(scanText, asCountryCode(defaultRegion));

    for (const found of foundNumbers.slice(0, fieldLimit)) {
      mergeValue(normalized, "phone", found.number.number);
      fieldMatches.push({
        original: key,
        canonical: "phone",
        confidence: HEURISTIC_CONFIDENCE,
        strategy: "embedded_phone",
        service: null,
      });
      foundTotal += 1;
    }

    if (foundNumbers.length > fieldLimit) {
      if (fieldLimit === EMBEDDED_PHONE_MAX_MATCHES_PER_FIELD) {
        warnings.push(
          `${JSON.stringify(key)}: embedded phone extraction stopped after ${EMBEDDED_PHONE_MAX_MATCHES_PER_FIELD} matches for this field`,
        );
      }
      if (foundTotal >= EMBEDDED_PHONE_MAX_MATCHES_PER_PAYLOAD && !warnedPayloadLimit) {
        warnings.push(
          `embedded phone extraction stopped after ${EMBEDDED_PHONE_MAX_MATCHES_PER_PAYLOAD} matches for this payload`,
        );
        warnedPayloadLimit = true;
      }
    }
  }
}

export const version = "0.1.0";
