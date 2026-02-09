const CHARS_PER_TOKEN_ESTIMATE = 4;

export function estimateTokens(text: string): number {
  const cleaned = text.trim();
  if (!cleaned) {
    return 0;
  }
  return Math.max(1, Math.ceil(cleaned.length / CHARS_PER_TOKEN_ESTIMATE));
}

export function usd(value: number): string {
  return `$${value.toFixed(6)}`;
}
