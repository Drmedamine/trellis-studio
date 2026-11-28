/** Un texte traduit où <c>…</c> marque du code : la phrase reste entière dans le dictionnaire, quelle que soit la langue. */
export default function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/<c>(.*?)<\/c>/).map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}
    </>
  );
}
