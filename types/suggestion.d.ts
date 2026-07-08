declare module "suggestion" {
  interface SuggestOptions {
    q?: string;
    gl?: string;
    hl?: string;
    levels?: number;
    client?: string;
  }

  function suggest(
    query: string,
    options: SuggestOptions,
    callback: (err: Error | null, suggestions: string[]) => void,
  ): void;

  export = suggest;
}
