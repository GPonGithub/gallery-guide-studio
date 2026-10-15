// Prints how long the caller waited for each reply to the app server's log
// (where `npm run dev` is running): the wait measured in the browser, plus
// the server's own steps. Development aid only — nothing is stored.
export async function POST(req: Request) {
  const { wait, server, early } = (await req.json()) as { wait?: string; server?: string[]; early?: boolean };
  console.log(`[wait] ${wait ?? '?'}${early ? ' (started during the pause)' : ''}\n       server: ${(server ?? []).join(' · ')}`);
  return new Response(null, { status: 204 });
}
