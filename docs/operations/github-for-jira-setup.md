# GitHub for Jira — setup (tamamorg.atlassian.net)

One-time install to link Jira issues with GitHub PRs, commits, and (optionally)
deployments for **tamamorg/TamamHealth**.

Parent doc: [jira-github-do-tracking.md](./jira-github-do-tracking.md).

---

## 1. Install the app

1. Open **https://tamamorg.atlassian.net**
2. **Settings** (gear) → **Apps** → **Explore apps** (or Atlassian Marketplace)
3. Search **GitHub for Jira** (by Atlassian)
4. Click **Get app** → install for **tamamorg**
5. Complete OAuth: authorize **GitHub** and select org/user **tamamorg**

---

## 2. Connect the repository

1. In Jira: **Apps → GitHub → Get started** (or **Manage your GitHub accounts**)
2. **Add organization** → `tamamorg`
3. **Include repositories** → select **TamamHealth** (or all repos)
4. Enable:
   - **Pull request linking**
   - **Commit linking**
   - **Deployments** (if shown)

---

## 3. Verify

1. Open any KAN issue (e.g. [KAN-91](https://tamamorg.atlassian.net/browse/KAN-91))
2. Check **Development** panel — should show “Connect to GitHub” or linked items after first PR
3. Open a test PR on GitHub with `KAN-91` in the title — issue should link within a few minutes

---

## 4. Smart commits (team convention)

In commit messages:

```text
KAN-91 Add GHCR compose override for staging deploys
```

In PR description:

```text
Closes KAN-91
Fixes KAN-92
```

Jira moves issues to **Done** when merged if your workflow allows smart-commit transitions.

Full conventions: [CONTRIBUTING.md](../CONTRIBUTING.md#jira-integration-smart-commits).

---

## 5. Cursor / VS Code (Atlascode)

Cursor is authenticated to **tamamorg.atlassian.net**. Update user settings if the Jira
sidebar still shows **inchcapeglobal**:

```json
"atlascode.jira.jqlList": [
  {
    "name": "My KAN Issues",
    "query": "project = KAN AND assignee = currentUser() AND resolution = Unresolved ORDER BY lastViewed DESC",
    "siteId": "147a321a-6723-462e-8ee2-ba43700629cd",
    "enabled": true,
    "monitor": true
  }
]
```

Site ID `147a321a-6723-462e-8ee2-ba43700629cd` = **tamamorg** (`tamamorg.atlassian.net`), confirmed via the Atlassian API on 2026-07-27.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| PRs not linking | Confirm repo included in GitHub for Jira settings; key must match `KAN-123` |
| Wrong GitHub org | Re-authorize app under **tamamorg** |
| Deployments empty | GitHub Deployments API not used yet — track SHA manually in Jira comments |
