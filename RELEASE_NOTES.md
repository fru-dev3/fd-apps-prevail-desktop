# Prevail v0.3.118

A real pass over the phone layout, driven by what a phone screen actually has room for.

## Fixed

- **The microphone was in the wrong place and did nothing when tapped.** It had a permanent strip of its own below the composer, which is the one part of the screen that should be conversation, and it was disabled whenever the browser would not grant a microphone, so tapping it was silent. It is now a round button inside the composer next to Send, and tapping it when voice is unavailable says why instead of ignoring you. What it has to say appears above the composer only while it is saying it.
- **The model was named twice, in two different ways.** The header said one half and the composer said the other, which reads as a bug because it is one. There is one control now, in the composer, where you can actually tap it to change.
- **Every assistant reply printed NONE twice.** "None" is the id of the no-framework and no-lens options, so those two badges only ever announced that nothing had been applied. They appear when something actually was, and never on a phone, where that row has no width to spare. The date is the clock alone on a phone rather than "Sep 12 at 7:35 AM", which wrapped to three lines.
- **The bottom of the screen was all fixed furniture.** The trust ribbon is desktop-only now: three tiny monospace labels is a poor use of a phone, and each is reachable in Settings.

## New

- **The bottom navigation collapses, and starts collapsed.** It is a slim handle naming where you are, with an up arrow. Tapping it raises the full bar, and choosing a destination puts it away again. That returns about 60 pixels to the conversation, permanently.
- **Connected phones show a live green pulse.** A device we have heard from in the last two minutes is green and says Connected; one that has gone quiet is grey and says when it was last seen. The heading counts how many are live.

## Measured, not guessed

Every phone screen is checked at both 390 by 844 and 360 by 640, the smallest in common use: the page must not scroll in either direction, the composer must stay one row, the microphone must sit inside the composer at no less than 44 pixels, and exactly one model control may be on screen. A test fails if any of that stops being true, and the assistant reply header has its own tests.

## Notes

- The in-app updater feed is still not published, because the signing key on the build machine does not match the key shipped in v0.3.x. Install this build from the DMG.
