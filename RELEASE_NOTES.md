# Prevail 0.3.121

Arena benchmarks now actually produce scores, and the Runtimes screen no
longer reports zero when your runtimes are installed and working.

## Arena scoring

A benchmark batch could finish, cost real tokens, and still leave every run
unscored, with no way to recover it. Five separate faults, all ending in the
same place:

- Bunker Mode disabled the judge on every scored batch. The app never names a
  judge explicitly, and the check here treated that as a reason to skip
  judging entirely, even with a local judge installed. The engine already
  enforces Bunker Mode properly on its own, so only an explicitly named cloud
  judge is blocked now.
- A run whose judge produced nothing still wrote a score file, and the "has a
  score file" check then skipped that run forever. Fifty two of fifty six runs
  in one vault were stuck exactly this way. Those are picked back up now
  whenever a judge is available.
- One failing run abandoned every run after it in the batch. Each run now
  stands alone, with a retry pass at the end and a named report for anything
  that still could not be scored.
- The judge got a single attempt, and any failure lost that question's score
  silently. It now retries with backoff and records why it gave up.
- The scoring pass ran once behind a flat ten minute watchdog, then marked
  every job done regardless of the outcome. The budget now scales with the
  size of the batch and the pass is retried.

A scoring pass also stops early when the judge runs out of quota, instead of
retrying thousands of times against a judge that will not answer and writing a
score file full of blanks.

## Runtimes

Runtime detection could report zero runtimes on a Mac that has them installed.
The version probe had no timeout, and although probes run in parallel the code
still waited on all of them, so a single CLI that hung on startup left the
Runtimes screen empty with nothing on screen to explain why. This also blocked
picking models and starting benchmarks from the phone.

Every probe now has a ten second deadline and reports a timeout as the reason
it is unusable. A probe that crashes outright now appears as a broken runtime
rather than vanishing from the list.

## Under the hood

The domain name guard held raw control bytes where escape sequences were
intended. The check behaved correctly, but it made a security relevant file
read as binary to search and review tools.
