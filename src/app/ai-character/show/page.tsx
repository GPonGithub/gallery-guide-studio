import ShowOrb from './ShowOrb';

/**
 * The AI character alone, full screen on black, following the chatbot's voice from the Chatbot
 * Designer's tab (same browser). For a projector window. ?color=ff2a2a tints it (no # in the link).
 * TouchDesigner shows this page in its areas with ?td=ws://localhost:9980: the voice then comes
 * through its receiver (see ShowOrb).
 */
export default async function AiCharacterShow({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const hex = typeof params.color === 'string' ? params.color.replace(/^#/, '') : '';
  const color = /^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : null;
  const td = typeof params.td === 'string' && /^wss?:\/\//.test(params.td) ? params.td : null;
  return (
    <main className="h-screen w-screen overflow-hidden bg-black">
      <ShowOrb color={color} td={td} />
    </main>
  );
}
