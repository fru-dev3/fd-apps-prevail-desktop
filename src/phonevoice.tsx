// Phone voice bar: hold the mic, talk, let the Mac transcribe. Sits directly
// under the chat composer in the phone shell. Release drops the transcript
// into the composer text (the user fixes a word, taps Send); "Save as note"
// files it into the current domain instead. Recording is MediaRecorder in the
// phone browser (audio/mp4 on iOS Safari, audio/webm elsewhere); the bytes go
// to the Mac over the WebUI bridge and transcription runs there, never on a
// third-party service (see src-tauri/src/voice.rs).
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Mic, NotebookPen, X } from "lucide-react";
import { invoke, isBrowser, uploadAudio } from "./bridge";

type Phase = "idle" | "recording" | "transcribing" | "done" | "error";

// Sliding the finger this far off the mic while holding cancels the take,
// the same gesture voice messages use in messaging apps.
const CANCEL_SLIDE_PX = 70;
// Hard stop so a pocket press cannot record forever and blow the upload cap.
const MAX_SECONDS = 120;
// A press shorter than this is a tap, not a hold: nothing to transcribe.
const MIN_HOLD_MS = 350;

export interface Transcript { text: string; backend?: string }

function mmss(s: number): string { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }

function voiceSupport(): { ok: boolean; hint: string } {
  if (typeof navigator === "undefined" || typeof window === "undefined") return { ok: false, hint: "" };
  const secure = window.isSecureContext !== false;
  const gum = !!navigator.mediaDevices?.getUserMedia;
  const rec = typeof MediaRecorder !== "undefined";
  if (gum && rec) return { ok: true, hint: "" };
  // Browsers hide the microphone entirely on a plain http:// page that is not
  // localhost, which is exactly how a phone reaches the bridge over the LAN.
  // The fix is the https address from Settings > Remote > Share over the
  // internet on the Mac; until then the keyboard's own mic still types.
  if (!secure) return { ok: false, hint: "Needs the https address. Share it from Phone settings on your Mac." };
  return { ok: false, hint: "No microphone here. Use the keyboard mic." };
}

