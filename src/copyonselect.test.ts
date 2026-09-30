import { describe, expect, test } from "vitest";
import { shouldCopy } from "./copyonselect";

describe("copy on select", () => {
  test("copies a selection in ordinary content", () => {
    document.body.innerHTML = `<div id="reply"><p id="p">Foo bar baz</p></div>`;
    expect(shouldCopy(document.getElementById("p")!.firstChild, "bar baz")).toBe(true);
  });
  test("leaves text boxes, editable areas and opted-out regions alone", () => {
    document.body.innerHTML = `<textarea id="t">foo</textarea><div contenteditable="true" id="c">foo</div><div data-no-copy-on-select><span id="s">foo</span></div>`;
    expect(shouldCopy(document.getElementById("t"), "foo bar")).toBe(false);
    expect(shouldCopy(document.getElementById("c")!.firstChild, "foo bar")).toBe(false);
    expect(shouldCopy(document.getElementById("s")!.firstChild, "foo bar")).toBe(false);
  });
  test("ignores empty or one-character selections", () => {
    document.body.innerHTML = `<p id="p">x</p>`;
    expect(shouldCopy(document.getElementById("p")!.firstChild, " ")).toBe(false);
    expect(shouldCopy(document.getElementById("p")!.firstChild, "x")).toBe(false);
  });
});
