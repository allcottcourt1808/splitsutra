/**
 * Guess an expense category from what the user typed as the description.
 *
 * A convenience, and deliberately a small one. Nothing downstream depends on the guess being
 * right: `category` is display and reporting metadata, it never touches an amount, a split or a
 * balance, and the person typing sees the chip move and can tap a different one. That is the
 * entire safety argument for doing this automatically rather than behind a confirmation.
 *
 * ## Precision over recall
 *
 * A wrong guess costs more than no guess. No guess leaves `general`, which is what the field
 * already defaults to and what a user who does not care about categories wants anyway; a wrong
 * guess has to be *noticed* and then undone. So the table below leaves out every term that
 * carries real ambiguity rather than reaching for coverage:
 *
 *   - `gas`    — an LPG cylinder (utilities) in India, gasoline (fuel) in the US. Only the
 *                unambiguous `gas station` / `petrol` / `diesel` are listed.
 *   - `bar`    — a drinks tab, a chocolate bar, the bar exam.
 *   - `market` — a supermarket run, a night market dinner, the stock market.
 *   - `auto`   — an auto-rickshaw (transport) or auto insurance.
 *   - `ticket` — a flight, a cinema seat, a parking fine.
 *   - `books`  — a textbook or a novel.
 *
 * ## Whole words only
 *
 * Matching is on word boundaries, not substrings, which is not a detail: `gas` inside
 * "gastropub" is food, `ola` inside "granola" is groceries, and `uber` inside "uber eats" is a
 * takeaway rather than a ride. The first two are handled by boundaries and the third by the
 * longest-match rule below.
 *
 * ## Longest match wins
 *
 * `uber eats` (9 chars) beats `uber` (4), `train ticket` beats `train`, `gas station` beats
 * `station`. Specificity is length here, because a longer keyword is a longer agreement with
 * what was actually typed. Ties fall to `EXPENSE_CATEGORIES` order, so the result is a pure
 * function of the input and never depends on object key iteration order.
 *
 * ⚠️ `medical`, `insurance` and `education` are SENSITIVE under Article XIII, and they are
 *    detected here like any other category. That is safe as far as advertising is concerned —
 *    docs/14 §4 maps all three to `general` in the ad enum, so an inferred category cannot reach
 *    an ad request any more than a hand-picked one can — but keep their keyword lists narrow and
 *    literal. Inferring "medical" from something suggestive rather than something stated is the
 *    one wrong guess here that would feel like being read rather than helped.
 */

import { EXPENSE_CATEGORIES, type ExpenseCategory } from '../types/expense.js';

/**
 * Keywords per category, lowercase and single-spaced.
 *
 * `general` is present and empty because the record is keyed by the whole `ExpenseCategory`
 * union — a category added to `EXPENSE_CATEGORIES` and forgotten here is a type error rather
 * than a silently undetectable category.
 */
