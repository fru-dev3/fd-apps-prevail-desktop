// Benchmark harness over a synthetic LARGE vault (invented "foo" names only):
// 30 domains, about 17k files, 1200 skills, 3,500 captured prompt lines and
// 350 entities. It times the heavy read commands the pages call.
//
//   cargo test --release perf_bench -- --ignored --nocapture
//
// Ignored by default: it writes ~17k files and spawns the engine. The vault is
// built once under the temp dir and reused. Engine-backed rows use the bundled
// sidecar from src-tauri/binaries when present (linked next to the test binary,
// where resolve_prevail_bin looks first), else the dev fallback on PATH.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

const DOMAINS: usize = 30;
const SKILLS_PER_DOMAIN: usize = 40; // 1200
const NOTES_PER_DOMAIN: usize = 480; // bulk of the ~17k files
const THREADS_PER_DOMAIN: usize = 12;
const TASKS_PER_DOMAIN: usize = 60;
const PROMPTS: usize = 3500;
const ENTITIES: usize = 350;

fn w(p: &Path, body: &str) {
    if let Some(d) = p.parent() {
        fs::create_dir_all(d).unwrap();
    }
    fs::write(p, body).unwrap();
}

fn build_vault(root: &Path) {
    let done = root.join(".built");
    if done.exists() {
        return;
    }
    let _ = fs::remove_dir_all(root);
    let data = root.join("data");
    w(&root.join("build/_meta/.keep"), "");
    for d in 0..DOMAINS {
        let dom = data.join("domains").join(format!("foo-domain-{d:02}"));
        w(&dom.join(".prevail-layout-v4"), "");
        w(&dom.join("ideal-state.md"), "# Ideal\n\nFoo lives well.\n");
        w(&dom.join("memory/state.md"), "# State\n\nFoo is fine.\n");
        w(&dom.join("memory/journal.md"), "# Journal\n\n- foo did a thing\n");
        for s in 0..SKILLS_PER_DOMAIN {
            w(
                &dom.join(format!("memory/skills/foo-skill-{s:03}/SKILL.md")),
                &format!("---\nname: foo-skill-{s:03}\ndescription: Foo skill {s} for domain {d}\n---\n\n# Foo skill\n\nSteps.\n"),
            );
        }
        for n in 0..NOTES_PER_DOMAIN {
            w(&dom.join(format!("source/notes/{:02}/foo-note-{n:04}.md", n % 16)), "# Foo note\n\nbody\n");
        }
        for t in 0..THREADS_PER_DOMAIN {
            w(
                &dom.join(format!("memory/threads/foo-thread-{t:02}.md")),
                &format!("---\ntitle: foo thread {t}\nupdated: 2026-09-18T10:00:00Z\n---\n\n## You\n\nfoo question {t}\n\n## Assistant\n\nfoo answer\n"),
            );
        }
        let mut tasks = String::from("# Tasks\n\n");
        for t in 0..TASKS_PER_DOMAIN {
            let done = if t % 3 == 0 { "x" } else { " " };
            tasks.push_str(&format!("- [{done}] foo task {t} in domain {d} due:2026-10-{:02}\n", 1 + t % 28));
        }
        w(&dom.join("_tasks.md"), &tasks);
        let mut journal = String::new();
        for i in 0..100 {
            journal.push_str(&format!("{{\"kind\":\"intent\",\"message\":\"foo intent {i}\",\"ts\":{}}}\n", 1_780_000_000_000i64 + i));
        }
        w(&dom.join(".system/journal.jsonl"), &journal);
        let mut prompts = String::from("# Prompts\n\n");
        for i in 0..20 {
            prompts.push_str(&format!("- foo prompt {i}\n"));
        }
        w(&dom.join("PROMPTS.md"), &prompts);
    }
    let mut stream = String::new();
    for i in 0..PROMPTS {
        stream.push_str(&format!(
            "{{\"prompt\":\"foo captured prompt number {i} about the foo project\",\"tool\":\"foo-tool\",\"epoch_ms\":{},\"source\":\"sync\",\"host\":\"foo-host\"}}\n",
            1_780_000_000_000i64 + i as i64 * 1000
        ));
    }
    w(&root.join("build/_meta/prompts/foo-tool.foo-host.jsonl"), &stream);
    for e in 0..ENTITIES {
        let (dir, kind) = if e % 3 == 0 { ("products", "product") } else { ("people", "person") };
        w(
            &data.join(format!("entities/{dir}/foo-{e:03}/entity.md")),
            &format!("---\nname: Foo {e}\nkind: {kind}\naliases: []\nsaved: true\ncreated: x\nupdated: x\nmention_count: {e}\n---\n\n## Your notes\n\nfoo\n"),
        );
    }
    w(&done, "");
}

