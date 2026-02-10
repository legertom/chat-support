import { describe, expect, it } from "vitest";
import { normalizeAssistantContentForDisplay, stripTrailingSourcesSection } from "@/lib/assistant-format";

describe("stripTrailingSourcesSection", () => {
  it("removes a trailing sources section with numbered links", () => {
    const input = [
      "You can download the file from Last Attempted Sync.",
      "",
      "1. Go to Dashboard.",
      "2. Select Download SIS File.",
      "",
      "Sources",
      "[1] https://support.clever.com/s/articles/203114867?language=en_US",
      "[5] https://support.clever.com/s/articles/000001499?language=en_US",
      "",
    ].join("\n");

    expect(stripTrailingSourcesSection(input)).toBe(
      ["You can download the file from Last Attempted Sync.", "", "1. Go to Dashboard.", "2. Select Download SIS File."].join(
        "\n"
      )
    );
  });

  it("keeps content unchanged when no valid trailing sources block exists", () => {
    const input = [
      "Use District Settings to configure exports.",
      "",
      "Sources",
      "[1] This line is not a URL source entry.",
    ].join("\n");

    expect(stripTrailingSourcesSection(input)).toBe(input);
  });
});

describe("normalizeAssistantContentForDisplay", () => {
  it("strips trailing source lists only when structured citations are present", () => {
    const input = [
      "A paragraph with references [1].",
      "",
      "Sources:",
      "1. https://support.clever.com/s/articles/203114867?language=en_US",
    ].join("\n");

    expect(normalizeAssistantContentForDisplay(input, true)).toBe("A paragraph with references [1].");
    expect(normalizeAssistantContentForDisplay(input, false)).toBe(input);
  });

  it("inserts spacing between adjacent citation markers", () => {
    const input = "This paragraph cites [1][6] and [3][4].";
    expect(normalizeAssistantContentForDisplay(input, true)).toBe("This paragraph cites [1] [6] and [3] [4].");
  });

  it("joins wrapped list continuation lines", () => {
    const input = [
      "1. Click the download icon for **Students** to have a download link",
      "   emailed to the email address on your Clever account.",
      "2. Open the email link.",
    ].join("\n");

    expect(normalizeAssistantContentForDisplay(input, true)).toBe(
      "1. Click the download icon for **Students** to have a download link emailed to the email address on your Clever account.\n2. Open the email link."
    );
  });
});
