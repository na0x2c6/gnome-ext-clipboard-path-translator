<!--
SPDX-FileCopyrightText: 2026 na0x2c6
SPDX-License-Identifier: GPL-2.0-or-later
-->

# Paste Modifier

A GNOME Shell extension that pastes clipboard text as a file path converted
to UNIX or Windows format with a dedicated shortcut.

- `Alt`+`V` — paste, converting the clipboard path to UNIX format.
- `Alt`+`Shift`+`V` — paste, converting the clipboard path to Windows format.

Both shortcuts and all options are configurable.

## ⚠️ Pre-release status

This extension is **under active development** and has not been published yet.

- Behavior, settings keys, and the schema may change without notice.
- **The `main` branch may be force-pushed.** Do not rely on a stable history;
  pin to a specific commit if you depend on a particular state.

## Features

- Converts Windows drive paths to/from UNIX paths, with a selectable mapping
  style (WSL `/mnt/c`, MSYS `/c`, or plain `c:/`).
- Converts UNC paths (`\\server\share`) to/from `smb://server/share`, including
  the extended-length forms `\\?\UNC\...` and `\\?\C:\...`.
- Converts file-manager file copies (URI lists) into converted path text.
- Optional on-screen notification after each paste.
- Optional restoration of the original clipboard contents after pasting.
- Panel indicator with quick toggles and a button to open full preferences.

## Requirements

- GNOME Shell 50 (e.g. Fedora 44).
- A Wayland session. Pasting is performed by synthesizing key events through a
  Clutter virtual device, which is provided by the compositor.

## Installation (from source)

```bash
UUID="paste-modifier@na0x2c6.com"
EXT="$HOME/.local/share/gnome-shell/extensions/$UUID"

mkdir -p "$EXT"
cp -r extension.js prefs.js metadata.json stylesheet.css schemas "$EXT/"
glib-compile-schemas "$EXT/schemas"
```

Log out and back in (a Wayland session cannot reload GNOME Shell in place),
then enable the extension:

```bash
gnome-extensions enable paste-modifier@na0x2c6.com
gnome-extensions prefs paste-modifier@na0x2c6.com   # open settings
```

## Usage

1. Copy a file path (or copy files in a file manager).
2. Focus the target application.
3. Press `Alt`+`V` for UNIX format or `Alt`+`Shift`+`V` for Windows format.

The trigger shortcut is consumed by the extension; the actual paste is then
synthesized as `Ctrl`+`V` (or `Ctrl`+`Shift`+`V` when the focused window looks
like a terminal). The extension waits until the trigger modifier keys are
released before synthesizing the paste.

## Settings

All settings are available in the preferences dialog and the panel menu
(toggles only).

| Setting | Key | Default |
| --- | --- | --- |
| Paste as UNIX path | `paste-unix` | `Alt`+`V` |
| Paste as Windows path | `paste-windows` | `Alt`+`Shift`+`V` |
| Drive mapping style | `style` | `wsl` |
| Restore clipboard after paste | `restore-clipboard` | `true` |
| Notify on paste | `notify-on-paste` | `true` |
| Paste delay (ms) | `paste-delay` | `60` |

## Conversion reference

| Windows | UNIX (`wsl`) | UNIX (`msys`) | UNIX (`plain`) |
| --- | --- | --- | --- |
| `C:\Users\foo` | `/mnt/c/Users/foo` | `/c/Users/foo` | `c:/Users/foo` |
| `\\server\share\x` | `smb://server/share/x` | `smb://server/share/x` | `smb://server/share/x` |

Conversion is line-based, so multi-line path lists are supported.

## Known limitations

- Wayland only.
- The synthesized paste assumes `Ctrl`+`V` (or `Ctrl`+`Shift`+`V` for
  terminals, detected heuristically by window class). Applications with other
  paste shortcuts are not handled.
- File-manager copies expose `text/uri-list` / `x-special/gnome-copied-files`
  but no `text/plain`. These are pasted as converted text, and the original
  clipboard contents cannot be restored in that case.

## Publishing TODO

- [ ] Add `version-name` (semantic version) and `url` (repository) to `metadata.json`.
- [ ] Confirm SPDX headers are present in every source file.
- [ ] Lint with the GNOME Shell ESLint config (or an EGO compliance checker).
- [ ] Verify clean enable/disable with no leaked timeouts, signal handlers, or actors (Looking Glass).
