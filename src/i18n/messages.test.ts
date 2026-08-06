import { describe, it, expect } from "vitest";
import en from "../../messages/en.json";
import th from "../../messages/th.json";

function flattenKeys(obj: any, prefix = ""): string[] {
  return Object.keys(obj).reduce((acc: string[], key: string) => {
    const pre = prefix.length ? `${prefix}.` : "";
    if (typeof obj[key] === "object" && obj[key] !== null) {
      acc.push(...flattenKeys(obj[key], pre + key));
    } else {
      acc.push(pre + key);
    }
    return acc;
  }, []);
}

describe("i18n messages", () => {
  it("keeps English and Thai message keys identical", () => {
    expect(flattenKeys(th)).toEqual(flattenKeys(en));
  });
});
