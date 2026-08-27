/**
 * ISO 4217 currency metadata.
 *
 * See docs/04-split-engine.md §1 ("Currency metadata — all of ISO 4217") and
 * docs/03-data-model.md D6 ("All ISO 4217 currencies; one per group").
 *
 * Like `./money`, this module deliberately has **zero imports** so that `src/domain/**` can
 * depend on it without acquiring a runtime dependency (Constitution Article VII).
 */

/**
 * The ISO 4217 minor-unit exponent: how many decimal places the currency has.
 *
 * Only three values occur among circulating currencies:
 * - `0` — no minor unit at all (JPY, KRW, VND, XAF, …)
 * - `2` — the familiar hundredth (USD, EUR, INR, …)
 * - `3` — thousandths (the Gulf and Maghreb dinars: BHD, IQD, JOD, KWD, LYD, OMR, TND)
 */
export type CurrencyExponent = 0 | 2 | 3;

/**
 * ╔══════════════════════════════════════════════════════════════════════════════════════════╗
 * ║ 🔴 THE EXPONENT TABLE MUST BE HARDCODED. THIS TABLE IS THAT HARDCODING.                   ║
 * ╚══════════════════════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ **Never derive an exponent from `Intl.NumberFormat`.** It is tempting —
 * `new Intl.NumberFormat(l, { style: 'currency', currency: c }).resolvedOptions()
 * .minimumFractionDigits` returns the right answer in a browser — but ICU data varies between
 * JavaScript runtimes, and **Hermes on React Native is frequently built with a trimmed ICU**.
 *
 * If the web app stores an amount with exponent 2 and the mobile app reads it back with
 * exponent 0, every amount is wrong by 100×, silently, in both directions. There is no error,
 * no exception, and no way for a user to tell you what went wrong beyond "the numbers are mad".
 *
 * The split is absolute:
 * - **This static table** → parsing, storage, and all arithmetic.
 * - **`Intl.NumberFormat`** → display only. If ICU disagrees about a symbol or a thousands
 *   separator, the worst case is cosmetic.
 *
 * `symbol` below exists for the same reason: it is the fallback if the Hermes `Intl` build turns
 * out to be trimmed (docs/04-split-engine.md §1, "Confirm the Hermes `Intl` build flag in
 * Phase 12"). It is **display data**. Never compute with it.
 *
 * ---
 *
 * **Scope of the table.** Every circulating national currency in ISO 4217 (157 entries).
 * Deliberately excluded, because none of them can be the currency of a dinner bill and each
 * would be a correctness hazard in a picker:
 * - precious metals `XAU` `XAG` `XPT` `XPD` — priced per troy ounce, no minor unit
 * - fund/index codes `CLF` `UYI` `UYW` `BOV` `COU` `MXV` `CHE` `CHW` `USN` — some at exponent 4
 * - supranational and special codes `XDR` `XUA` `XSU` `XBA`–`XBD` `XTS` `XXX`
 * - withdrawn codes (`ZWL`, `SLL`, `VEF`, `MRO`, `STD`, `CUC`, `BYR`, …)
 *
 * `ANG` is retained alongside its 2025 successor `XCG` so that documents written before the
 * changeover still parse.
 */
