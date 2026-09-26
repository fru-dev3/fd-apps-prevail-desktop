# Prevail 0.3.127

Prevail now remembers the people, places, companies and things you talk
about, and what you said about each of them.

## Entities

People, places, companies and products, and named things in a reply are now
chips you can click. A chip opens a side card with what your conversations
say about it, your own notes (edit them right there), every conversation
that mentioned it, newest first, and what it tends to come up with. Save it
to your vault, ask about it in a new chat that already carries the context,
or open a place on the map.

Companies show their logo when their site is known. A small green dot means
the vault already has a page for it.

## In your vault

Each entity can have a page under data/entities, beside your domains and
apps. A page appears when you save something, or on its own once it has
come up in three separate conversations. Your notes section is yours: the
app never rewrites it.

## Entities view

A new Entities item in the sidebar, and a tab in Intent, lists everything
by kind with how often it came up. Search by name or filter by kind.

Intent now tags each new session of prompts with the entities it mentions,
using a small, inexpensive model, once per session. Requires engine 1.9.27,
bundled with this release.
