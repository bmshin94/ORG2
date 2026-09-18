use super::*;
use crate::managed_config::tests::{OrgiiHomeGuard, TEST_ENV_LOCK};
use crate::managed_config::{
    self as config, manifest,
    model_catalog::{ModelCatalog, PickerModel},
    operations,
};
use std::{collections::BTreeMap, ffi::OsString};
struct ExternalHome(Option<OsString>);
impl ExternalHome {
    fn set(path: &Path) -> Self {
        let old = std::env::var_os("ORGII_EXTERNAL_HISTORY_HOME");
        std::env::set_var("ORGII_EXTERNAL_HISTORY_HOME", path);
        Self(old)
    }
}
impl Drop for ExternalHome {
    fn drop(&mut self) {
        match self.0.take() {
            Some(value) => std::env::set_var("ORGII_EXTERNAL_HISTORY_HOME", value),
            None => std::env::remove_var("ORGII_EXTERNAL_HISTORY_HOME"),
        }
    }
}
fn expected(agent: &str) -> BTreeMap<String, Option<String>> {
    operations::status_for_unlocked(agent)
        .unwrap()
        .target_files
        .into_iter()
        .map(|t| (t.id, t.current_hash))
        .collect()
}
fn apply(profile: &NativeAppProfile) -> Result<config::CliConfigManagedStatus, String> {
    let catalog = ModelCatalog {
        models: ["package-a", "package-b"]
            .into_iter()
            .map(|id| PickerModel {
                id: id.into(),
                label: id.into(),
                native_metadata: Some(serde_json::json!({"slug":id,"context_window":12345})),
            })
            .collect(),
    };
    config::enable_native_app(
        profile,
        "market-app:fixture".into(),
        "market".into(),
        "package-a".into(),
        Some(&catalog),
        None,
        &expected("codex"),
    )
}
fn write(path: &Path, value: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, value).unwrap();
}
#[test]
fn scope_is_stable_per_cloud_owner_and_instance_without_package_or_credentials() {
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(temp.path());
    let a = NativeAppProfile::new("codex", "https://cloud.example/", "alice").unwrap();
    assert_eq!(
        a,
        NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap()
    );
    assert_ne!(
        a.home(),
        NativeAppProfile::new("codex", "https://cloud.example", "bob")
            .unwrap()
            .home()
    );
    assert_ne!(
        a.home(),
        NativeAppProfile::new("codex", "https://other.example", "alice")
            .unwrap()
            .home()
    );
    assert!(!serde_json::to_string(&a).unwrap().contains("alice"));
    assert!(NativeAppProfile::new("codex", "https://secret@cloud.example", "alice").is_err());
    assert!(NativeAppProfile::new("claude_code", "https://cloud.example", "alice").is_err());
    let previous = a.home();
    let _other_home = OrgiiHomeGuard::set(&temp.path().join("instance-2"));
    assert_ne!(previous, a.home());
}
#[test]
fn isolated_catalog_manifest_and_launch_use_same_root_without_mutating_primary() {
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(&temp.path().join("external"));
    let native = crate::generic_config::resolve_config_path("codex", "config").unwrap();
    assert!(native.starts_with(temp.path()));
    write(&native, "model = 'primary-model'\n");
    let profile = NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap();
    let status = apply(&profile).unwrap();
    assert_eq!(
        std::fs::read_to_string(&native).unwrap(),
        "model = 'primary-model'\n"
    );
    assert_eq!(status.native_app.as_ref(), Some(&profile));
    let raw = std::fs::read_to_string(profile.target("config").unwrap()).unwrap();
    let value: toml::Value = toml::from_str(&raw).unwrap();
    assert_eq!(
        value["model_catalog_json"].as_str(),
        profile
            .target(config::model_catalog::TARGET_ID)
            .unwrap()
            .to_str()
    );
    assert_eq!(
        manifest::read_manifest("codex")
            .unwrap()
            .unwrap()
            .native_app,
        Some(profile.clone())
    );
    with_launch("codex", &profile, "market-app:fixture", "package-a", || {
        Ok(())
    })
    .unwrap();
    assert!(with_launch::<()>(
        "codex",
        &profile,
        "market-app:wrong",
        "package-a",
        || panic!("must not dispatch stale selection")
    )
    .is_err());
    let other = NativeAppProfile::new("codex", "https://cloud.example", "bob").unwrap();
    assert!(apply(&other).is_err());
    assert!(with_launch::<()>(
        "codex",
        &other,
        "market-app:fixture",
        "package-a",
        || panic!("wrong owner profile must not launch")
    )
    .is_err());
    let claude = NativeAppProfile::new("claude_desktop", "https://cloud.example", "alice").unwrap();
    assert!(claude.validate_launch(&status).is_err());
    let history = profile.home().join("sessions/history-marker");
    write(&history, "retained");
    operations::restore_agent_default_unlocked("codex", false).unwrap();
    assert_eq!(std::fs::read_to_string(history).unwrap(), "retained");
    assert_eq!(
        std::fs::read_to_string(&native).unwrap(),
        "model = 'primary-model'\n"
    );
    assert!(operations::status_for_unlocked("codex")
        .unwrap()
        .native_app
        .is_none());
    assert!(apply(&other).is_ok());
}
#[test]
fn legacy_active_and_reverse_cli_switch_require_restore_without_touching_primary() {
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(&temp.path().join("external"));
    let native = crate::generic_config::resolve_config_path("codex", "config").unwrap();
    assert!(native.starts_with(temp.path()));
    write(&native, "model = 'primary'\n");
    config::enable_orgii_managed(
        "codex",
        Some("local-key".into()),
        Some("openai".into()),
        Some("local-model".into()),
        false,
    )
    .unwrap();
    let before = std::fs::read(&native).unwrap();
    let recorded = std::fs::read(manifest::manifest_path("codex")).unwrap();
    let backups = manifest::read_manifest("codex")
        .unwrap()
        .unwrap()
        .target_files
        .into_iter()
        .filter_map(|target| {
            std::fs::read(&target.default_backup_path)
                .ok()
                .map(|bytes| (target.default_backup_path, bytes))
        })
        .collect::<Vec<_>>();
    assert!(!backups.is_empty());
    let profile = NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap();
    assert!(apply(&profile).unwrap_err().contains("Restore"));
    assert_eq!(std::fs::read(&native).unwrap(), before);
    assert_eq!(
        std::fs::read(manifest::manifest_path("codex")).unwrap(),
        recorded
    );
    operations::restore_agent_default_unlocked("codex", false).unwrap();
    apply(&profile).unwrap();
    for (path, bytes) in &backups {
        assert_eq!(&std::fs::read(path).unwrap(), bytes);
    }
    assert!(config::enable_orgii_managed(
        "codex",
        Some("local-key".into()),
        Some("openai".into()),
        Some("model".into()),
        false
    )
    .unwrap_err()
    .contains("Restore"));
    assert_eq!(
        std::fs::read_to_string(&native).unwrap(),
        "model = 'primary'\n"
    );
    operations::restore_agent_default_unlocked("codex", false).unwrap();
    config::enable_orgii_managed(
        "codex",
        Some("local-key".into()),
        Some("openai".into()),
        Some("model".into()),
        false,
    )
    .unwrap();
    assert!(std::fs::read_to_string(&native)
        .unwrap()
        .contains("model_provider"));
}
#[test]
fn claude_helper_runtime_and_restore_stay_isolated_and_preserve_runtime_preferences() {
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(&temp.path().join("external"));
    let native =
        app_paths::external_history_data_local_dir().join("Claude-3p/claude_desktop_config.json");
    assert!(native.starts_with(temp.path()));
    write(&native, r#"{"deploymentMode":"1p","theme":"dark"}"#);
    let original = std::fs::read(&native).unwrap();
    let profile =
        NativeAppProfile::new("claude_desktop", "https://cloud.example", "alice").unwrap();
    let token = "a".repeat(64);
    let connection = config::DirectConnection {
        profile: None,
        key_id: "market:fixture".into(),
        provider: "market".into(),
        model: "claude-sonnet-4-6".into(),
        base_url: config::claude_desktop_proxy_base_url(&config::managed_proxy_url(), &token),
        api_key: String::new(),
        desktop_auth_scheme: Some("bearer".into()),
        desktop_helper: Some(config::desktop::CredentialHelper {
            path: profile.helper(),
            token: token.clone(),
            models: vec!["claude-sonnet-4-6".into(), "claude-opus-4-6".into()],
        }),
        proxy_token: Some(token),
    };
    let status = config::enable_native_app(
        &profile,
        connection.key_id.clone(),
        "market".into(),
        connection.model.clone(),
        None,
        Some(&connection),
        &expected("claude_desktop"),
    )
    .unwrap();
    profile.validate_launch(&status).unwrap();
    let value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(profile.target("profile").unwrap()).unwrap())
            .unwrap();
    assert_eq!(
        value["inferenceCredentialHelper"].as_str(),
        profile.helper().to_str()
    );
    assert_eq!(value["inferenceModels"].as_array().unwrap().len(), 2);
    assert_eq!(value["claudeAiImport"], serde_json::json!({"enabled": true}));
    write(
        &profile.target("desktop").unwrap(),
        r#"{"deploymentMode":"3p","theme":"light"}"#,
    );
    operations::restore_agent_default_unlocked("claude_desktop", false).unwrap();
    let runtime: serde_json::Value =
        serde_json::from_slice(&std::fs::read(profile.target("desktop").unwrap()).unwrap())
            .unwrap();
    assert_eq!(runtime, serde_json::json!({"theme":"light"}));
    assert_eq!(std::fs::read(native).unwrap(), original);
}
#[cfg(unix)]
#[test]
fn symlink_destination_and_tampered_scope_fail_before_primary_writes() {
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(&temp.path().join("external"));
    let profile = NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap();
    std::fs::create_dir_all(profile.root()).unwrap();
    let primary = temp.path().join("primary");
    std::fs::create_dir_all(&primary).unwrap();
    write(&primary.join("config.toml"), "unchanged");
    std::os::unix::fs::symlink(&primary, profile.home()).unwrap();
    assert!(apply(&profile).is_err());
    assert_eq!(
        std::fs::read_to_string(primary.join("config.toml")).unwrap(),
        "unchanged"
    );
    let malformed: NativeAppProfile = serde_json::from_value(
        serde_json::json!({"version":1,"agent":"codex","scope":"../../escape"}),
    )
    .unwrap();
    assert!(malformed.validate("codex").is_err());
}

