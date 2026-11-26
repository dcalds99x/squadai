import { generateAvatar } from "@squadai/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Avatar, AvatarStack } from "../src/index.ts";

describe("Avatar", () => {
  it("names the person and their presence for screen readers", () => {
    const html = renderToStaticMarkup(
      <Avatar
        spec={generateAvatar("Téo")}
        name="Téo"
        presence="working"
        presenceLabel="trabalhando"
      />,
    );
    expect(html).toContain('aria-label="Téo, trabalhando"');
    expect(html).toContain('role="img"');
  });

  it("can be decorative when the name is already visible", () => {
    const html = renderToStaticMarkup(
      <Avatar spec={generateAvatar("Lia")} name="Lia" decorative />,
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("aria-label");
  });

  it("stacks a team", () => {
    const people = ["Lia", "Téo", "Bia"].map((name) => ({ name, spec: generateAvatar(name) }));
    const html = renderToStaticMarkup(<AvatarStack people={people} />);
    expect(html.match(/role="img"/g)).toHaveLength(3);
  });
});
