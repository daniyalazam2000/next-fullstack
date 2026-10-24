# CI/CD Notes

## Local quality gates (Task 0.2)

| Gate                         | Tool                            | Hook         | Receives                                                      |
| ---------------------------- | ------------------------------- | ------------ | ------------------------------------------------------------- |
| Format and lint staged files | lint-staged (ESLint + Prettier) | `pre-commit` | Nothing from Git; lint-staged asks Git which files are staged |
| Commit message format        | commitlint                      | `commit-msg` | The path to the file holding the message (`$1`)               |

`pre-commit` runs before the message is written, so it checks code. `commit-msg` runs after, so it checks the message.

lint-staged runs on staged files only, not the whole repo. It stays fast as the project grows, and an old problem in a file you did not touch cannot block your commit.

### Why `prepare` matters

Git does not use `.husky/` on its own. Husky has to point Git at it, and that setting lives on each machine, not in the repo. The `prepare` script (`"prepare": "husky"`) runs automatically after `npm install`, so every teammate who installs gets the hooks. Without it, hooks would only work on the machine that set them up.

## Why don't local gates replace CI?

Local gates give fast feedback. CI is the enforcement. Three reasons local gates cannot be the only line of defence:

1. **`--no-verify` skips everything.** `git commit --no-verify` bypasses both `pre-commit` and `commit-msg`. I tested this: `git commit --allow-empty -m "bad message" --no-verify` was accepted with no hooks running. Anyone can do it, by accident or on purpose, and nothing local can stop it. A check that can be switched off by the person it checks is a suggestion, not a rule.
2. **A contributor who has not run `npm install` has no hooks.** Husky is only activated by the `prepare` script during `npm install`. Someone who clones the repo and commits without installing gets no checks. The same applies to anyone editing through the GitHub web UI or another tool that never runs Git hooks.
3. **A different environment gives different results.** Hooks run on each person's own machine, with their own OS, Node version and installed packages. Code can pass on one laptop and fail on another. CI runs in one clean, controlled environment for everyone, so a pass there means the same thing every time. CI can also run checks that are too slow for a pre-commit hook, such as a full build and the whole test suite.

CI is also the check that can be made mandatory, through branch protection that blocks merging until it passes. A local hook cannot do that.

## CI scripts (Task 0.3)

CI will call these npm scripts by name:

| Script         | Command                     | Purpose                            |
| -------------- | --------------------------- | ---------------------------------- |
| `lint`         | `eslint . --max-warnings 0` | Code quality rules                 |
| `typecheck`    | `tsc --noEmit`              | Type errors across the project     |
| `format:check` | `prettier --check .`        | Formatting, without changing files |
| `test`         | placeholder (see below)     | Tests                              |
| `build`        | `next build`                | Production build                   |

### Decision: `lint` fails on warnings

`--max-warnings 0` makes any warning fail the script. In CI nobody reads warnings, so they pile up until real problems are lost in the noise. If a rule is too noisy, turn it off in the config on purpose instead of tolerating its warnings. It is easier to start at zero than to get back to zero later.

### Decision: `test` is a placeholder

There is no test runner until Phase 2, so `test` prints `No tests yet - test runner arrives in Phase 2` and exits 0. I chose this over installing Vitest now because I do not yet know what needs testing (React components, server code, path aliases), and a runner configured on a guess would likely be reworked. The script name exists now, so the CI workflow in 0.4 will not need to change when the real runner arrives.

Risk: a placeholder that exits 0 shows a green check even though nothing is tested. The message is printed in the CI log so it is visible, and it must not be read as test coverage.

TODO (Phase 2): replace the placeholder `test` script with a real runner (Vitest) and add real tests.

### Build timing and warnings

A cold `next build` (no `.next` cache) took about 28s locally: roughly 12s to compile, 9s for the TypeScript step, under 1s to generate the static pages. CI will differ, so treat this as a baseline to compare against, not a target. The build produced no warnings as of this commit. It runs its own type-check, but it does not run lint or Prettier, so those still need their own steps.

### Combined `check` script

`npm run check` runs `lint`, `typecheck`, `format:check` and `test` in sequence and stops at the first failure. It is for local use: one command to run before pushing. It leaves out `build` because that is slow and has its own CI step.

CI will call the four scripts separately rather than `check`. Each one then appears as its own named step in the Actions UI, so a failure shows at a glance which check broke. With `check`, CI would show a single red step and you would have to read the log to find out which of the four failed.

## Node version pin

Node is pinned in two places, with different jobs:

| File                   | Value  | Meaning                                        |
| ---------------------- | ------ | ---------------------------------------------- |
| `.nvmrc`               | `24`   | The one version to use. Tools read it.         |
| `package.json` engines | `>=24` | The range the project supports. A declaration. |

I pinned the major version, not an exact one like `24.14.0`. Patch releases are fixes, so CI picks up security patches without a manual bump, and the lockfile already pins the dependencies that matter. Pin exactly only if a bug appears on one patch release.

**Neither one enforces anything on its own.** With `engines`, npm only prints an `EBADENGINE` warning on the wrong Node version and carries on. It blocks the install only if `engine-strict=true` is set in an `.npmrc`. `.nvmrc` enforces nothing at all: tools such as nvm switch versions only when someone runs them (`nvm use`). The real enforcement is CI, where `actions/setup-node` reads the file with `node-version-file: '.nvmrc'` (task 0.4), so CI always runs on the pinned version.

`@types/node` was moved from `^20` to `^24` so that the type definitions match the Node runtime.

## `npm ci` vs `npm install` (Task 0.6)

