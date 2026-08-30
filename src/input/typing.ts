/**
 * Is the focus somewhere letters are meant to land?
 *
 * The app reads the computer keyboard two ways at once. Letters are piano keys — A is C,
 * S is D, and so on — and other keys are shortcuts: space plays, `[` and `]` set the loop.
 * Both are listened for on the window, which is right for a keyboard you play and wrong
 * the moment there is a box on screen to type into. Naming a loop "Bridge" or searching
 * the sounds for "flute" would otherwise play a chord and swallow the word, because a key
 * that is heard as a note is also a key whose default is prevented.
 *
 * So every window-level key listener asks this first, and there is one answer for all of
 * them: a shortcut and a note are the same mistake here, and two rules that disagreed
 * would be a box you could search but not name, or the other way round.
 *
 * Deliberately narrow. A slider, a tick box and a dropdown are all things the focus can
 * land on and none of them is a place you are writing, so a key pressed over one of them
 * is still a key.
 */

/** The `<input>` types that letters actually go into, as against sliders and tick boxes. */
const TEXT_ENTRY = new Set(["text", "search", "email", "url", "tel", "password", "number"]);

/**
 * The decision itself, over the three things about an element that settle it.
 *
 * Split from `isTyping` so it can be checked without a DOM to hold — the same split as
 * `piano.ts` from `Player.ts`, and for the same reason: this is a rule, and a rule should
 * be arguable without an environment around it.
 */
export function takesTyping(
  tagName: string,
  inputType: string | null,
  contentEditable: boolean,
): boolean {
  if (contentEditable) return true;
  if (tagName === "TEXTAREA") return true;
  if (tagName !== "INPUT") return false;
  // An `<input>` that never said what it was is a text box, which is what the browser
  // makes of it too — so an absent type has to read as one here rather than as neither.
  const type = inputType === null || inputType === "" ? "text" : inputType;
  return TEXT_ENTRY.has(type);
}

/** The same question, of a real element — an event's target, or whatever has the focus. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return takesTyping(
    target.tagName,
    target instanceof HTMLInputElement ? target.type : null,
    target.isContentEditable,
  );
}
