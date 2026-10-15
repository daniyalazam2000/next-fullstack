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
