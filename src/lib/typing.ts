// Text rules for typing by voice, kept apart from the page so they can be tested on their own.

/**
 * The text as it should follow what's already there: a space between words, none before punctuation or
 * after an opening bracket, so "type hello" then "type world" gives "hello world".
 */
export function spaced(before: string, text: string): string {
  if (!before || /\s$/.test(before) || /[(\["'“‘/@#-]$/.test(before) || /^[\s.,!?;:)\]}”’'%]/.test(text)) return text;
  return ` ${text}`;
}

/** Removes the last `count` words from a text field's value (and the space before them). */
export function withoutLastWords(value: string, count: number): string {
  let rest = value.replace(/\s+$/, "");
  for (let i = 0; i < count && rest; i++) rest = rest.replace(/\S+$/, "").replace(/\s+$/, "");
  return rest;
}
