# pgsketch — Windows Support Plan

Nov 2, 2026 · draft, nothing here is built yet

## Overview

pgsketch 0.1.0 is a Linux app that ships as a `.deb`. This plan makes it run on Windows 10 and 11 (x64) and ship as an installer, without changing what the app does. The core, the editor and the database code are already portable; what is left is a short list of places that assume Linux, plus packaging, release and test work. Each item below says what is wrong, what to do about it, and how it is tested.

### Goals

- Windows 10 (1809) and 11, x64, installed per user from a `pgsketch_<version>_x64_setup.exe` with a Start menu entry and an uninstaller.
- Everything in the 0.1.0 loop works: connect over TCP with SSL, edit, generate, validate, copy and save, change detection, saved connections with an encrypted password, drafts and layouts across restarts.
- The Linux build, its `.deb` and its tests stay exactly as they are.
- CI builds, tests and smoke-tests the Windows installer on every push that touches the app.

### Non-goals

- macOS. Most of this work is shared with it (the keyring check, the data folder, the missing socket, the app ID), and a `mac` target would be a small follow-up, but it needs notarisation and a Mac to test on, so it is not part of this plan.
- Windows on ARM, MSI, Microsoft Store, auto-update, winget and Chocolatey packages.
- The Unix-socket connection on Windows. Postgres for Windows does not support it.
- Running the Docker-based database tests on Windows.

## What is already portable

Checked in the code, so it is not on the list below:

- **No native modules.** The main process depends on `pg` (pure JavaScript), `pg-connection-string`, `zod` and `@electron-toolkit/utils`. SQLite is `node:sqlite`, built into Electron's Node. Nothing needs `node-gyp` or a prebuilt binary per platform.
- **`packages/core`** has no Electron, React or `pg` in it, and does no file or process work.
- **The window and menu code** already branches on `darwin` for quitting, and the app has `autoHideMenuBar`.
- **Single instance** uses Electron's lock, which works on Windows and is keyed by the user-data folder.
- **The save dialog** goes through Electron, and the suggested name (`20261101_120000_pgsketch.sql`) has no character Windows refuses.
- **File modes** (`0o700` for folders, `0o600` for the log) are accepted and ignored on Windows. That is harmless: the data folder will be under the user's own profile, whose default permissions already keep other users out.
- **SSL, TCP connections, `localhost`** (`isLocalHost` already lists `::1`) and the connection form need no change.

## Decisions to settle first

| Question                                  | Recommendation                                                                                                                                    | Why                                                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installer format                          | NSIS, per user (no administrator prompt), directory choosable                                                                                     | It is electron-builder's default and best-supported target, installs under `%LOCALAPPDATA%\Programs`, and needs no elevation to install or update.     |
| Where app data goes                       | `%LOCALAPPDATA%\pgsketch` (data and log together)                                                                                                 | Saved connections and drafts belong to one machine. `%APPDATA%` roams between machines on a domain, which would copy an encrypted password to where it cannot be decrypted. |
| Code signing for the first Windows release | Ship unsigned, say so in the README, and apply for free open-source signing (SignPath Foundation) right after                                    | A certificate costs money and time; SmartScreen's warning is a nuisance, not a block. Signing is a release-time switch that changes no code.            |
| License | MIT, in the repository since Nov 2, 2026 (`LICENSE`, the `license` field of the three `package.json` files, a README section) | Permissive and free to use, accepted by SignPath's free signing for open-source projects, and compatible with every dependency (elkjs is dual-licensed EPL-2.0 or GPL-3.0-or-later). |
| What the Windows CI job runs              | Lint, typecheck, unit and component tests, the installer build, and a packaged smoke test. Not the Docker tests                                    | GitHub's Windows runners cannot run Linux containers, which Testcontainers needs. The Linux jobs already cover the database code on 14 to 18.            |
| Keep the dev scripts in bash              | No: write the two that a contributor needs (`dev:tmp`, the dev database) in Node. Leave `check-deb.sh` (Linux only) and `make-icons.sh` as bash    | A Windows contributor should be able to run `pnpm dev` and `pnpm db:setup` without WSL.                                                                 |

