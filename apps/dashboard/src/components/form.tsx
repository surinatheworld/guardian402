// A thrown value as the text to show the owner.
export const errorOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
