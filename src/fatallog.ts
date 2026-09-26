// What the fatal-error log (outside the vault, in Application Support) may
// hold: the error class and its stack frames. Never the message: a crash
// message can quote a prompt, a model reply or vault text, and this file sits
// where the vault's protections do not reach. The on-screen error view is
// in-app and still shows the full message.
export function fatalLogText(kind: string, err: unknown): string {
  const name = err instanceof Error ? err.name || "Error" : typeof err;
  const frames: string[] = [];
  if (err instanceof Error && typeof err.stack === "string") {
    for (const line of err.stack.split("\n")) {
      const t = line.trim();
      // V8: "at fn (file:1:2)". WebKit/Gecko: "fn@file:1:2". Anything else is
      // (part of) the message and stays out.
      if (/^at\s\S/.test(t) || /^[\w$.<>/[\]]*@\S+:\d+:\d+$/.test(t)) frames.push(t);
      if (frames.length >= 12) break;
    }
  }
  return [`${new Date().toISOString()} ${kind}: ${name}`, ...frames].join("\n");
}
