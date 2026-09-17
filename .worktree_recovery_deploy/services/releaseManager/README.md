# OmniStore Master Release Manager

Phase 20 provides a read-only master release snapshot and customer-copy planning package.

It does not copy files, create customer directories, change branding, persist configuration, execute SQL, connect Supabase, post accounting entries, or move inventory.

```js
const release = OmniReleaseManager.ReleaseSnapshotEngine.build();
console.log(release.masterReleaseReadinessScore);
```

The target directory is always represented by the placeholder `{{NEW_CUSTOMER_COPY_DIRECTORY}}`. A real customer-copy operation requires a separate, explicit workflow and approval.

Load the builders/checkers first and `ReleaseSnapshotEngine.js` last.
