# Prevail v0.3.117

Phones could connect one at a time, and then only until something held the line. This fixes the cause and adds the controls that were missing around it.

## Fixed

- **A connected phone wedged the bridge for everything else.** The web bridge handled one request at a time, and two of its responses are long-lived: the event stream never ends, and a proxied command waits on the desktop window. So the first phone to open a tab held the queue, and every request after it connected and then sat there receiving nothing. That is the blank page, and the reason a second phone or a reloaded tab never loaded. Requests are now handled concurrently, which is also what more than one phone requires.
- **No banner is shown twice.** With Bunker Mode on and no local model, two stacked messages said nearly the same thing, and the second one's advice was wrong: the model list is not the problem when Bunker is blocking the cloud ones.

## New

- **Connected phones, on the Phone screen.** Every signed-in device is listed with a name read from the browser, its address, how it got in, and when it was last active. Disconnect one, or all of them. A disconnected phone stops working on its very next tap.
- **More than one phone.** Each device now gets its own private token instead of sharing one, which is what makes disconnecting a single phone mean anything. Show a new code for each phone you want to add.
- **Turn off phone access.** One button stops the bridge and signs every device out with it.
- **Bunker Mode governs phone access.** Bunker Mode promises nothing leaves this Mac, and a phone on your network is another way off it. While Bunker is on, the bridge stays on this machine only and sharing over the internet is refused. The Phone screen says so plainly and links to Privacy, instead of offering a switch that quietly does nothing. This is enforced where the socket is bound, not by hiding a button.

## Notes

- Restarting the app signs every phone out, because the tokens live only as long as the run. Scan again to reconnect.
- The in-app updater feed is still not published, because the signing key on the build machine does not match the key shipped in v0.3.x. Install this build from the DMG.
