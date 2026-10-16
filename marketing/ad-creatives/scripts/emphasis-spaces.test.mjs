import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Emphasis } from "../src/components/Emphasis.tsx";

const textOf = (html) => html.replace(/<[^>]+>/g, "");

test("highlighted phrases stay inside one element so flex layout cannot trim the spaces", () => {
  const samples = [
    ["Skip this one.", ["Skip"], "Skip this one."],
    ["0.07 float: $99.59 vs $64.10", ["$99.59", "$64.10"], "0.07 float: $99.59 vs $64.10"],
    ["A green estimate is not a promise.", ["not a promise"], "A green estimate is not a promise."],
    ["Verify is part of Pro.", ["Pro"], "Verify is part of Pro."],
  ];
  for (const [text, emphasis, expected] of samples) {
    const html = renderToStaticMarkup(React.createElement(Emphasis, { text, emphasis }));
    assert.equal(html.startsWith("<span"), true, html);
    assert.equal((html.match(/<span/g) || []).length > 0, true);
    assert.equal(textOf(html), expected);
    assert.equal(html.includes(expected) || textOf(html) === expected, true);
    assert.doesNotMatch(textOf(html), /[a-zA-Z0-9.][A-Z$]/);
  }
});