## Work items

### W1. Platform decisions as parameters, not as scattered `process.platform` checks

**Problem.** The Linux assumptions are in four files. Branching on `process.platform` inside each makes them hard to test on a Linux CI machine.

**Solution.** Follow the style the code already has: `resolveAppPaths(env, home)` and `createSecrets(storage, isReady)` take their inputs as arguments, so tests pass fakes. Add a `platform: NodeJS.Platform = process.platform` argument to the functions that differ, and test every platform from any machine. No new abstraction layer, no `platform.ts` module.

**Test.** Each function below gets table-driven unit tests for `linux`, `win32` and `darwin`.

### W2. Remembering passwords (`main/services/secrets.ts`)

**Problem.** A password is stored only when `safeStorage.getSelectedStorageBackend()` names a real Linux keyring (`gnome_libsecret`, `kwallet*`). The Electron documentation marks that method as Linux-only, so on Windows it is most likely undefined and the call would throw when someone ticks "Remember this connection". Even if it returned something, the Linux list would not contain it, and a Windows user would never be able to save a password.

**Solution.** Keep the Linux rule as it is, and add a platform argument:

- `linux`: unchanged. `basic_text` and `unknown` still refuse, since they protect nothing.
- `win32` and `darwin`: `isEncryptionAvailable()` alone decides. On Windows, `safeStorage` uses DPAPI, which ties the ciphertext to the signed-in Windows user. That is the system keyring for this purpose.

`problem()` returns the same three reasons. The user-facing wording ("system keyring") stays true on Windows, where it means the Windows credential protection, and the README says that in one line.

**Files.** `src/main/services/secrets.ts`, its test, and the place in `main/index.ts` that builds it (it passes `process.platform`).

**Test.** The existing tests plus: on `win32` with encryption available, the password is stored and read back; on `win32` with encryption unavailable, it is refused as `unavailable`; the backend method is never called off Linux (the fake throws if it is).

**Manual check on Windows.** Save a connection with a password, quit, start the app, open the saved connection without typing the password, and confirm `pgsketch.db` holds no readable password.

### W3. Data and log folders (`main/paths.ts`, `main/log.ts`)

**Problem.** The data folder is `~/.local/share/pgsketch` and the log is `~/.local/state/pgsketch/main.log`, following the XDG variables. On Windows this would work and put them in `C:\Users\you\.local\…`, a folder no Windows tool looks in, and next to nothing a user would know to back up or delete.

**Solution.** Resolve by platform:

| Platform | Data folder (`pgsketch.db`)       | Log                                              |
| -------- | --------------------------------- | ------------------------------------------------ |
| linux    | unchanged                         | unchanged                                        |
| win32    | `%LOCALAPPDATA%\pgsketch`         | `%LOCALAPPDATA%\pgsketch\logs\main.log`          |
| darwin   | `~/Library/Application Support/pgsketch` (not built, listed so the table is complete) | `~/Library/Logs/pgsketch/main.log` |

`PGSKETCH_DATA_DIR` keeps overriding everything, which is how the end-to-end tests isolate themselves. If `LOCALAPPDATA` is unset or not absolute, fall back to `join(home, 'AppData', 'Local')`. `defaultLogPath` and `resolveAppPaths` already take `env` and `home`; add `platform` to both, and make `defaultLogPath` return the Windows path above so the two never disagree.

**Files.** `paths.ts`, `log.ts` and their tests. `join` already produces backslashes on Windows, so no path strings are built by hand.

**Test.** Unit tests per platform with Windows-style inputs run through `path.win32` so they pass on Linux CI. A Windows CI run of the same tests catches anything that differs for real.

