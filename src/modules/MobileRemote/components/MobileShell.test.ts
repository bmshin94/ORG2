import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MobileShell } from "./MobileShell";

describe("MobileShell", () => {
  it("owns the viewport so long transcripts scroll without displacing the composer", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        MobileShell,
        null,
        React.createElement("div", null, "chat")
      )
    );

    expect(markup).toContain("h-full justify-center overflow-hidden");
    expect(markup).toContain("pt-[env(safe-area-inset-top)]");
    expect(markup).toContain("pr-[env(safe-area-inset-right)]");
    expect(markup).toContain("pl-[env(safe-area-inset-left)]");
    expect(markup).toContain("h-full min-h-0");
  });

  it("keeps the fluid shell width with a reading cap, not a phone-model width", () => {
    const markup = renderToStaticMarkup(React.createElement(MobileShell));
    expect(markup).toContain("w-full");
    const styles = readFileSync(
      new URL("../mobileChrome.scss", import.meta.url),
      "utf8"
    );
    const viewport = styles.match(
      /\.mobile-shell__viewport\s*\{([^}]+)\}/
    )?.[1];
    expect(viewport).toContain("min-width: 0");
    expect(viewport).toContain("max-width: 48rem");
    expect(viewport).not.toContain("393px");
  });
});
