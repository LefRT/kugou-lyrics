declare module 'kuromoji/build/kuromoji.js' {
  const kuromoji: {
    builder(options: { dicPath: string }): {
      build(callback: (error: Error | null, tokenizer: { tokenize(text: string): { surface_form: string; reading?: string }[] }) => void): void;
    };
  };
  export default kuromoji;
}
