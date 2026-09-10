# Deployment guidance

Read the root [AGENTS.md](../AGENTS.md) and [deployment guide](README.md).

- Run the shared verification command against the staged release before
  stopping the service. A verification or prerequisite failure must leave the
  current service and financial data alone.
- Keep code, persistent data, and backups in their documented separate paths.
  Archive extraction accepts regular source files only, never private data,
  traversal paths, or symbolic links.
- Stop the service before taking its complete pre-update data snapshot.
  Preserve the update lock, atomic release switch, and health check.
- Startup may migrate data. On failed startup, preserve the backup and data,
  leave the service stopped, and restore only the previous code link for review;
  do not silently restore data.
- Updater and service-file installation is separate from releasing app code.
  Document new prerequisites and the upgrade path for existing installations.

Test failure ordering with isolated fixtures and mocked service commands.
Never execute the installer or deployment against a live VM to test a code edit.
Actual deployment requires the user's deployment request.
