import { describe, it, expect } from "vitest";
import { takesTyping } from "../src/input/typing.ts";

/**
 * Which keystrokes belong to a box and which belong to the piano.
 *
 * The app hears letters two ways at once — A is middle C, and A is also the first letter
 * of a sound you are searching for — and this is the only thing standing between them. Get
 * it wrong towards the piano and a search box plays a chord and swallows what you typed;
 * get it wrong towards the box and the piano goes quiet somewhere it should not.
 */

const input = (type: string) => takesTyping("INPUT", type, false);

describe("where letters go", () => {
  it("into the boxes that take words", () => {
    for (const type of ["text", "search", "email", "url", "tel", "password", "number"]) {
      expect(input(type)).toBe(true);
    }
    expect(takesTyping("TEXTAREA", null, false)).toBe(true);
  });

  /**
   * The controls the focus lands on that are not places you write. A slider or a tick box
   * with the focus is somewhere you might well want to play a note from — and, in the
   * sound picker, somewhere you land after every click.
   */
  it("not into a slider, a tick box or a button", () => {
    for (const type of ["range", "checkbox", "radio", "button", "submit", "color", "file"]) {
      expect(input(type)).toBe(false);
    }
  });

  it("not into the page, a dropdown, or a canvas", () => {
    expect(takesTyping("DIV", null, false)).toBe(false);
    expect(takesTyping("SELECT", null, false)).toBe(false);
    expect(takesTyping("CANVAS", null, false)).toBe(false);
    expect(takesTyping("BUTTON", null, false)).toBe(false);
  });

  it("into anything editable, whatever it is made of", () => {
    expect(takesTyping("DIV", null, true)).toBe(true);
    expect(takesTyping("SPAN", null, true)).toBe(true);
  });

  /** An `<input>` with no type is a text box — which is what the browser makes of it too. */
  it("into an input that never said what it was", () => {
    expect(input("")).toBe(true);
  });

  it("not into an input type it has never heard of", () => {
    expect(input("wysiwyg")).toBe(false);
  });
});