const RAW_CURRENCIES = {
  AED: { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', exponent: 2 },
  AFN: { code: 'AFN', name: 'Afghan Afghani', symbol: '؋', exponent: 2 },
  ALL: { code: 'ALL', name: 'Albanian Lek', symbol: 'L', exponent: 2 },
  AMD: { code: 'AMD', name: 'Armenian Dram', symbol: '֏', exponent: 2 },
  ANG: { code: 'ANG', name: 'Netherlands Antillean Guilder', symbol: 'ƒ', exponent: 2 },
  AOA: { code: 'AOA', name: 'Angolan Kwanza', symbol: 'Kz', exponent: 2 },
  ARS: { code: 'ARS', name: 'Argentine Peso', symbol: '$', exponent: 2 },
  AUD: { code: 'AUD', name: 'Australian Dollar', symbol: '$', exponent: 2 },
  AWG: { code: 'AWG', name: 'Aruban Florin', symbol: 'ƒ', exponent: 2 },
  AZN: { code: 'AZN', name: 'Azerbaijani Manat', symbol: '₼', exponent: 2 },
  BAM: { code: 'BAM', name: 'Bosnia-Herzegovina Convertible Mark', symbol: 'KM', exponent: 2 },
  BBD: { code: 'BBD', name: 'Barbadian Dollar', symbol: '$', exponent: 2 },
  BDT: { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳', exponent: 2 },
  BGN: { code: 'BGN', name: 'Bulgarian Lev', symbol: 'лв', exponent: 2 },
  // ↓ exponent 3
  BHD: { code: 'BHD', name: 'Bahraini Dinar', symbol: 'د.ب', exponent: 3 },
  // ↓ exponent 0
  BIF: { code: 'BIF', name: 'Burundian Franc', symbol: 'FBu', exponent: 0 },
  BMD: { code: 'BMD', name: 'Bermudian Dollar', symbol: '$', exponent: 2 },
  BND: { code: 'BND', name: 'Brunei Dollar', symbol: '$', exponent: 2 },
  BOB: { code: 'BOB', name: 'Bolivian Boliviano', symbol: 'Bs.', exponent: 2 },
  BRL: { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', exponent: 2 },
  BSD: { code: 'BSD', name: 'Bahamian Dollar', symbol: '$', exponent: 2 },
  BTN: { code: 'BTN', name: 'Bhutanese Ngultrum', symbol: 'Nu.', exponent: 2 },
  BWP: { code: 'BWP', name: 'Botswana Pula', symbol: 'P', exponent: 2 },
  BYN: { code: 'BYN', name: 'Belarusian Ruble', symbol: 'Br', exponent: 2 },
  BZD: { code: 'BZD', name: 'Belize Dollar', symbol: 'BZ$', exponent: 2 },
  CAD: { code: 'CAD', name: 'Canadian Dollar', symbol: '$', exponent: 2 },
  CDF: { code: 'CDF', name: 'Congolese Franc', symbol: 'FC', exponent: 2 },
  CHF: { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', exponent: 2 },
  // ↓ exponent 0
  CLP: { code: 'CLP', name: 'Chilean Peso', symbol: '$', exponent: 0 },
  CNY: { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', exponent: 2 },
  COP: { code: 'COP', name: 'Colombian Peso', symbol: '$', exponent: 2 },
  CRC: { code: 'CRC', name: 'Costa Rican Colón', symbol: '₡', exponent: 2 },
  CUP: { code: 'CUP', name: 'Cuban Peso', symbol: '$', exponent: 2 },
  CVE: { code: 'CVE', name: 'Cape Verdean Escudo', symbol: '$', exponent: 2 },
  CZK: { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč', exponent: 2 },
  // ↓ exponent 0
  DJF: { code: 'DJF', name: 'Djiboutian Franc', symbol: 'Fdj', exponent: 0 },
  DKK: { code: 'DKK', name: 'Danish Krone', symbol: 'kr', exponent: 2 },
  DOP: { code: 'DOP', name: 'Dominican Peso', symbol: 'RD$', exponent: 2 },
  DZD: { code: 'DZD', name: 'Algerian Dinar', symbol: 'د.ج', exponent: 2 },
  EGP: { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£', exponent: 2 },
  ERN: { code: 'ERN', name: 'Eritrean Nakfa', symbol: 'Nfk', exponent: 2 },
  ETB: { code: 'ETB', name: 'Ethiopian Birr', symbol: 'Br', exponent: 2 },
  EUR: { code: 'EUR', name: 'Euro', symbol: '€', exponent: 2 },
  FJD: { code: 'FJD', name: 'Fijian Dollar', symbol: '$', exponent: 2 },
  FKP: { code: 'FKP', name: 'Falkland Islands Pound', symbol: '£', exponent: 2 },
  GBP: { code: 'GBP', name: 'British Pound', symbol: '£', exponent: 2 },
  GEL: { code: 'GEL', name: 'Georgian Lari', symbol: '₾', exponent: 2 },
  GHS: { code: 'GHS', name: 'Ghanaian Cedi', symbol: '₵', exponent: 2 },
  GIP: { code: 'GIP', name: 'Gibraltar Pound', symbol: '£', exponent: 2 },
  GMD: { code: 'GMD', name: 'Gambian Dalasi', symbol: 'D', exponent: 2 },
  // ↓ exponent 0
  GNF: { code: 'GNF', name: 'Guinean Franc', symbol: 'FG', exponent: 0 },
  GTQ: { code: 'GTQ', name: 'Guatemalan Quetzal', symbol: 'Q', exponent: 2 },
  GYD: { code: 'GYD', name: 'Guyanese Dollar', symbol: '$', exponent: 2 },
  HKD: { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', exponent: 2 },
  HNL: { code: 'HNL', name: 'Honduran Lempira', symbol: 'L', exponent: 2 },
  HTG: { code: 'HTG', name: 'Haitian Gourde', symbol: 'G', exponent: 2 },
  HUF: { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft', exponent: 2 },
  IDR: { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', exponent: 2 },
  ILS: { code: 'ILS', name: 'Israeli New Shekel', symbol: '₪', exponent: 2 },
  INR: { code: 'INR', name: 'Indian Rupee', symbol: '₹', exponent: 2 },
  // ↓ exponent 3
  IQD: { code: 'IQD', name: 'Iraqi Dinar', symbol: 'ع.د', exponent: 3 },
  IRR: { code: 'IRR', name: 'Iranian Rial', symbol: '﷼', exponent: 2 },
  // ↓ exponent 0
  ISK: { code: 'ISK', name: 'Icelandic Króna', symbol: 'kr', exponent: 0 },
  JMD: { code: 'JMD', name: 'Jamaican Dollar', symbol: 'J$', exponent: 2 },
  // ↓ exponent 3
  JOD: { code: 'JOD', name: 'Jordanian Dinar', symbol: 'د.ا', exponent: 3 },
  // ↓ exponent 0
  JPY: { code: 'JPY', name: 'Japanese Yen', symbol: '¥', exponent: 0 },
  KES: { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', exponent: 2 },
  KGS: { code: 'KGS', name: 'Kyrgyzstani Som', symbol: 'с', exponent: 2 },
  KHR: { code: 'KHR', name: 'Cambodian Riel', symbol: '៛', exponent: 2 },
  // ↓ exponent 0
  KMF: { code: 'KMF', name: 'Comorian Franc', symbol: 'CF', exponent: 0 },
  KPW: { code: 'KPW', name: 'North Korean Won', symbol: '₩', exponent: 2 },
  // ↓ exponent 0
  KRW: { code: 'KRW', name: 'South Korean Won', symbol: '₩', exponent: 0 },
  // ↓ exponent 3
  KWD: { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'د.ك', exponent: 3 },
  KYD: { code: 'KYD', name: 'Cayman Islands Dollar', symbol: '$', exponent: 2 },
  KZT: { code: 'KZT', name: 'Kazakhstani Tenge', symbol: '₸', exponent: 2 },
  LAK: { code: 'LAK', name: 'Lao Kip', symbol: '₭', exponent: 2 },
  LBP: { code: 'LBP', name: 'Lebanese Pound', symbol: 'ل.ل', exponent: 2 },
  LKR: { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs', exponent: 2 },
  LRD: { code: 'LRD', name: 'Liberian Dollar', symbol: '$', exponent: 2 },
  LSL: { code: 'LSL', name: 'Lesotho Loti', symbol: 'L', exponent: 2 },
  // ↓ exponent 3
  LYD: { code: 'LYD', name: 'Libyan Dinar', symbol: 'ل.د', exponent: 3 },
  MAD: { code: 'MAD', name: 'Moroccan Dirham', symbol: 'د.م.', exponent: 2 },
  MDL: { code: 'MDL', name: 'Moldovan Leu', symbol: 'L', exponent: 2 },
  MGA: { code: 'MGA', name: 'Malagasy Ariary', symbol: 'Ar', exponent: 2 },
  MKD: { code: 'MKD', name: 'Macedonian Denar', symbol: 'ден', exponent: 2 },
  MMK: { code: 'MMK', name: 'Myanmar Kyat', symbol: 'K', exponent: 2 },
  MNT: { code: 'MNT', name: 'Mongolian Tugrik', symbol: '₮', exponent: 2 },
  MOP: { code: 'MOP', name: 'Macanese Pataca', symbol: 'MOP$', exponent: 2 },
  MRU: { code: 'MRU', name: 'Mauritanian Ouguiya', symbol: 'UM', exponent: 2 },
  MUR: { code: 'MUR', name: 'Mauritian Rupee', symbol: '₨', exponent: 2 },
  MVR: { code: 'MVR', name: 'Maldivian Rufiyaa', symbol: 'Rf', exponent: 2 },
  MWK: { code: 'MWK', name: 'Malawian Kwacha', symbol: 'MK', exponent: 2 },
  MXN: { code: 'MXN', name: 'Mexican Peso', symbol: '$', exponent: 2 },
  MYR: { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', exponent: 2 },
  MZN: { code: 'MZN', name: 'Mozambican Metical', symbol: 'MT', exponent: 2 },
  NAD: { code: 'NAD', name: 'Namibian Dollar', symbol: '$', exponent: 2 },
  NGN: { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', exponent: 2 },
  NIO: { code: 'NIO', name: 'Nicaraguan Córdoba', symbol: 'C$', exponent: 2 },
  NOK: { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr', exponent: 2 },
  NPR: { code: 'NPR', name: 'Nepalese Rupee', symbol: 'Rs', exponent: 2 },
  NZD: { code: 'NZD', name: 'New Zealand Dollar', symbol: '$', exponent: 2 },
  // ↓ exponent 3
  OMR: { code: 'OMR', name: 'Omani Rial', symbol: 'ر.ع.', exponent: 3 },
  PAB: { code: 'PAB', name: 'Panamanian Balboa', symbol: 'B/.', exponent: 2 },
  PEN: { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/', exponent: 2 },
  PGK: { code: 'PGK', name: 'Papua New Guinean Kina', symbol: 'K', exponent: 2 },
  PHP: { code: 'PHP', name: 'Philippine Peso', symbol: '₱', exponent: 2 },
  PKR: { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨', exponent: 2 },
  PLN: { code: 'PLN', name: 'Polish Zloty', symbol: 'zł', exponent: 2 },
  // ↓ exponent 0
  PYG: { code: 'PYG', name: 'Paraguayan Guarani', symbol: '₲', exponent: 0 },
  QAR: { code: 'QAR', name: 'Qatari Riyal', symbol: 'ر.ق', exponent: 2 },
  RON: { code: 'RON', name: 'Romanian Leu', symbol: 'lei', exponent: 2 },
  RSD: { code: 'RSD', name: 'Serbian Dinar', symbol: 'дин.', exponent: 2 },
  RUB: { code: 'RUB', name: 'Russian Ruble', symbol: '₽', exponent: 2 },
  // ↓ exponent 0
  RWF: { code: 'RWF', name: 'Rwandan Franc', symbol: 'FRw', exponent: 0 },
  SAR: { code: 'SAR', name: 'Saudi Riyal', symbol: 'ر.س', exponent: 2 },
  SBD: { code: 'SBD', name: 'Solomon Islands Dollar', symbol: '$', exponent: 2 },
  SCR: { code: 'SCR', name: 'Seychellois Rupee', symbol: '₨', exponent: 2 },
  SDG: { code: 'SDG', name: 'Sudanese Pound', symbol: 'ج.س.', exponent: 2 },
  SEK: { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', exponent: 2 },
  SGD: { code: 'SGD', name: 'Singapore Dollar', symbol: '$', exponent: 2 },
  SHP: { code: 'SHP', name: 'Saint Helena Pound', symbol: '£', exponent: 2 },
  SLE: { code: 'SLE', name: 'Sierra Leonean Leone', symbol: 'Le', exponent: 2 },
  SOS: { code: 'SOS', name: 'Somali Shilling', symbol: 'Sh', exponent: 2 },
  SRD: { code: 'SRD', name: 'Surinamese Dollar', symbol: '$', exponent: 2 },
  SSP: { code: 'SSP', name: 'South Sudanese Pound', symbol: '£', exponent: 2 },
  STN: { code: 'STN', name: 'São Tomé and Príncipe Dobra', symbol: 'Db', exponent: 2 },
  SVC: { code: 'SVC', name: 'Salvadoran Colón', symbol: '₡', exponent: 2 },
  SYP: { code: 'SYP', name: 'Syrian Pound', symbol: '£S', exponent: 2 },
  SZL: { code: 'SZL', name: 'Swazi Lilangeni', symbol: 'L', exponent: 2 },
  THB: { code: 'THB', name: 'Thai Baht', symbol: '฿', exponent: 2 },
  TJS: { code: 'TJS', name: 'Tajikistani Somoni', symbol: 'SM', exponent: 2 },
  TMT: { code: 'TMT', name: 'Turkmenistani Manat', symbol: 'm', exponent: 2 },
  // ↓ exponent 3
  TND: { code: 'TND', name: 'Tunisian Dinar', symbol: 'د.ت', exponent: 3 },
  TOP: { code: 'TOP', name: 'Tongan Paanga', symbol: 'T$', exponent: 2 },
  TRY: { code: 'TRY', name: 'Turkish Lira', symbol: '₺', exponent: 2 },
  TTD: { code: 'TTD', name: 'Trinidad and Tobago Dollar', symbol: 'TT$', exponent: 2 },
  TWD: { code: 'TWD', name: 'New Taiwan Dollar', symbol: 'NT$', exponent: 2 },
  TZS: { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh', exponent: 2 },
  UAH: { code: 'UAH', name: 'Ukrainian Hryvnia', symbol: '₴', exponent: 2 },
  // ↓ exponent 0
  UGX: { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', exponent: 0 },
  USD: { code: 'USD', name: 'US Dollar', symbol: '$', exponent: 2 },
  UYU: { code: 'UYU', name: 'Uruguayan Peso', symbol: '$U', exponent: 2 },
  UZS: { code: 'UZS', name: 'Uzbekistani Som', symbol: 'soum', exponent: 2 },
  VED: { code: 'VED', name: 'Venezuelan Bolívar Digital', symbol: 'Bs.D', exponent: 2 },
  VES: { code: 'VES', name: 'Venezuelan Bolívar Soberano', symbol: 'Bs.S', exponent: 2 },
  // ↓ exponent 0
  VND: { code: 'VND', name: 'Vietnamese Dong', symbol: '₫', exponent: 0 },
  // ↓ exponent 0
  VUV: { code: 'VUV', name: 'Vanuatu Vatu', symbol: 'VT', exponent: 0 },
  WST: { code: 'WST', name: 'Samoan Tala', symbol: 'T', exponent: 2 },
  // ↓ exponent 0
  XAF: { code: 'XAF', name: 'Central African CFA Franc', symbol: 'FCFA', exponent: 0 },
  XCD: { code: 'XCD', name: 'East Caribbean Dollar', symbol: '$', exponent: 2 },
  XCG: { code: 'XCG', name: 'Caribbean Guilder', symbol: 'Cg', exponent: 2 },
  // ↓ exponent 0
  XOF: { code: 'XOF', name: 'West African CFA Franc', symbol: 'CFA', exponent: 0 },
  // ↓ exponent 0
  XPF: { code: 'XPF', name: 'CFP Franc', symbol: '₣', exponent: 0 },
  YER: { code: 'YER', name: 'Yemeni Rial', symbol: '﷼', exponent: 2 },
  ZAR: { code: 'ZAR', name: 'South African Rand', symbol: 'R', exponent: 2 },
  ZMW: { code: 'ZMW', name: 'Zambian Kwacha', symbol: 'ZK', exponent: 2 },
  ZWG: { code: 'ZWG', name: 'Zimbabwe Gold', symbol: 'ZiG', exponent: 2 },
} as const satisfies Readonly<
  Record<
    string,
    {
      readonly code: string;
      readonly name: string;
      readonly symbol: string;
      readonly exponent: CurrencyExponent;
    }
  >
>;

/**
 * Every ISO 4217 currency code SplitSutra supports, as a string-literal union.
 *
 * Derived from {@link RAW_CURRENCIES}, so the union and the table can never drift apart.
 */
export type CurrencyCode = keyof typeof RAW_CURRENCIES;

/**
 * Everything the app needs to know about a currency without asking the platform.
 *
 * `exponent` is authoritative and is used for arithmetic. `symbol` and `name` are display data.
 */
export interface CurrencyMeta {
  code: CurrencyCode;
  name: string;
  symbol: string;
  exponent: number;
}

/**
 * The hardcoded ISO 4217 table. See the warning block above {@link RAW_CURRENCIES}.
 *
 * The explicit `Record<CurrencyCode, CurrencyMeta>` annotation is load-bearing: it is what makes
 * a missing entry a compile error rather than a runtime `undefined`.
 */
export const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = RAW_CURRENCIES;

/** Every supported code, ascending. Suitable for a searchable picker. */
export const CURRENCY_CODES: readonly CurrencyCode[] = (
  Object.keys(RAW_CURRENCIES) as CurrencyCode[]
).sort();

/** How many currencies the table covers. Asserted in tests so an accidental deletion is loud. */
export const CURRENCY_COUNT: number = CURRENCY_CODES.length;

/**
 * Pinned to the top of the currency picker; the rest of {@link CURRENCY_CODES} is searchable.
 * See docs/04-split-engine.md §1 and docs/07-ui-ux-spec.md.
 */
export const COMMON_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'INR',
  'CAD',
  'AUD',
  'JPY',
  'CNY',
] as const satisfies readonly CurrencyCode[];

/** Default for new users and new groups (docs/03-data-model.md, docs/04-split-engine.md §1). */
export const DEFAULT_CURRENCY: CurrencyCode = 'USD';

/**
 * The ISO 4217 minor-unit exponent for `code`.
 *
 * This is the single source of truth for how to interpret a stored `MinorUnits` integer.
 * `12550` is `125.50` at exponent 2 but `12550` at exponent 0 and `12.550` at exponent 3.
 */
export function getExponent(code: CurrencyCode): number {
  return CURRENCIES[code].exponent;
}

/**
 * `10 ** getExponent(code)` — the number of minor units in one major unit.
 *
 * Computed from the hardcoded exponent, never from `Intl`.
 */
export function getMinorUnitScale(code: CurrencyCode): number {
  return 10 ** CURRENCIES[code].exponent;
}

/** Full metadata for `code`. */
export function getCurrency(code: CurrencyCode): CurrencyMeta {
  return CURRENCIES[code];
}

/**
 * Narrowing predicate. Uses `hasOwnProperty` rather than `in` so inherited `Object.prototype`
 * members (`'toString'`, `'constructor'`, …) are not mistaken for currency codes.
 */
export function isCurrencyCode(v: string): v is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, v);
}