### W4. The Unix socket (`index.ts`, Connect screen, `shared/`)

**Problem.** The Connect screen offers a "Unix socket" mode, with the default folder `/var/run/postgresql`, the OS username as the default user and peer authentication. The IPC contract and `isLocalHost` mark a host that starts with `/` as a socket. Postgres on Windows has no Unix sockets, so the mode cannot work there and must not be offered.

**Solution.** Hide it, rather than remove it:

1. The main process tells the renderer whether this machine has sockets through the `connection.defaults` channel the Connect screen already calls once on load, which carries `osUser` and `socketPath` today. `socketPath` becomes `string | null`, and Windows answers `null`. The renderer never reads the platform itself (its sandbox has no `process.platform`), and no new channel is needed.
2. The Connect screen builds its mode switch from that list: host and port, and connection string, on Windows; plus socket on Linux.
3. Saved connections made with a socket (a database file moved from Linux) cannot be opened on Windows: show them greyed in the recent list with "Unix sockets are not available on Windows" and keep them.
4. `socketPath: '/var/run/postgresql'` in `index.ts` and `test-deps.ts` stays as the Linux default; on Windows it is simply never read.
5. The zod schema keeps `startsWith('/')` for the socket host. It validates the data, not the platform.

**Files.** `shared/ipc-contract.ts` (the app-info shape), `main/index.ts`, `screens/Connect/*`, and the Connect screen tests.

**Test.** Component tests: with `socketPath: null` the socket mode is not in the document and a saved socket connection is disabled with the reason. End to end on Linux: the socket mode is still there.

### W5. App identity and icon (`main/index.ts`, `electron-builder.yml`)

**Problem.** `setAppUserModelId('com.electron')` is a leftover of the project template. On Windows this ID decides how the taskbar groups windows and names the app in notifications and jump lists; it should be the real app ID. The window icon is set only on Linux.

**Solution.**

- One constant, `APP_ID = 'io.github.pratikdev.pgsketch'`, in `src/shared`. `main/index.ts` passes it to `setAppUserModelId`. A unit test reads `electron-builder.yml` as text and fails if its `appId` line is not the same string, so the two cannot drift.
- Icon: electron-builder builds the `.exe` and installer icon from `build/icon.png` (1024 px, above its 256 px minimum), so no `.ico` is checked in. Keep passing `icon` to `BrowserWindow` on Linux only: on Windows the executable's own icon is used for the window and the taskbar, so passing a PNG as well adds nothing.
- Window title and `autoHideMenuBar` stay as they are.

**Test.** The unit test above. Manual: pin the app to the taskbar, relaunch from the pin, and confirm one icon, the right name and the right icon.

### W6. The Windows build (`electron-builder.yml`, `package.json`)

**Problem.** Only a `linux` target (`deb`) exists, with Linux-only keys (`desktopName`, `syncDesktopName`, the `.desktop` entry, apt dependencies). The `package` script is `--linux deb`.

**Solution.** Add a `win` section and an `nsis` section, and leave the `linux` and `deb` sections untouched:

```yaml
win:
  target:
    - target: nsis
      arch: [x64]
  artifactName: pgsketch_${version}_x64_setup.${ext}
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  deleteAppDataOnUninstall: false
```

- `deleteAppDataOnUninstall: false` matches the Linux behaviour (`apt remove` keeps saved connections and drafts) and the README says so for both.
- The global `artifactName` (`pgsketch_${version}_${arch}.${ext}`) is for the `.deb`; the `win.artifactName` above overrides it, so the `.deb` keeps its name.
- Scripts: `package` stays the Linux one so CI and the README do not change. Add `package:win` (`pnpm build && electron-builder --win nsis`).
- Build the installer on a `windows-latest` runner. Building NSIS from Linux needs Wine, which is slow and a source of odd failures.
- The `files` list (`out/**`, `package.json`) is already platform-neutral.
- Ship the licence texts with both packages: `LICENSE` (MIT) and the Geist font's `OFL.txt` (the SIL Open Font License asks for its text to travel with the font) go next to the executable through `extraFiles`, for the Windows installer and for the `.deb`. The `.deb` check and the Windows smoke test (W8) each assert that both files are there.

