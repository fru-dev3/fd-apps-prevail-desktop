# Prevail 0.4.1

A clarity release. Every Home and Settings page now shares one layout: one
header, the list on the left, the item you pick on the right. Counts and
Refresh sit at the top of the list instead of in a band of their own, and
section headers stay in view as you scroll.

Councils. Keep several named councils, each with its own models and chair.
Build one by picking models, checking what a question will cost, and naming
it. One council is the Default, and the chat's Council tab has a picker to
convene any of them. Your existing panel and chair became "Default council".

Arena. Run a benchmark in three steps: models (a preset or your own pick),
domains, then Run, with an estimate of time and cost first. A preset can run
on every domain in one click. Presets and past results sit in the column.
Model Scout and scheduled presets no longer run.

Models. Tabs with a line on what each one is for, one search across runtimes
and models, status in plain words, and an Auto routing section. Health checks
no longer fail for "auto", and errors read as a sentence.

Entities. Tabs for Overview, Chat, Notes, Conversations and Files. Chat opens
at once and fits the pane. Possible duplicates are listed for you to merge or
keep apart, and nothing is lost in a merge. Entities can have a picture, a
company its logo, and each keeps its own files.

Apps you can chat with. Pick an app and it opens on a Chat tab, the same
chat as a domain or an entity, with past conversations one click away. Its
Activity tab lists every call a conversation made to it: when, which tool,
read or write, what happened, and a short summary with anything sensitive
left out. Tools and Connection sit beside them. Type @ in any chat to bring in
an app, a person or thing, or another domain; the + menu and dragging an app
from the sidebar do the same. A reply that used an app opens with a chip like
"Used Gmail · 3 reads" that leads to that activity, and an app that needs
sign-in says so in the reply. Domain context and each entity show the apps
their conversations used. Sites, command-line tools and Obsidian import have
their own rows under the apps, and the sidebar's Apps toggle sits on the right.

Trusted sources. Add your own data sites as sources the agent reads: an MCP
address, a site with llms.txt or openapi.json, or a list of links. Prevail
checks each one and shows what it found. Context (fru.dev) is one click. A
source works like any app, and each Mac decides for itself what it trusts.

Intent. One header with Noticed, History, Projects and Entities under it, and
a quiet capture status. A project opens on tabs for Overview, Requirements
(from you or inferred), your prompts exactly as typed, and a timeline.

Toolkit shows each skill's properties and clean text, with Chat with it and
Edit in place. What runs without asking now lives under Autonomy. The Vault
page no longer has the Rebuild structure and hygiene tools. A domain's For
you card no longer fails on replies it could not read.

Faster. Clicking around no longer freezes the window: every command that
reads your vault or asks the engine now runs off the main thread. A page you
have opened before shows its last contents at once and refreshes behind
them, long lists (skills, entities, tasks, threads, activity, prompt history)
draw only the rows on screen, pages load ahead when you hover the sidebar,
and each engine call starts about a third faster. The Models page no longer
shows "undefined in PATH".

Engine 1.10.2.
