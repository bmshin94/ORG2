//! Launch an installed vendor bundle into the exact managed profile. Dispatch
//! success is not a claim that the app has rendered or made a billable request.
use agent_cli::managed_config::native_app::NativeAppProfile;
use std::{
    path::{Path, PathBuf},
    process::Command,
};

fn bundle_id(agent: &str) -> Result<&'static str, String> {
    match agent {
        "codex" => Ok("com.openai.codex"),
        "claude_desktop" => Ok("com.anthropic.claudefordesktop"),
        _ => Err("Unsupported official App".into()),
    }
}
// Desktop versions are independent of the Codex CLI version axis. Isolation
// uses vendor implementation flags verified against this installed release;
// unknown releases require a new source/runtime capability audit.
const CODEX_ISOLATION_RELEASE: &str = "26.908.70816";
fn validate_bundle(agent: &str, path: &Path) -> Result<(), String> {
    let value = plist::Value::from_file(path.join("Contents/Info.plist"))
        .map_err(|_| "Cannot read the selected official App version")?;
    let info = value
        .as_dictionary()
        .ok_or("Invalid official App metadata")?;
    if info
        .get("CFBundleIdentifier")
        .and_then(plist::Value::as_string)
        != Some(bundle_id(agent)?)
    {
        return Err("Official App bundle identity changed".into());
    }
    let version = info
        .get("CFBundleShortVersionString")
        .and_then(plist::Value::as_string)
        .ok_or("Cannot read the selected official App version")?;
    if agent == "claude_desktop" {
        return crate::harness_connections::verify_claude_desktop_bundle_version(version);
    }
    if version != CODEX_ISOLATION_RELEASE {
        return Err(format!("Codex Desktop {version} has not been verified for isolated Market profiles; supported desktop release: {CODEX_ISOLATION_RELEASE}"));
    }
    Ok(())
}
fn installed_bundle_in(agent: &str, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let expected = bundle_id(agent)?;
    for root in roots {
        let Ok(entries) = std::fs::read_dir(root) else {
            continue;
        };
        let mut candidates = entries
            .take(512)
            .flatten()
            .map(|entry| entry.path())
            .collect::<Vec<_>>();
        candidates.sort();
        for path in candidates {
            if path.extension().is_none_or(|ext| ext != "app") {
                continue;
            }
            let Ok(info) = plist::Value::from_file(path.join("Contents/Info.plist")) else {
                continue;
            };
            if info
                .as_dictionary()
                .and_then(|value| value.get("CFBundleIdentifier"))
                .and_then(plist::Value::as_string)
                == Some(expected)
            {
                let resolved = path
                    .canonicalize()
                    .map_err(|_| "Cannot resolve the installed official App")?;
                validate_bundle(agent, &resolved)?;
                return Ok(resolved);
            }
        }
    }
    Err("Install the official desktop App before opening this connection".into())
}
fn installed_bundle(agent: &str) -> Result<PathBuf, String> {
    installed_bundle_in(
        agent,
        &[
            app_paths::home_dir().join("Applications"),
            PathBuf::from("/Applications"),
        ],
    )
}
/// Market official Apps use their own bundle version; the terminal flow retains
/// its separate CLI requirements. Catalog metadata probing is independent.
pub(super) async fn verify_installed(agent: &str) -> Result<(), String> {
    if agent == "claude_code" {
        return crate::harness_connections::verify_installed_version(agent).await;
    }
    let agent = agent.to_owned();
    tokio::task::spawn_blocking(move || installed_bundle(&agent).map(|_| ()))
        .await
        .map_err(|_| "Official App version lookup failed")?
}
fn command(agent: &str, profile: &NativeAppProfile, bundle: &Path) -> Result<Command, String> {
    bundle_id(agent)?;
    profile.validate(agent)?;
    let mut command = Command::new("/usr/bin/open");
    command.arg("-n").arg("-a").arg(bundle);
    // open --env changes the launched process, whereas Command::env_remove
    // only changes the dispatcher. Empty explicit values mask launchd defaults.
    for name in [
        "CLAUDE_USER_DATA_DIR",
        "CLAUDE_CDP_AUTH",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_MODEL",
        "OPENAI_API_KEY",
        "OPENAI_BASE_URL",
    ] {
        command.env_remove(name).arg("--env").arg(name);
    }
    for (name, path) in [
        ("HOME", profile.system_home()),
        ("CFFIXED_USER_HOME", profile.system_home()),
        ("CLAUDE_CONFIG_DIR", profile.system_home().join(".claude")),
    ] {
        command
            .arg("--env")
            .arg(format!("{name}={}", path.display()));
    }
    if agent == "codex" {
        command
            .arg("--env")
            .arg(format!("CODEX_HOME={}", profile.home().display()));
        command.arg("--env").arg(format!(
            "CODEX_ELECTRON_USER_DATA_PATH={}",
            profile.user_data().display()
        ));
    }
    command
        .arg("--args")
        .arg(format!("--user-data-dir={}", profile.user_data().display()));
    Ok(command)
}
/// Bound the LaunchServices dispatcher while config/owner locks are held.
/// Only this child is killed on timeout; a vendor App it launched is untouched.
fn run_dispatcher(command: &mut Command, timeout: std::time::Duration) -> Result<(), String> {
    let mut child = command
        .spawn()
        .map_err(|_| "Could not open the isolated official App")?;
    let deadline = std::time::Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return if status.success() {
                    Ok(())
                } else {
                    Err("Could not open the isolated official App".into())
                }
            }
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(20))
            }
            result => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(if result.is_err() {
                    "Cannot inspect the official App dispatcher"
                } else {
                    "Opening the isolated official App timed out; check its window before retrying"
                }
                .into());
            }
        }
    }
}
fn dispatch<T>(
    mut command: Command,
    check_owner: impl FnOnce() -> Result<(), String>,
    run: impl FnOnce(&mut Command) -> Result<T, String>,
) -> Result<T, String> {
    check_owner()?;
    run(&mut command)
}
pub(super) fn open(
    agent: &str,
    profile: &NativeAppProfile,
    check_owner: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let bundle = installed_bundle(agent)?;
    profile.prepare_launch_directories()?;
    let command = command(agent, profile, &bundle)?;
    // Revalidate after filesystem/config locks and bundle discovery: suspension
    // invalidates the lease without waiting for the operation read barrier.
    dispatch(command, check_owner, |command| {
        run_dispatcher(command, std::time::Duration::from_secs(10))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture_bundle(root: &Path, name: &str, agent: &str, version: &str) -> PathBuf {
        let path = root.join(name);
        std::fs::create_dir_all(path.join("Contents")).unwrap();
        let mut info = plist::Dictionary::new();
        info.insert(
            "CFBundleIdentifier".into(),
            bundle_id(agent).unwrap().into(),
        );
        info.insert("CFBundleShortVersionString".into(), version.into());
        plist::Value::Dictionary(info)
            .to_file_xml(path.join("Contents/Info.plist"))
            .unwrap();
        path.canonicalize().unwrap()
    }
    #[cfg(unix)]
    #[test]
    fn dispatcher_completes_or_times_out_without_launching_gui() {
        run_dispatcher(
            &mut Command::new("/usr/bin/true"),
            std::time::Duration::from_secs(1),
        )
        .unwrap();
        let mut sleeping_child = Command::new("/bin/sleep");
        sleeping_child.arg("5");
        let start = std::time::Instant::now();
        assert!(
            run_dispatcher(&mut sleeping_child, std::time::Duration::from_millis(30))
                .unwrap_err()
                .contains("timed out")
        );
        assert!(start.elapsed() < std::time::Duration::from_secs(2));
    }
    #[test]
    fn selected_bundle_itself_must_have_verified_version() {
        let root = tempfile::tempdir().unwrap();
        let old = fixture_bundle(root.path(), "A.app", "codex", "0.99.0");
        fixture_bundle(root.path(), "Z.app", "codex", CODEX_ISOLATION_RELEASE);
        // Cannot validate a supported second candidate then launch the first.
        assert!(installed_bundle_in("codex", &[root.path().into()])
            .unwrap_err()
            .contains("0.99.0"));
        std::fs::remove_dir_all(old).unwrap();
        let selected = installed_bundle_in("codex", &[root.path().into()]).unwrap();
        assert_eq!(selected.file_name().unwrap(), "Z.app");
        let profile = NativeAppProfile::new("codex", "https://cloud.example", "owner").unwrap();
        assert_eq!(
            command("codex", &profile, &selected)
                .unwrap()
                .get_args()
                .nth(2)
                .unwrap(),
            selected.as_os_str()
        );
        let claude = fixture_bundle(
            root.path(),
            "Claude Renamed.app",
            "claude_desktop",
            "2.110.0",
        );
        assert_eq!(
            installed_bundle_in("claude_desktop", &[root.path().into()]).unwrap(),
            claude
        );
        fixture_bundle(root.path(), "Claude Renamed.app", "claude_desktop", "3.0.0");
        assert!(installed_bundle_in("claude_desktop", &[root.path().into()]).is_err());
    }
    #[test]
    fn changed_owner_is_rejected_at_dispatch_after_command_preparation() {
        let profile = NativeAppProfile::new("codex", "https://cloud.example", "owner").unwrap();
        let command = command("codex", &profile, Path::new("/Applications/Codex.app")).unwrap();
        let result: Result<(), String> = dispatch(
            command,
            || Err("market_identity_changed".into()),
            |_| panic!("stale owner must not spawn"),
        );
        assert_eq!(result.unwrap_err(), "market_identity_changed");
    }
    #[test]
    fn launch_targets_exact_bundle_and_same_profile_without_global_url_dispatch() {
        for agent in ["codex", "claude_desktop"] {
            let profile = NativeAppProfile::new(agent, "https://cloud.example", "owner").unwrap();
            let bundle = Path::new("/Applications/Vendor App.app");
            let command = command(agent, &profile, bundle).unwrap();
            let args = command
                .get_args()
                .map(|v| v.to_string_lossy().into_owned())
                .collect::<Vec<_>>();
            assert_eq!(&args[..3], ["-n", "-a", "/Applications/Vendor App.app"]);
            assert_eq!(
                args.last().unwrap(),
                &format!("--user-data-dir={}", profile.user_data().display())
            );
            assert!(!args.iter().any(|v| v.contains("claude://") || v == "-b"));
            if agent == "codex" {
                assert!(args.contains(&format!("CODEX_HOME={}", profile.home().display())));
                assert!(args.contains(&format!(
                    "CODEX_ELECTRON_USER_DATA_PATH={}",
                    profile.user_data().display()
                )));
            }
            assert!(args.contains(&format!("HOME={}", profile.system_home().display())));
            assert!(args.contains(&format!(
                "CFFIXED_USER_HOME={}",
                profile.system_home().display()
            )));
            for name in [
                "CLAUDE_USER_DATA_DIR",
                "ANTHROPIC_API_KEY",
                "OPENAI_API_KEY",
            ] {
                assert!(args.windows(2).any(|pair| pair == ["--env", name]));
            }
            assert!(command.get_envs().all(|(_, value)| value.is_none()));
        }
    }
}
