// Speech engines return "twelve" as often as "12"; this handles both.

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
// Common mishearings when a number is said on its own ("click to", "tab for").
const HOMOPHONES: Record<string, number> = { won: 1, to: 2, too: 2, for: 4, fore: 4, ate: 8 };

export const NUMBER_PATTERN =
  "(\\d{1,4}|(?:(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[- ]?)?(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|one hundred|a hundred|won|to|too|for|fore|ate)";

export function parseNumber(raw: string): number | null {
  const text = raw.trim().toLowerCase().replace(/^number\s+/, "").replace(/(st|nd|rd|th)$/, "");
  if (/^\d+$/.test(text)) return Number(text);
  if (text === "one hundred" || text === "a hundred") return 100;
  if (text in HOMOPHONES) return HOMOPHONES[text];
  if (text in ONES) return ONES[text];
  if (text in TENS) return TENS[text];
  const parts = text.split(/[- ]+/);
  if (parts.length === 2 && parts[0] in TENS && parts[1] in ONES && ONES[parts[1]] < 10) {
    return TENS[parts[0]] + ONES[parts[1]];
  }
  return null;
}

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  last: -1,
};

export function parseOrdinal(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (text in ORDINALS) return ORDINALS[text];
  const m = text.match(/^(\d+)(st|nd|rd|th)$/);
  return m ? Number(m[1]) : null;
}
