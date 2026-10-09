// Git hooks (pre-commit...) export variables that locate the hook's own repository state. Inherited, they would
// make `git -C <other worktree>` read the wrong place or fail, so every git call here runs without them.
export const GIT_LOCATION_VARIABLES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_PREFIX"];

// The environment to hand to a git child process: `env` without the variables that locate a repository.
export const withoutGitLocation = (env = process.env) => Object.fromEntries(Object.entries(env).filter(([name]) => !GIT_LOCATION_VARIABLES.includes(name)));