const KEYWORDS: Readonly<Record<ExpenseCategory, readonly string[]>> = {
  // The fallback. Nothing "detects" as general — it is what you get when nothing matched.
  general: [],

  food: [
    'restaurant',
    'dinner',
    'lunch',
    'breakfast',
    'brunch',
    'supper',
    'food',
    'meal',
    'meals',
    'pizza',
    'burger',
    'burgers',
    'sushi',
    'pasta',
    'noodles',
    'sandwich',
    'biryani',
    'dosa',
    'thali',
    'curry',
    'tacos',
    'ramen',
    'cafe',
    'coffee',
    'starbucks',
    'chai',
    'bakery',
    'dessert',
    'desserts',
    'ice cream',
    'snacks',
    'takeaway',
    'takeout',
    'dhaba',
    'canteen',
    'diner',
    'bistro',
    'buffet',
    'swiggy',
    'zomato',
    'doordash',
    'grubhub',
    'uber eats',
    'ubereats',
    'dominos',
    'mcdonalds',
    'mcdonald',
    'kfc',
    'chipotle',
    'drinks',
    'beer',
    'beers',
    'wine',
    'cocktails',
    'pub',
    'brewery',
    'bar tab',
  ],

  groceries: [
    'grocery',
    'groceries',
    'supermarket',
    'kirana',
    'provisions',
    'vegetables',
    'veggies',
    'produce',
    'bigbasket',
    'blinkit',
    'zepto',
    'dmart',
    'instamart',
    'walmart',
    'costco',
    'trader joes',
    'whole foods',
    'safeway',
    'kroger',
    'aldi',
    'instacart',
    'tesco',
    'sainsburys',
  ],

  transport: [
    'uber',
    'ola',
    'lyft',
    'taxi',
    'cab',
    'rickshaw',
    'autorickshaw',
    'metro',
    'tram',
    'bus',
    'bus fare',
    'parking',
    'toll',
    'tolls',
    'commute',
    'rapido',
    'car rental',
    'zipcar',
    'bike rental',
    'scooter rental',
    'transit',
    'oyster card',
    'fastag',
  ],

  fuel: [
    'petrol',
    'diesel',
    'fuel',
    'gasoline',
    'gas station',
    'petrol pump',
    'filling station',
    'ev charging',
    'charging station',
    'bharat petroleum',
    'indian oil',
  ],

  travel: [
    'flight',
    'flights',
    'airfare',
    'airline',
    'airport',
    'boarding pass',
    'indigo',
    'vistara',
    'spicejet',
    'emirates',
    'train ticket',
    'irctc',
    'railway',
    'trip',
    'vacation',
    'holiday',
    'tour',
    'sightseeing',
    'excursion',
    'luggage',
    'baggage',
    'passport',
    'visa fee',
    'travel insurance',
    'cruise',
  ],

  accommodation: [
    'hotel',
    'hostel',
    'airbnb',
    'motel',
    'resort',
    'lodge',
    'lodging',
    'guesthouse',
    'homestay',
    'oyo',
    'booking com',
    'agoda',
    'accommodation',
    'room booking',
    'stay',
  ],

  rent: ['rent', 'lease', 'landlord', 'security deposit', 'house rent', 'flat rent', 'sublet'],

  utilities: [
    'electricity',
    'electric bill',
    'power bill',
    'water bill',
    'internet',
    'wifi',
    'broadband',
    'phone bill',
    'mobile bill',
    'recharge',
    'gas cylinder',
    'lpg',
    'cable',
    'dth',
    'utility',
    'utilities',
    'sewage',
    'jio',
    'airtel',
    'comcast',
    'xfinity',
    'verizon',
  ],

  household: [
    'cleaning',
    'detergent',
    'dishwasher',
    'furniture',
    'ikea',
    'plumber',
    'electrician',
    'carpenter',
    'hardware',
    'laundry',
    'housekeeping',
    'maid',
    'kitchenware',
    'utensils',
    'appliance',
    'appliances',
    'toiletries',
    'household',
    'home repair',
    'pest control',
  ],

  entertainment: [
    'movie',
    'movies',
    'cinema',
    'netflix',
    'spotify',
    'hotstar',
    'prime video',
    'disney plus',
    'concert',
    'gig',
    'festival',
    'theatre',
    'theater',
    'museum',
    'zoo',
    'aquarium',
    'bowling',
    'arcade',
    'amusement park',
    'theme park',
    'gaming',
    'video game',
    'nightclub',
    'karaoke',
    'pvr',
    'inox',
    'bookmyshow',
    'subscription',
  ],

  // Article XIII sensitive — literal terms only, nothing inferential.
  medical: [
    'doctor',
    'dentist',
    'hospital',
    'clinic',
    'pharmacy',
    'chemist',
    'medicine',
    'medicines',
    'prescription',
    'physiotherapy',
    'vaccine',
    'vaccination',
    'lab test',
    'blood test',
    'xray',
    'x ray',
    'mri',
    'optician',
    'spectacles',
    'medical',
  ],

  // Article XIII sensitive.
  insurance: [
    'insurance',
    'premium',
    'policy renewal',
    'life insurance',
    'health insurance',
    'car insurance',
    'home insurance',
  ],

  // Article XIII sensitive.
  education: [
    'tuition',
    'school fee',
    'school fees',
    'college fee',
    'university fee',
    'semester fee',
    'textbook',
    'textbooks',
    'stationery',
    'coaching',
    'tutor',
    'tutoring',
    'udemy',
    'coursera',
    'exam fee',
    'admission fee',
    'course fee',
  ],
};

/**
 * `"Dinner at Olive"` becomes `" dinner at olive "`.
 *
 * Every non-alphanumeric run collapses to a single space and the result is padded, so a keyword
 * can be tested with a plain `includes(' ' + keyword + ' ')` — word boundaries for free,
 * multi-word keywords included, and no regex to escape per keyword.
 *
 * `\p{L}` and `\p{N}` rather than `\w`: a description may be typed in any script, and `\w` would
 * shred a non-Latin one into nothing.
 */
function normalize(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
}

/**
 * The best-matching category for a description, or `null` when nothing matched.
 *
 * `null` rather than `'general'`: "I found nothing" and "this is a general expense" are different
 * claims, and only the caller knows whether it is replacing an untouched default or a real
 * choice.
 */
export function detectExpenseCategory(description: string): ExpenseCategory | null {
  const haystack = normalize(description);
  if (haystack === '  ') return null;

  let best: ExpenseCategory | null = null;
  let bestLength = 0;

  // Iterated in EXPENSE_CATEGORIES order rather than in Object.keys order, so a tie resolves the
  // same way on every engine.
  for (const category of EXPENSE_CATEGORIES) {
    for (const keyword of KEYWORDS[category]) {
      if (keyword.length <= bestLength) continue;
      if (haystack.includes(` ${keyword} `)) {
        best = category;
        bestLength = keyword.length;
      }
    }
  }

  return best;
}
