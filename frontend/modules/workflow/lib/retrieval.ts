// Lexical retrieval for the audit RAG chat. No imports, so retrieval.check.mjs runs it under plain node.
// ponytail: TF-IDF over a few hundred short docs; swap for embeddings if the corpus grows past a demo shift.

export type Doc = { id: string; callId: string; nodeId: string; text: string };

const STOP = new Set("the a an and or of to in on at for with from by is are was were be been it its this that what which who whom how why when where did does do has have had any all case patient".split(" "));

export function tokenize(text: string): string[] {
  return text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 1 && !STOP.has(word));
}

/** Top-k docs for the question. Falls back to the focused case's docs when nothing matches ("what happened?"). */
export function retrieve(docs: Doc[], question: string, focusCallId?: string, k = 8): Doc[] {
  const terms = [...new Set(tokenize(question))];
  const tokenized = docs.map((doc) => tokenize(doc.text));
  const df = new Map<string, number>();
  for (const words of tokenized) for (const word of new Set(words)) df.set(word, (df.get(word) ?? 0) + 1);

  const scored = docs.map((doc, index) => {
    const words = tokenized[index];
    let score = 0;
    for (const term of terms) {
      const tf = words.filter((word) => word === term || (term.length > 3 && word.startsWith(term))).length;
      if (tf) score += (tf / (words.length + 1)) * Math.log(1 + docs.length / (df.get(term) ?? 1));
    }
    if (score > 0 && doc.callId === focusCallId) score *= 1.5;
    return { doc, score };
  });

  const hits = scored.filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).map((entry) => entry.doc);
  if (hits.length) return hits.slice(0, k);
  return docs.filter((doc) => doc.callId === focusCallId).slice(0, k);
}

/** Source ids cited in an answer, e.g. "[S2]" or "[S2, S5]". */
export function citedIds(answer: string): string[] {
  return [...new Set([...answer.matchAll(/S\d+/g)].map((match) => match[0]))];
}
