## Mandatory spec-driven development (SDD)
SDD means that a written specification defines the required behavior before code changes begin.

- Use SDD for every code change.
- Before implementation, create or update the spec with the goal, scope, exclusions, constraints, and testable acceptance criteria.
- Inspect the relevant code before you state assumptions as facts.
- Use the repository's existing spec format and location. Keep a larger change's spec in the repository.
- For a tiny, self-contained change, a short inline spec with the expected result and verification check is sufficient.
- Keep questions and read-only research outside this code-change requirement.
- Derive the implementation plan and worker tasks from the spec. One document can contain the spec, plan, and tasks.
- Give each worker the relevant spec, permitted files, dependencies, and acceptance checks.
- Update the spec before you implement a change to the required behavior or scope.
- Follow the existing approval rules. A spec, test result, or reviewer decision does not grant new authority.
- Have fresh reviewers check the final changes and test evidence against the same spec.
- Before you report completion, map each acceptance criterion to evidence. Report failed checks, unrun checks, and blockers.
- Treat this section as mandatory instructions, not as proof that tool-level enforcement exists.