// Put text into the composer's textarea the way a keystroke would, so the
// controlled React input (in chatpanel.tsx, untouched) picks it up: the
// prototype setter bypasses React's value tracker, the input event notifies it.
export function setComposerText(root: HTMLElement | null, text: string): boolean {
  const scope: ParentNode = root ?? document;
  const ta = scope.querySelector<HTMLTextAreaElement>("[data-tour=composer] textarea");
  if (!ta) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (setter) setter.call(ta, text); else ta.value = text;
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  ta.focus();
  try { ta.setSelectionRange(text.length, text.length); } catch { /* not focusable yet */ }
  return true;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  // Chunked so a two-minute take does not build one giant argument list.
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Where the transcription runs is the Mac either way; only the transport
// differs: a browser uploads the bytes, the Tauri window passes base64.
async function transcribe(blob: Blob): Promise<Transcript> {
  const ext = ((blob.type.split("/")[1] || "webm").split(";")[0] || "webm").replace("x-m4a", "m4a");
  if (isBrowser()) {
    const path = await uploadAudio(blob);
    return invoke<Transcript>("transcribe_audio", { path });
  }
  return invoke<Transcript>("transcribe_audio", { base64: await blobToBase64(blob), ext });
}

export function PhoneVoiceBar({ vaultPath, domain }: {
  vaultPath: string;
  // Current domain ("" or null for General): where "Save as note" files it.
  domain: string | null;
}) {
  const [support] = useState(voiceSupport);
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const startRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const pointerIdRef = useRef<number | null>(null);

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch { /* already stopped */ } });
    streamRef.current = null;
  };

  // Elapsed counter + the hard stop while recording.
  useEffect(() => {
    if (phase !== "recording") return;
    setSeconds(0);
    const id = window.setInterval(() => setSeconds((s) => {
      if (s + 1 >= MAX_SECONDS) { try { recRef.current?.stop(); } catch { /* ignore */ } }
      return s + 1;
    }), 1000);
    return () => window.clearInterval(id);
  }, [phase]);
  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* ignore */ } releaseStream(); }, []);

  const finish = useCallback(async (blob: Blob) => {
    if (blob.size === 0) { setPhase("idle"); return; }
    setPhase("transcribing");
    try {
      const out = await transcribe(blob);
      const text = (out?.text ?? "").trim();
      if (!text) { setError("Nothing heard. Hold the mic and speak closer to the phone."); setPhase("error"); return; }
      setTranscript(text);
      setComposerText(null, text);
      setPhase("done");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setPhase("error");
    }
  }, []);

  const start = useCallback(async () => {
    setError(null); setSaved(false); setTranscript("");
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { setError("Microphone access is off for this site. Allow it, or use the keyboard mic."); setPhase("error"); return; }
    // iOS Safari only records audio/mp4; Chrome and Firefox prefer webm/ogg.
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) || "";
    let mr: MediaRecorder;
    try { mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
    catch { stream.getTracks().forEach((t) => t.stop()); setError("Could not start the recorder. Use the keyboard mic."); setPhase("error"); return; }
    // The finger may already be up by the time the permission prompt resolved.
    if (!startRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
    chunksRef.current = [];
    cancelledRef.current = false;
    mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onstop = () => {
      releaseStream();
      recRef.current = null;
      if (cancelledRef.current) { setPhase("idle"); return; }
      void finish(new Blob(chunksRef.current, { type: mr.mimeType || mime || "audio/webm" }));
    };
    streamRef.current = stream;
    recRef.current = mr;
    try { mr.start(); setPhase("recording"); }
    catch { releaseStream(); recRef.current = null; setError("Could not start the recorder. Use the keyboard mic."); setPhase("error"); }
  }, [finish]);

  const stop = useCallback((cancel: boolean) => {
    startRef.current = null;
    pointerIdRef.current = null;
    cancelledRef.current = cancel;
    const mr = recRef.current;
    if (mr && mr.state !== "inactive") { try { mr.stop(); } catch { setPhase("idle"); } }
    else if (cancel) setPhase("idle");
  }, []);

  const onDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // A dead button teaches nothing. When the browser will not give us a
    // microphone (a plain http address is the usual reason), say so on tap.
    if (!support.ok) { e.preventDefault(); setError(support.hint); setPhase("error"); return; }
    if (phase === "recording" || phase === "transcribing") return;
    e.preventDefault();
    startRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    pointerIdRef.current = e.pointerId;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* touch already captures */ }
    void start();
  };
  const onMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const s = startRef.current;
    if (!s || phase !== "recording") return;
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > CANCEL_SLIDE_PX) stop(true);
  };
  const onUp = () => {
    const s = startRef.current;
    if (!s) return;
    // A quick tap: teach the gesture instead of transcribing silence.
    if (Date.now() - s.t < MIN_HOLD_MS && phase !== "recording") { startRef.current = null; setError("Hold the mic while you talk, release to transcribe."); setPhase("error"); return; }
    stop(Date.now() - s.t < MIN_HOLD_MS);
  };

  const saveNote = async () => {
    if (!transcript.trim()) return;
    setSaving(true); setError(null);
    try {
      await invoke("voice_note_capture", { vault: vaultPath, domain: domain || null, text: transcript });
      setSaved(true);
      // The composer keeps the text only while it is the pending message;
      // once filed as a note, clear it so it is not also sent by accident.
      setComposerText(null, "");
      window.dispatchEvent(new CustomEvent("prevail:notes-changed"));
      window.setTimeout(() => { setSaved(false); setPhase("idle"); setTranscript(""); }, 1400);
    } catch (e) {
      setError(`Could not save the note: ${String(e instanceof Error ? e.message : e)}`);
    } finally { setSaving(false); }
  };

  const dismiss = () => { setPhase("idle"); setError(null); setTranscript(""); setSaved(false); };

  const recording = phase === "recording";
  const busy = phase === "transcribing";
  const domainLabel = domain ? domain : "General";
  // The panel exists only while there is something to say.
  const panel = recording || busy || phase === "done" || phase === "error";

  // A phone has no room for a permanent strip that is idle most of the time.
  // The mic is ONE round button that lives in the composer row next to Send;
  // everything it has to say appears in a panel floating above the composer
  // only while it is saying it, then gets out of the way.
  return (
    <div data-testid="phone-voice" className="relative flex items-center">
      {panel && (
        <div className="absolute bottom-full right-0 z-30 mb-2 w-[min(78vw,320px)] rounded-xl border border-border bg-surface px-3 py-2 shadow-xl">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 leading-tight">
              {recording ? (
                <>
                  <div className="font-mono text-[20px] font-semibold tabular-nums text-accent" data-testid="phone-voice-timer">{mmss(seconds)}</div>
                  <div className="text-[12px] text-text-muted">Release to transcribe. Slide away to cancel.</div>
                </>
              ) : busy ? (
                <div className="text-[14px] font-medium text-text-secondary" data-testid="phone-voice-status">Transcribing on your Mac...</div>
              ) : phase === "done" ? (
                // The transcript is already visible in the composer below, so
                // repeating it here would only cover the thing being described.
                <div className="truncate text-[13px] font-medium text-text-primary" data-testid="phone-voice-status">
                  {saved ? "Saved to notes" : "In the composer. Fix a word, then send."}
                  <span className="hidden" data-testid="phone-voice-transcript">{transcript}</span>
                </div>
              ) : (
                <div className="line-clamp-2 text-[13px] text-err" data-testid="phone-voice-status">{error}</div>
              )}
            </div>
            {phase === "done" && !saved && (
              <button type="button" onClick={() => void saveNote()} disabled={saving}
                aria-label="Save as note"
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] font-semibold text-text-secondary active:bg-surface-warm disabled:opacity-50"
                title={`Save as a voice note in ${domainLabel}`}>
                <NotebookPen className="h-4 w-4" /> {saving ? "Saving" : "Note"}
              </button>
            )}
            {phase === "done" && saved && (
              <span className="inline-flex h-9 shrink-0 items-center gap-1 text-[12px] font-semibold text-ok"><Check className="h-4 w-4" /> Saved</span>
            )}
            {(phase === "error" || recording) && (
              <button type="button" onClick={() => (recording ? stop(true) : dismiss())} aria-label={recording ? "Cancel recording" : "Dismiss"}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-secondary active:bg-surface-warm">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        aria-label={recording ? "Recording, release to transcribe" : "Hold to talk"}
        aria-pressed={recording}
        disabled={busy}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => stop(true)}
        onContextMenu={(e) => e.preventDefault()}
        className={`relative flex h-11 w-11 shrink-0 select-none items-center justify-center rounded-full transition-colors disabled:opacity-40 ${recording ? "bg-accent text-on-accent" : "bg-accent-soft text-accent ring-1 ring-inset ring-accent-border"}`}
        style={{ touchAction: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" } as React.CSSProperties}
      >
        {recording && <span aria-hidden className="pulse-soft absolute -inset-1.5 rounded-full ring-[3px] ring-accent/60" />}
        <Mic className="h-5 w-5" />
      </button>
    </div>
  );
}
