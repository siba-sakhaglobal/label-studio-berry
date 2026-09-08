# label-studio-berry

A Berry-specific fork of [Label Studio](https://labelstud.io) (upstream
[HumanSignal/label-studio](https://github.com/HumanSignal/label-studio)) with
UI + backend patches for the Berry deployment.

Upstream Label Studio's README is preserved verbatim at
[`README_UPSTREAM.md`](README_UPSTREAM.md).

## Why a fork?

Berry embeds Label Studio inside a larger studio (`demo.berrydb.io` and
`uat.berrydb.io`) that mounts LS under a `/label-studio` subpath, hides
some UI sections, and adds Berry-specific import + settings flows. A few
of those changes are impossible to express through Label Studio's normal
extension surface (theme, plugin, task-data), so we track them here.

## What's different from upstream

Non-trivial diffs (see `git log` on the `develop` branch for full detail):

- **`web/apps/labelstudio/src/pages/CreateProject/Import/Import.jsx`** —
  Import screen simplified: hides sample-task and manual-JSON tabs so
  users always land on the Cloud Storage / URL import path Berry
  expects.
- **`web/apps/labelstudio/src/pages/Settings/AnnotationSettings.jsx`,
  `MachineLearningSettings/MachineLearningSettings.jsx`** — small
  wording tweaks so LS's language matches Berry's ("annotation" →
  "labeling" in a couple of places, hide backends we don't ship).
- **`web/apps/labelstudio/src/pages/Settings/BerryModelPicker.jsx`
  (new)** — dropdown component used by the ML settings page to pick a
  Berry-provided model preset without typing a raw ML backend URL.
- **`label_studio/annotation_templates/code-*/`** — five new template
  groups shipped for Berry customers (code classification, code
  descriptions, code knowledge graph, code quality scoring, code
  taxonomy). These are pure JSON/HTML template bundles, discoverable by
  LS's existing template loader.
- **`label_studio/annotation_templates/groups.txt`** — one-line update
  that registers the new template group in LS's template index.

The Django settings + templates patch that flips LS into subpath mode
(`HOST=/label-studio` accepted as a path-only value, `LOGIN_URL`
prefixed with `FORCE_SCRIPT_NAME`, `APP_SETTINGS.hostname` normalized in
the browser) lives OUTSIDE this repo, under
`LabelStudioBerry/patches/apply_settings_subpath.py`, and is applied
against the installed venv rather than the source tree — see that
script's README.

## Working with the fork

The upstream repo is added as the `origin` remote so we can pull LS
releases. This fork's own remote is `berry`. To bring in an upstream
1.23-series fix:

```bash
git fetch origin
git rebase origin/1.23-branch    # or the corresponding LS release branch
git push berry develop
```

For everyday Berry work, cut a branch off `develop`, commit, push:

```bash
git checkout -b feat/short-name
# ...edits...
git commit -am "..."
git push berry feat/short-name
```

Open a pull request against this repo's `develop`.

## Running locally

Follow the upstream instructions in
[`README_UPSTREAM.md`](README_UPSTREAM.md). For the Berry deployment
specifics (pm2 entry, subpath mode, nginx pairing), the runbook lives in
`LabelStudioBerry/patches/README.md` in the enclosing workspace.

## License

Apache 2.0 — see [`LICENSE`](LICENSE). Unmodified from upstream.

## Contact

Berry-side questions: [siba.prasad@sakhaglobal.com](mailto:siba.prasad@sakhaglobal.com).

For general Label Studio support (labeling configs, ML backends,
storage adapters, etc.) refer to upstream at
[HumanSignal/label-studio](https://github.com/HumanSignal/label-studio).
