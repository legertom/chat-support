const SOURCES_HEADING_PATTERN = /^sources\s*:?\s*$/i;
const SOURCES_LINE_PATTERNS = [
  /^\[\d+\]\s+https?:\/\/\S+$/i,
  /^\d+\.\s+https?:\/\/\S+$/i,
  /^-\s*\[\d+\]\s+https?:\/\/\S+$/i,
  /^-\s+https?:\/\/\S+$/i,
];

function isSourceLine(line: string): boolean {
  return SOURCES_LINE_PATTERNS.some((pattern) => pattern.test(line));
}

export function stripTrailingSourcesSection(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  let endIndex = lines.length;
  while (endIndex > 0 && (lines[endIndex - 1] ?? "").trim().length === 0) {
    endIndex -= 1;
  }

  if (endIndex === 0) {
    return normalized.trimEnd();
  }

  let headingIndex = -1;
  for (let index = endIndex - 1; index >= 0; index -= 1) {
    const trimmedLine = (lines[index] ?? "").trim();
    if (trimmedLine.length === 0) {
      continue;
    }
    if (SOURCES_HEADING_PATTERN.test(trimmedLine)) {
      headingIndex = index;
      break;
    }
    if (!isSourceLine(trimmedLine)) {
      return normalized;
    }
  }

  if (headingIndex === -1) {
    return normalized;
  }

  const sourceLines = lines
    .slice(headingIndex + 1, endIndex)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (sourceLines.length === 0 || !sourceLines.every((line) => isSourceLine(line))) {
    return normalized;
  }

  return lines
    .slice(0, headingIndex)
    .join("\n")
    .replace(/\s+$/g, "");
}

export function normalizeAssistantContentForDisplay(content: string, hasStructuredCitations: boolean): string {
  const withoutTrailingSources = hasStructuredCitations ? stripTrailingSourcesSection(content) : content;
  const normalizedCitationSpacing = normalizeAdjacentCitationSpacing(withoutTrailingSources);
  return normalizeWrappedListContinuationLines(normalizedCitationSpacing);
}

function normalizeAdjacentCitationSpacing(content: string): string {
  return content.replace(/\[(\d+)\](?=\[(\d+)\])/g, "[$1] ");
}

function normalizeWrappedListContinuationLines(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const normalized: string[] = [];
  let inCodeFence = false;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith("```")) {
      inCodeFence = !inCodeFence;
      normalized.push(line);
      continue;
    }

    if (
      !inCodeFence &&
      normalized.length > 0 &&
      /^\s{2,}\S/.test(line) &&
      !startsNestedMarkdownBlock(trimmedLine) &&
      /^\s*(?:[-*]|\d+\.)\s+/.test(normalized[normalized.length - 1] ?? "")
    ) {
      const previous = normalized[normalized.length - 1] ?? "";
      normalized[normalized.length - 1] = `${previous.replace(/\s+$/g, "")} ${trimmedLine}`;
      continue;
    }

    normalized.push(line);
  }

  return normalized.join("\n");
}

function startsNestedMarkdownBlock(trimmedLine: string): boolean {
  return (
    /^(?:[-*]|\d+\.)\s+/.test(trimmedLine) ||
    /^>/.test(trimmedLine) ||
    /^\|/.test(trimmedLine) ||
    /^```/.test(trimmedLine)
  );
}