- **`npm install`** reads `package.json`, can pick newer versions inside the allowed ranges, and **rewrites `package-lock.json`** if anything changed. It only adds or updates things in `node_modules`.
- **`npm ci`** installs **exactly** what `package-lock.json` says. It never changes the lockfile, and it **deletes `node_modules` first** so you start clean. If `package.json` and the lockfile disagree, it fails instead of fixing it.
- CI uses `ci` (see the `Install` step in `.github/workflows/ci.yml`) so every run builds the same dependency tree as the lockfile. The build is repeatable, and a stale lockfile gets caught instead of hidden.
- Rule of thumb: `install` when _you_ are changing dependencies, `ci` when a machine is just building.

## Pinning actions

| Pin style                  | Example       | What it means                                           |
| -------------------------- | ------------- | ------------------------------------------------------- |
| Tag                        | `@v4.2.1`     | One release, but the author can move the tag later      |
| Major only                 | `@v4`         | Floats to the newest `v4.x.x`, so you auto-get new code |
| Full commit SHA (40 chars) | `@a1b2c3d...` | Exactly one commit. It cannot be changed or moved       |

- **The attack:** tags are just labels. If an action's repo is hacked (or its maintainer goes bad), the attacker can move `v4` to point at malicious code. Your next CI run then executes it, with access to your repo and secrets. A SHA can't be moved, so you only run code you chose.
- **Dependabot's role:** a SHA never updates by itself, so it would go stale. Dependabot's `github-actions` entry in `.github/dependabot.yml` opens a PR to bump the SHA (it keeps a `# v4.2.1` comment next to it), so you review each change instead of getting it silently.
- **Where I am now:** `ci.yml` uses major tags (`actions/checkout@v7`, `actions/setup-node@v7`). That is a convenient middle ground for official GitHub actions. Pinning to SHAs would be the stricter option, and matters most for third-party actions.

## `concurrency`

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main'}}
```

- `group` means "only one run per workflow per branch at a time". Pushing again to the same PR branch starts a new run in the same group.
- `cancel-in-progress` cancels the older run when a newer one starts. On PR branches that is good: the old run tests outdated code, so it wastes minutes.
- My expression makes it `false` on `main`, so runs on `main` are never cancelled and each merge gets a full result.
- **When cancelling is bad: deploys.** If a deploy is half done (migrating a database, uploading files) and a new push cancels it, you can be left in a broken, half-deployed state. For deploys, let the running one finish and queue the next (`cancel-in-progress: false`).

## Least-privilege `permissions:`

- Every run gets a `GITHUB_TOKEN`. If you don't set `permissions:`, it gets the repo/org **default**, which can be broad (read and write on contents, pull requests, issues, packages and more). If a step or a compromised action is malicious, it could push code or edit PRs.
- My workflow only needs to **read the code** to check it out and run checks, so `ci.yml` sets `permissions: contents: read` at the top. Anything not listed is denied.
- Rule: start with the least, and add a permission only when a job fails because it needs one.

## Local gates vs CI

Covered above in "Why don't local gates replace CI?". Short version: local hooks are fast feedback but can be skipped (`--no-verify`), may not be installed, and differ per machine. CI is the clean, same-for-everyone check, and it is the one branch protection can make mandatory.

## Required checks

- A required check in the ruleset is matched by **name**, using the job's `name:` (here `Lint, typecheck, test, build`). If I rename the job, the ruleset keeps waiting for the old name, which never reports, and every PR gets stuck on "Expected - waiting for status". So rename the job and update the ruleset together.
- **What I saw when I broke lint on purpose:** _(fill in from your own test: the CI step that went red, and the merge button being blocked.)_

## `pull_request` vs `pull_request_target`

- **`pull_request`** runs the workflow from the PR's own code, in a restricted context: for PRs from forks, the token is read-only and **no secrets** are available. Safe for untrusted code.
- **`pull_request_target`** runs the workflow definition from the **base branch** (`main`) and **does** get secrets and a write token, even for fork PRs. That's useful for things like labelling PRs, but dangerous if it checks out and runs the PR's code: a stranger's code would run with your secrets.
- I use `pull_request` (`ci.yml`) because CI needs to run the PR's code, and that code should never get secrets. Only use `pull_request_target` for jobs that don't run PR code.

## Decisions made in Phase 0

- **App at repo root, not a subfolder:** this repo is a single Next.js app, so `package.json`, `.nvmrc`, `.github/` and the lockfile all sit at the root. No path filters, `working-directory` or extra Dependabot directories are needed (`directory: '/'`). A subfolder only makes sense later if there are multiple apps (monorepo).
- **`test` is a placeholder:** the script exists and exits 0 so CI doesn't need to change later, but I didn't install Vitest until I know what needs testing. Risk: green check with no real tests. TODO in Phase 2. (Details in "Decision: `test` is a placeholder".)
- **Ruleset approvals setting:** _(fill in what you set, e.g. required approvals = 0 because I'm the only developer, and you can't approve your own PR. The status check is still required.)_
- **Dependabot grouping:** minor and patch updates are grouped into one PR per ecosystem (`dev-dependencies`, `production-dependencies`, and `actions`), run weekly on Sunday. Fewer PRs to review. Major updates are left out of the groups so each arrives as its own PR, because they may break things and need individual attention. `open-pull-requests-limit: 5` stops a flood.
- **`--max-warnings 0` on lint:** warnings fail CI, so they can't pile up unnoticed.

## Phase 0 pipeline

```
commit  -> pre-commit (lint-staged) -> commit-msg (commitlint)
   |
push to feature branch (direct push to main is rejected by the ruleset)
   |
open PR -> CI runs (lint, typecheck, format, test, build)
   |
required check "Lint, typecheck, test, build" must be green
   |
merge to main (CI runs again on main)
   ^
Dependabot opens PRs weekly -> they go through the same path
```