#[test]
fn single_model_without_catalog_can_launch_but_owned_missing_catalog_cannot() {
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(&temp.path().join("external"));
    let profile = NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap();
    config::enable_native_app(
        &profile,
        "market-app:fixture".into(),
        "market".into(),
        "package-a".into(),
        None,
        None,
        &expected("codex"),
    )
    .unwrap();
    assert!(!profile
        .target(config::model_catalog::TARGET_ID)
        .unwrap()
        .exists());
    with_launch("codex", &profile, "market-app:fixture", "package-a", || {
        Ok(())
    })
    .unwrap();
    apply(&profile).unwrap();
    std::fs::remove_file(profile.target(config::model_catalog::TARGET_ID).unwrap()).unwrap();
    assert!(with_launch::<()>(
        "codex",
        &profile,
        "market-app:fixture",
        "package-a",
        || panic!("missing owned catalog must not launch")
    )
    .is_err());
}

#[cfg(unix)]
#[test]
fn restore_and_pending_first_apply_recovery_reject_parent_symlink_without_primary_writes() {
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(&temp.path().join("external"));
    let profile = NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap();
    apply(&profile).unwrap();
    let manifest = manifest::read_manifest("codex").unwrap().unwrap();
    let snapshots = config::snapshot::read_target_snapshots(&manifest.target_files).unwrap();
    config::transaction::begin_transaction("codex", &snapshots, &manifest, &BTreeMap::new())
        .unwrap();
    let original = std::fs::read(profile.target("config").unwrap()).unwrap();
    let primary = temp.path().join("primary");
    std::fs::rename(profile.home(), &primary).unwrap();
    std::os::unix::fs::symlink(&primary, profile.home()).unwrap();
    assert!(operations::status_for_unlocked("codex").is_err());
    for force in [false, true] {
        assert!(operations::restore_agent_default_unlocked("codex", force).is_err());
    }
    // First Apply can crash before its manifest exists. The journal carries its
    // own descriptor, so recovery cannot rely on an already committed manifest.
    std::fs::remove_file(config::manifest::manifest_path("codex")).unwrap();
    assert!(config::transaction::recover_pending_transaction_unlocked("codex").is_err());
    assert_eq!(
        std::fs::read(primary.join("config.toml")).unwrap(),
        original
    );
    assert!(config::transaction::transaction_journal_path("codex").exists());
}

