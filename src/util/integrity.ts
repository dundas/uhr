const HASH_PREFIX = "sha256-";
const TRUNCATED_LENGTH = 12;

export async function computeIntegrity(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, TRUNCATED_LENGTH);

  return `${HASH_PREFIX}${hex}`;
}
