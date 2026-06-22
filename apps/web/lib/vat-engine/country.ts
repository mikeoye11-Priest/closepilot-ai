const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "EL", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

const COUNTRY_ALIASES: Record<string, string> = {
  UK: "GB",
  GB: "GB",
  GBR: "GB",
  "GREAT BRITAIN": "GB",
  "UNITED KINGDOM": "GB",
  ENGLAND: "GB",
  SCOTLAND: "GB",
  WALES: "GB",
  "NORTHERN IRELAND": "XI",
  IE: "IE",
  IRL: "IE",
  IRELAND: "IE",
  FR: "FR",
  FRA: "FR",
  FRANCE: "FR",
  CN: "CN",
  CHN: "CN",
  CHINA: "CN",
  US: "US",
  USA: "US",
  "UNITED STATES": "US",
};

export function normaliseCountry(rawCountry: string | undefined) {
  const cleaned = (rawCountry ?? "").trim().toUpperCase();
  if (!cleaned) return { code: "", region: "unknown" as const };
  const code = COUNTRY_ALIASES[cleaned] ?? cleaned.slice(0, 2);
  if (code === "GB") return { code, region: "domestic" as const };
  if (EU_COUNTRIES.has(code)) return { code, region: "eu" as const };
  return { code, region: "non_eu" as const };
}

export function isDomesticCountry(rawCountry: string | undefined) {
  return normaliseCountry(rawCountry).region === "domestic";
}
