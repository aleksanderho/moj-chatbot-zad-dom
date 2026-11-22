// Każdy akapit jest osobny. Nie rozcinaj zdań, nawet jeśli jedno przekracza 800 znaków.
export function splitDocument(text: string): string[] {
  const paragraphs = text.replace(/\r\n?/g, "\n").trim().split(/\n[\t ]*\n+/).map(p => p.trim()).filter(Boolean);
  const segmenter = new Intl.Segmenter("pl", { granularity: "sentence" });
  return paragraphs.flatMap(paragraph => {
    if (paragraph.length <= 800) return [paragraph];
    const chunks: string[] = [];
    let current = "";
    for (const { segment } of segmenter.segment(paragraph)) {
      if (current && (current + segment).trim().length > 800) {
        chunks.push(current.trim());
        current = "";
      }
      current += segment;
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  });
}
