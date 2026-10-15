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
