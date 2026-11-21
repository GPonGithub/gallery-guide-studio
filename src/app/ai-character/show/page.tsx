import ShowOrb from './ShowOrb';
import { characterValue } from '@/lib/agent/characterLook';

/**
 * The AI character alone, full screen on black, following the chatbot's voice from the Chatbot
 * Designer's tab (same browser). For a projector window. ?color=ff2a2a tints it (no # in the link).
 * TouchDesigner shows this page in its areas with ?td=ws://localhost:9980: the voice then comes
 * through its receiver (see ShowOrb).
 *
 * ?look=phone shows it in the middle of a phone's screen. Around the phone the page is transparent (an
 * alpha channel) — except for TouchDesigner (?td=), whose areas show one item at a time: black there.
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
  const phone = params.look === 'phone';
  const clear = phone && !td;
  return (
    <main className={`h-screen w-screen overflow-hidden ${clear ? 'bg-transparent' : 'bg-black'}`}>
      {/* The page itself see-through too: no paper colour or texture behind the phone. */}
      {clear && <style>{'html,body{background:transparent!important}body::before{display:none!important}'}</style>}
      <ShowOrb value={characterValue(phone ? 'phone' : 'orb', color)} td={td} />
    </main>
  );
}