**Test.** CI builds it (W8). A local build on a Windows machine, or a VM, is the first manual check.

### W7. Signing and SmartScreen

**Problem.** An unsigned installer shows "Windows protected your PC" until enough people have run it. A signed one with a trusted certificate avoids it.

**Solution, in two steps.**

1. **First Windows release: unsigned.** The README's install section says to click "More info" and "Run anyway", and publishes the SHA-256 of the installer next to the download so it can be checked.
2. **Then sign.** Apply to SignPath Foundation, which signs open-source projects for free; failing that, Azure Trusted Signing. electron-builder takes the signing configuration from environment variables, so signing is a CI secret and a workflow step, with no change to the app or the build file. Never commit a certificate or a password.

**Licence.** SignPath's free signing needs a public repository under an OSI-approved licence. pgsketch has been MIT since Nov 2, 2026, so that is met, and the application can be sent as soon as there is a first Windows release to point at. Approval can still take weeks, which is why the first release ships unsigned.

### W8. CI and release (`.github/workflows`)

**Problem.** Every job runs on `ubuntu-latest`, and the `package` job builds and installs the `.deb` only.

**Solution.** Add jobs; change none of the existing ones.

| Job                | Runner           | Does                                                                                                                                                                  |
| ------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check-windows`    | `windows-latest` | `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`. Catches path-separator and line-ending problems that Linux cannot see.                  |
| `package-windows`  | `windows-latest` | `pnpm package:win`; uploads `pgsketch-setup` as an artifact; runs the smoke test below.                                                                               |

**Packaged smoke test on Windows.** The Linux job installs the `.deb` and runs `e2e/packaged.spec.ts` with `PGSKETCH_EXECUTABLE=/opt/pgsketch/pgsketch`. For Windows:

1. Run the installer silently: `pgsketch_<version>_x64_setup.exe /S`. The per-user install goes to `%LOCALAPPDATA%\Programs\pgsketch`.
2. Run the same spec with `PGSKETCH_EXECUTABLE` set to `…\pgsketch.exe`. It already checks that the packaged app opens the Connect screen and quits with exit code 0.
3. Check that `LICENSE` and `OFL.txt` are in the program folder.
4. Run the uninstaller silently (`Uninstall pgsketch.exe /S`) and check the program folder is gone and the data folder is not.

**Release.** The `v0.1.0` release was made by hand from the CI-built `.deb`. Keep that shape: a Windows release attaches both artifacts from green runs of the tagged commit. A `release` workflow can come later; it is not needed for this plan.

**Test.** The jobs are the test. They must pass on a branch before merging.

### W9. Scripts (`package.json`, `apps/desktop/scripts`)

**Problem.** `dev:tmp` uses `$(mktemp -d)`, and `dev-db.sh` is bash with `grep` and `docker exec -i … <file` redirection. Neither runs in `cmd` or PowerShell. `check-deb.sh` is Linux by nature. `make-icons.sh` needs `ffmpeg` and bash.

**Solution.**

- **`dev:tmp`**: replace with `node apps/desktop/scripts/dev-tmp.ts`, which makes a temporary folder with `fs.mkdtempSync(join(os.tmpdir(), 'pgsketch-'))`, sets `PGSKETCH_DATA_DIR` and runs the dev server. About fifteen lines.
- **`dev-db.sh`**: port to `dev-db.ts`, keeping the same `up`, `load`, `down` verbs, the same container name and the same wait for the second "ready to accept connections" line. Use `child_process.spawnSync('docker', …)` and pipe the fixture file into `docker exec -i` from Node, so there is no shell redirection. Root `package.json` scripts change only their file names. This needs Docker Desktop on Windows, which the README already lists as a requirement.
- **`check-deb.sh`**: untouched. It tests the `.deb`, so it is Linux only. The Windows counterpart is the smoke test in W8.
- **`make-icons.sh`**: untouched. It makes the Linux theme sizes (hicolor); the Windows build does not use its output. It stays documented as Linux and ffmpeg only.
- **Node runs the scripts as TypeScript.** Node 24 strips types by itself, so `dev-db.ts` and `dev-tmp.ts` need no build step, and the unit test imports `dev-db.ts` directly. `apps/desktop/scripts/package.json` sets `"type": "module"` for that folder only, which avoids a warning without changing how the rest of the app is loaded.
- **`dev-db`'s Node port is covered by a unit test** that only checks argument building, not Docker itself, as the bash script has none today.

### W10. Line endings and formatting

**Problem.** There is no `.gitattributes`. On a Windows checkout with `core.autocrlf=true`, files arrive with CRLF and `prettier --check` (Prettier's default is `endOfLine: "lf"`) reports every file. The bash scripts also break with CRLF (`bad interpreter`).

**Solution.** Add a `.gitattributes` with `* text=auto eol=lf` and mark binaries (`*.png`, `*.gif`, `*.mp4`, `*.woff2` as `binary`). Do not change the Prettier config. After adding it, a fresh Windows clone has LF files regardless of the user's `autocrlf`, and `pnpm lint` passes unchanged.

### W11. Tests that assume Linux

**Problem.** A few things in the test setup are Linux-shaped.

| Where                   | Assumption                                                                                          | Fix                                                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `e2e/app.ts`            | `electronPath` is `node_modules/electron/dist/electron`, and `spawnApp` passes `--no-sandbox`        | Use `electron.exe` on Windows (`process.platform === 'win32'`); pass `--no-sandbox` only on Linux, where CI needs it.                                              |
| `e2e/*` and CI          | The e2e tests start Postgres with Testcontainers; `xvfb` provides a display                          | Stay on Linux CI. On Windows run only the unit, component and packaged tests (W8). A later step can point the e2e tests at the runner's preinstalled PostgreSQL, but that is separate work and not assumed here. |
| Unit tests with paths   | Some build expected paths with `/` or read `XDG_*`                                                   | Run the whole unit suite on `windows-latest` (W8) and fix what differs; expected values should be built with `path.join`, and platform cases with `path.win32` / `path.posix`. |
| `e2e/screenshots.spec.ts`, `recordings.spec.ts` | Gated, need `ffmpeg` and a display                                                  | Linux only, unchanged. Documented as such.                                                                                                                         |

### W12. Documentation

- **README.** The opening line becomes "a desktop app for Linux and Windows". The Install section gets a Windows part (download the `_setup.exe`, SmartScreen note, per-user install, how to uninstall, what uninstalling keeps), and the data-folder table gets a Windows column. "Connect" says the Unix-socket option is Linux only. The keyring sentence names Windows' own credential protection.
- **License.** Done: the README ends with a License section (MIT, and the font's licence), and the packaged licence texts are W6. The Windows install section links to `LICENSE`. The film and any music file are not in the repository (see `docs/DECISIONS.md`), so nothing in `docs/media/` needs a separate licence note.
- **Build plan.** The Decisions table row "Platform" changes from "Linux; packaged as `.deb` only" to the real state after this ships, and the Non-goals line "Packaging other than `.deb`; platforms other than Linux" is updated.
- **`docs/DECISIONS.md`.** One entry per settled item in the decisions table above, with the date and the reason.

## Phases

Each phase ends with a passing test, as in the build plan. **Status** is kept up to date as work goes.

| Phase | What                                                                                       | Ends when                                                                                 | Status |
| ----- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------ |
| W-A   | W1 to W3, W5 (the constant), W10: platform arguments, keyring rule, data folder, `.gitattributes` | Unit tests for the three platforms pass on Linux CI, and `check-windows` runs green once it exists | done |
| W-B   | W4: socket mode hidden on Windows                                                          | The Connect-screen component tests pass for both answers, and the Linux e2e Connect tests are unchanged | done |
| W-C   | W6, W8, W11: Windows build, CI jobs, launcher fixes                                        | `package-windows` builds the installer, installs it silently, and the packaged smoke test passes | working |
| W-D   | W9: Node ports of `dev:tmp` and the dev database                                           | `pnpm dev:tmp` and `pnpm db:setup` run on Windows and Linux                              | done |
| W-E   | Manual pass on a real Windows 10 and 11 machine (below)                                    | The checklist is clean, or each failure has a fix or a logged limit                       | todo   |
| W-F   | W7, W12: README, plan and decisions updated, first signed or unsigned release              | A Windows installer is attached to a release, with its SHA-256                           | todo   |

W-A to W-D can run in order on a Linux machine with CI doing the Windows part. **State:** W-A, W-B and W-D are built and tested on Linux. W-C is built (the `.deb` check passes with the licence files in it, and the builder accepts the Windows configuration) but the two Windows CI jobs have not run yet: it is `done` once they are green on a push. W-E needs Windows hardware or a VM and cannot be replaced by CI.

## Manual checklist for a Windows machine

Things CI cannot see:

- Install per user without an administrator prompt; Start menu entry and icon; uninstall keeps `%LOCALAPPDATA%\pgsketch`.
- Taskbar: one icon when pinned and relaunched, correct name and icon.
- High-DPI (150% and 200% scaling) and a second monitor: canvas, popovers, tooltips (Radix portals) and the SQL panel.
- Connect over TCP to a local Postgres (installer or Docker Desktop) and to a remote one with `require` and `verify-full`.
- Save a connection with a password, restart, reopen it; the data folder holds no readable password.
- Drafts and layouts across a restart; a second launch hands over to the first window.
- Generate SQL, Validate, Copy (paste into another app) and Save (dialog opens in the last folder).
- The poller notices a change made from `psql` while the window is open and when it regains focus.
- Windows Defender or another antivirus does not lock or quarantine `pgsketch.db`.
- A very long user name or a path under OneDrive for the data folder (`PGSKETCH_DATA_DIR`) does not break the log or the database.

## Risks

| Risk                                                                                          | Mitigation                                                                                                                                               |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `safeStorage` behaves differently on Windows than assumed                                      | W2 isolates it behind the existing `SafeStorageLike` interface, tests the three platforms with fakes, and the manual checklist covers the real call.     |
| A Windows-only bug that Linux CI cannot show                                                   | `check-windows` and the packaged smoke test run the real code on Windows on every push; the manual pass covers what they cannot.                         |
| The Windows installer cannot be tested in Docker, so a broken release goes unnoticed           | The silent install, launch and uninstall in `package-windows` are the release gate.                                                                       |
| Unsigned installers scare users off                                                           | Say so plainly in the README, publish the hash, and pursue free signing straight after the first release.                                                 |
| Window rendering differs on Windows (fonts, scaling, scrollbars)                               | The manual high-DPI pass. The UI is Chromium on both platforms, so differences should be small, but the canvas has not been looked at on Windows yet.     |
| Scope creep into macOS and ARM                                                                 | They are listed as non-goals; W1 and W3 are written so adding them later is a table row each.                                                             |
| The Linux build regresses                                                                      | No existing job or script is changed, only added to; every Linux unit test stays in place and runs unchanged.                                              |

## After this

- **macOS:** a `mac` target, notarisation, the `darwin` rows already in W2 and W3, and a Mac to test on.
- **Windows e2e:** run the Playwright suite on `windows-latest` against its preinstalled PostgreSQL.
- **Windows on ARM and a Store or winget listing:** when people ask for them.
- **Auto-update:** a decision for all platforms together, not only this one.