fn link_sidecar() {
    let Ok(exe) = std::env::current_exe() else { return };
    let Some(dir) = exe.parent() else { return };
    let target = dir.join("prevail");
    let sidecar = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/prevail-aarch64-apple-darwin");
    if !target.exists() && sidecar.exists() {
        let _ = std::os::unix::fs::symlink(&sidecar, &target);
    }
}

/// Median of `runs` timed calls, in ms; plus a short outcome tag.
fn time<T, E: std::fmt::Display>(runs: usize, mut f: impl FnMut() -> Result<T, E>) -> (f64, String) {
    let mut v = Vec::new();
    let mut tag = "ok".to_string();
    for _ in 0..runs {
        let t0 = Instant::now();
        let r = f();
        v.push(t0.elapsed().as_secs_f64() * 1000.0);
        if let Err(e) = r {
            tag = format!("err: {}", e.to_string().chars().take(60).collect::<String>());
        }
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    (v[v.len() / 2], tag)
}

#[test]
#[ignore]
fn perf_bench() {
    let root = std::env::temp_dir().join("prevail-perf-vault-foo");
    let t0 = Instant::now();
    build_vault(&root);
    let files = walkdir::WalkDir::new(&root).into_iter().flatten().filter(|e| e.file_type().is_file()).count();
    eprintln!("synthetic vault: {} ({files} files, ready in {:.1}s)", root.display(), t0.elapsed().as_secs_f64());
    link_sidecar();
    eprintln!("engine: {}", crate::engine::resolve_prevail_bin());

    let (ms, _) = time(5, || Ok::<_, String>(crate::engine::provider_env_pairs()));
    eprintln!("provider_env_pairs (per engine spawn): {ms:.1} ms");
    let v = root.to_string_lossy().to_string();
    let d = "foo-domain-07".to_string();
    let mut rows: Vec<(&str, (f64, String))> = Vec::new();
    // Native readers.
    rows.push(("scan_vault", time(5, || tauri::async_runtime::block_on(crate::vault::scan_vault(v.clone())))));
    rows.push(("scan_skills", time(5, || crate::domain::scan_skills(v.clone()))));
    rows.push(("domain_context", time(5, || crate::domain::domain_context(v.clone(), d.clone()))));
    rows.push(("domain_tree", time(5, || crate::domain::domain_tree(v.clone(), d.clone()))));
    rows.push(("read_domain_prompts", time(5, || crate::domain::read_domain_prompts(v.clone(), d.clone()))));
    rows.push(("capture_prompts_read", time(5, || crate::intents::capture_prompts_read(v.clone(), None))));
    rows.push(("intents_read", time(5, || crate::intents::intents_read(v.clone(), Some(d.clone()), Some(200)))));
    rows.push(("tasks_read", time(5, || crate::tasks::tasks_read(v.clone(), d.clone()))));
    rows.push(("tasks_read_all", time(5, || tauri::async_runtime::block_on(crate::tasks::tasks_read_all(v.clone(), None)))));
    rows.push(("work_count", time(5, || crate::tasks::work_count(v.clone(), "2026-10-05".into(), None))));
    rows.push(("list_threads", time(5, || crate::threads::list_threads(v.clone(), Some(d.clone())))));
    rows.push(("reminders_due_today", time(5, || crate::reminders::reminders_due_today(v.clone()))));
    rows.push(("goals_files_read", time(5, || crate::goals::goals_files_read(v.clone()))));
    // Engine-backed (one subprocess each).
    rows.push(("engine_domains", time(3, || crate::engine::engine_domains(v.clone()))));
    rows.push(("engine_score_all", time(3, || crate::engine::engine_score_all(v.clone()))));
    rows.push(("usage_entries", time(3, || crate::usage::usage_entries(v.clone()))));
    rows.push(("usage_summary", time(3, || crate::usage::usage_summary(v.clone()))));
    rows.push(("engine_recommendations", time(3, || crate::engine::engine_recommendations(v.clone()))));
    rows.push(("engine_apps_list", time(3, || crate::engine::engine_apps_list(Some(v.clone())))));
    rows.push(("entities_list", time(3, || tauri::async_runtime::block_on(crate::entities_bridge::entities_list(v.clone(), None, None, None, None)))));
    rows.push(("engine_acts_pending", time(3, || tauri::async_runtime::block_on(crate::engine::engine_acts_pending(v.clone())))));

    eprintln!("\n| command | median ms | result |\n|---|---:|---|");
    for (name, (ms, tag)) in &rows {
        eprintln!("| {name} | {ms:.1} | {tag} |");
    }
}
