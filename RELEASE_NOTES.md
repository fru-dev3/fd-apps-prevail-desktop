# Prevail v0.3.115

The phone stops behaving like a web page in a costume. It never asks you to pick a vault, and every screen fits the screen.

## Fixed

- **The phone asked you to pick a vault.** It should never have. The vault lives on your Mac and the phone is a window onto it, so there is nothing on a phone worth choosing. The browser client now waits for the Mac to name its vault and shows "Connecting to your Mac" while it does. If the Mac genuinely has no vault yet, it says that and offers to retry, instead of opening a folder picker on a device with no folders you would want.
- **The whole app scrolled under your thumb.** The shell was sized with a percentage height, which on mobile Safari resolves against the taller viewport measured with the address bar hidden. The document was therefore always taller than what you could see. It is pinned to the visible viewport now, the page itself cannot scroll, and the rubber-band bounce at the edges is gone. Scrolling still happens where it should, inside the surface you are reading.
- **The composer took nearly half a short phone.** Framework, Lens, Modes, Plan and the Council pill are desk work, and the phone already has a Chat and Council switch in its header. The phone composer is now what a conversation needs: attach, model, Send. All of it is unchanged on the desktop, and settings made there still apply.
- **The greeting was cut off at the top on a small phone,** and could not be scrolled back to, because centred flex content that overflows becomes unreachable at both ends. It now falls back to aligning from the top when it does not fit, and the greeting itself is scaled for a phone. The model name was also printed three times on one screen; it appears once in the header and once in the composer.

Verified on a 360 by 640 phone, the smallest in common use: Chat, Domains, Needs you and Settings each fit with nothing cut off and no page scrolling, and there is a test that fails if that stops being true.

## Notes

- The in-app updater feed is still not published, because the signing key on the build machine does not match the key shipped in v0.3.x. Install this build from the DMG.
