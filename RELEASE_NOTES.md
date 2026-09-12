# Prevail v0.3.113

Talk to Prevail from your phone instead of typing, and reach your Mac from the same Wi-Fi or from anywhere with nothing installed on the phone.

## New

- **Hold to talk on the phone.** The phone chat has a mic under the composer. Hold it, talk, release: the recording goes to your Mac, is transcribed there, and the text lands in the composer for you to fix a word and tap Send. "Save as note" files it into the current domain instead (journal line plus a voice note in Notes). Slide away or tap X to cancel; a quick tap explains the gesture. Transcription runs on the Mac with whisper.cpp (`brew install whisper-cpp` plus a `ggml-*.bin` model in `~/.prevail/models`) or Apple's on-device speech through `hear` (`brew install hear`); `ffmpeg` converts the phone's recording format. Nothing is sent to a transcription service. The upload is capped at 10 MB, staged in a private temp folder, and deleted after transcription; the transcribe command only accepts files from that folder.
- **Same Wi-Fi, nothing to install.** With "Reachable from other devices" on, the bridge now listens on every interface, so a phone on the same Wi-Fi opens the Wi-Fi address straight away. Before, when Tailscale was installed on the Mac the bridge listened only on the Tailscale address, and a phone without Tailscale got connection refused. The pair card shows the Wi-Fi address in the QR and lists every way in: same Wi-Fi, Tailscale when both sides have it, and the internet.
- **Share over the internet.** One tap in Settings > Remote runs a Cloudflare quick tunnel (`brew install cloudflared`, no account, no router setup) and gives the phone a public https address; the QR switches to it. https is what lets the phone browser use its microphone, so this is the address for hold-to-talk. The address changes each time you share, the tunnel stops with "Stop sharing" or when the app quits, only that exact hostname passes the bridge's Host check, and a remote client cannot start a tunnel. For a home-screen app you use every day, add the Wi-Fi address; use the internet address when away or for voice.

## Notes

- The in-app updater feed is still not published (the signing key on the build machine does not match the key shipped in v0.3.x), so install this build from the DMG.