#[test]
fn tampered_manifest_and_journal_targets_fail_closed_outside_profile() {
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(&temp.path().join("external"));
    let profile = NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap();
    apply(&profile).unwrap();
    let mut manifest = manifest::read_manifest("codex").unwrap().unwrap();
    let outside = temp.path().join("primary-config.toml");
    write(&outside, "unchanged");
    let snapshots = config::snapshot::read_target_snapshots(&manifest.target_files).unwrap();
    config::transaction::begin_transaction("codex", &snapshots, &manifest, &BTreeMap::new())
        .unwrap();
    manifest.target_files[0].target_path = outside.to_string_lossy().into_owned();
    config::manifest::write_manifest(&manifest).unwrap();
    assert!(operations::status_for_unlocked("codex").is_err());
    assert!(operations::restore_agent_default_unlocked("codex", true).is_err());
    let path = config::transaction::transaction_journal_path("codex");
    let mut journal: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    journal["targetFiles"][0]["targetPath"] = outside.to_string_lossy().into_owned().into();
    std::fs::write(&path, serde_json::to_vec(&journal).unwrap()).unwrap();
    assert!(config::transaction::recover_pending_transaction_unlocked("codex").is_err());
    assert_eq!(std::fs::read_to_string(outside).unwrap(), "unchanged");
}

#[test]
fn owner_check_after_waiting_for_config_lock_cancels_dispatch() {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    };
    let _lock = TEST_ENV_LOCK.get_or_init(Default::default).lock().unwrap();
    let temp = tempfile::tempdir().unwrap();
    let _home = OrgiiHomeGuard::set(&temp.path().join("orgii"));
    let _external = ExternalHome::set(&temp.path().join("external"));
    let profile = NativeAppProfile::new("codex", "https://cloud.example", "alice").unwrap();
    apply(&profile).unwrap();
    let guard = config::config_operation_guard().unwrap();
    let valid = AtomicBool::new(true);
    let (tx, rx) = mpsc::channel();
    std::thread::scope(|scope| {
        let worker = scope.spawn(|| {
            tx.send(()).unwrap();
            with_launch("codex", &profile, "market-app:fixture", "package-a", || {
                if !valid.load(Ordering::SeqCst) {
                    return Err("market_identity_changed".into());
                }
                panic!("invalidated owner must not dispatch")
            })
        });
        rx.recv().unwrap();
        valid.store(false, Ordering::SeqCst);
        drop(guard);
        assert_eq!(
            worker.join().unwrap(),
            Err::<(), _>("market_identity_changed".into())
        );
    });
}
