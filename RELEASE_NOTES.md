# Prevail v0.3.114

Getting Prevail onto your phone is now one screen and one scan. No hunting through network settings, and no password to type on a phone keyboard.

## New

- **Phone is its own screen.** It sits in the sidebar under Connections, instead of hiding inside the WebUI server panel where nobody would think to look for it. If phone access is off, the screen is a single button that does the whole setup: it mints a password, switches on reachability, starts the bridge and shows the code. The technical knobs stay in Network.
- **Scan the code and you are in.** The QR now carries a one-time pairing code, so scanning signs the phone in and drops you straight into the app. Typing a generated password on a touch keyboard was the thing most likely to stop you from ever finishing setup.

## Fixed

- **Clicking an item in the Editor sidebar could land you on General.** The sidebar announced the section with an event the settings panel answers itself, so clicking an item before that panel finished loading meant nothing was listening, and you got the default page. The section is handed in directly now and survives the load. The Work sidebar already worked this way.

## About the pairing code

It is not your password. It is a random value that buys exactly one session and is destroyed the moment it is used, so a photographed QR code is worthless afterwards. It expires in ten minutes, it is cleared when you leave the screen or turn the bridge off, and a wrong guess is refused without invalidating the real code. It travels in the part of the address that browsers never send to a server, so it stays out of request logs and out of the Cloudflare tunnel. A phone that is already signed in cannot mint one for another device. If a code has expired, the phone falls back to the normal sign-in form and tells you where to find a fresh code.

## Notes

- The in-app updater feed is still not published, because the signing key on the build machine does not match the key shipped in v0.3.x. Install this build from the DMG.
