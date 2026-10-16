# Hosting Chatbot Designer on Vercel

The hosted copy is for students: they open a link instead of installing
anything. It runs the same app, with a few differences (below).

## Deploy (once)

1. Go to vercel.com → **Add New… → Project**, and import the GitHub
   repository `GPonGithub/gallery-guide-studio`.
2. Under the project's **Settings → Git**, set the production branch to
   `v5-hosted` (or merge it into `main` first).
3. Don't add any API keys as environment variables: a hosted copy never
   uses them. Each student types in their own (Keys, top right).
4. **For FigJam:** in the project, open **Storage** (or the Vercel
   Marketplace), add **Upstash Redis** (the free plan is plenty), and
   connect it to the project. That sets `UPSTASH_REDIS_REST_URL` /
   `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` / `KV_REST_API_TOKEN`)
   for you. Then redeploy.
5. Share the production address (e.g. `https://….vercel.app`). Preview
   addresses ask for a Vercel login; the production one doesn't.

## What's different on the hosted copy

| | On your computer | Hosted |
|---|---|---|
| API keys | from `.env.local` or typed in | each student's own, typed in, kept in their browser |
| Scenes, patients, saved information, music | this browser | each student's browser — tell them to **export their Scenes** now and then (clearing browser data loses them) |
| `/` | the older playbook studio | goes straight to Chatbot Designer |
| FigJam plugin | imported from `figjam-plugin/manifest.json`; talks to `localhost:3000` | downloaded from section 6 (**Download the FigJam plugin**), already pointed at the hosted address; the student types in the **connection code** shown there, so a class's drawings never cross |
| TouchDesigner cues | sent to the address on the Master card | shown in the app only — a hosted server can't reach TouchDesigner on a student's computer (and on a public site it mustn't send requests to any address typed in) |
| Editing the FigJam board list | yes (saved into the project) | no — the list comes from the project; change it locally, commit, push |
| Google Sheets (import, row 7 saving) | yes | yes |

## For students

- Use **Chrome** (or Edge): the open mic's speech recognition isn't
  reliable in Safari or Firefox.
- Use made-up patients only — the sheet is shared by link.
- The **Onboard Me** button walks through the whole setup.
