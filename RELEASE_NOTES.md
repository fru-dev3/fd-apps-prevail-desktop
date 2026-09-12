# Prevail v0.3.116

The phone shell now actually stays put, and the pairing card is a card instead of a wall of sentences.

## Fixed

- **The top of the app scrolled away on a phone, and there was a band of dead space at the bottom.** The previous release stopped the body from scrolling but left the document itself scrollable, which iOS Safari happily scrolled instead. So the header with the domain name went off the top, and with it the banner that explains when no model is available. The body is now pinned to the visible viewport, which is the one thing iOS honours without argument, and nothing above it can scroll.
- **The pairing card was a wall of text.** It repeated the same address twice, ran three instructions together as prose, and gave every sentence the same weight. It is now a header that says whether phone access is on, a large QR with numbered steps beside it, and a table of every way in where the one the QR points at is marked. Each way in shows either its address with a copy button or a plain reason it is unavailable.
- **The voice bar spent three lines explaining itself** when the microphone was unavailable. It says what to do in one line now.

## If the model says "no model"

That is Bunker Mode doing its job. Bunker Mode blocks cloud models, so with no local model installed there is nothing left to run. The banner explaining this was being scrolled off the top of the phone, which is fixed here. Either install a local model or turn Bunker Mode off in Privacy.

## Notes

- The in-app updater feed is still not published, because the signing key on the build machine does not match the key shipped in v0.3.x. Install this build from the DMG.
