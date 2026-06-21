// SPDX-FileCopyrightText: 2026 na0x2c6
// SPDX-License-Identifier: GPL-2.0-or-later

import St from 'gi://St';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const CLIPBOARD = St.ClipboardType.CLIPBOARD;
const PANEL_ICON = 'object-flip-horizontal-symbolic';

// Drive mapping styles (set via preferences):
//   'wsl'   -> /mnt/c/...   <->  C:\...
//   'msys'  -> /c/...       <->  C:\...   (Git Bash / MSYS2)
//   'plain' -> c:/...       <->  C:\...   (slash swap only, keep drive)
// UNC \\server\share <-> smb://server/share

function driveToUnix(letter, rest, style) {
    const d = letter.toLowerCase();
    const r = rest.replace(/\\/g, '/');
    if (style === 'wsl')
        return `/mnt/${d}/${r}`;
    if (style === 'msys')
        return `/${d}/${r}`;
    return `${d}:/${r}`;
}

function driveToWindows(letter, rest) {
    return `${letter.toUpperCase()}:\\${rest.replace(/\//g, '\\')}`;
}

function toUnix(text, style) {
    return text.split('\n').map(line => unixLine(line, style)).join('\n');
}

function unixLine(line, style) {
    // \\?\UNC\server\share\...  ->  smb://server/share/...
    let m = line.match(/^\\\\\?\\UNC\\(.+)$/i);
    if (m)
        return 'smb://' + m[1].replace(/\\/g, '/');

    // \\?\C:\...  ->  drive mapping
    m = line.match(/^\\\\\?\\([A-Za-z]):[\\/](.*)$/);
    if (m)
        return driveToUnix(m[1], m[2], style);

    // \\server\share\...  ->  smb://server/share/...
    m = line.match(/^\\\\(.+)$/);
    if (m)
        return 'smb://' + m[1].replace(/\\/g, '/');

    // C:\...  ->  drive mapping
    m = line.match(/^([A-Za-z]):[\\/](.*)$/);
    if (m)
        return driveToUnix(m[1], m[2], style);

    return line.replace(/\\/g, '/');
}

function toWindows(text) {
    return text.split('\n').map(windowsLine).join('\n');
}

function windowsLine(line) {
    // smb://server/share/... (also accepts //server/share/...)  ->  \\server\share\...
    let m = line.match(/^smb:\/\/(.+)$/i) || line.match(/^\/\/(.+)$/);
    if (m)
        return '\\\\' + m[1].replace(/\//g, '\\');

    // /mnt/c/...  ->  C:\...
    m = line.match(/^\/mnt\/([A-Za-z])\/(.*)$/);
    if (m)
        return driveToWindows(m[1], m[2]);

    // /c/...  ->  C:\...
    m = line.match(/^\/([A-Za-z])\/(.*)$/);
    if (m)
        return driveToWindows(m[1], m[2]);

    return line.replace(/\//g, '\\');
}

const TERMINAL_RE =
    /terminal|console|ptyxis|konsole|kitty|alacritty|foot|tilix|wezterm|xterm/i;

export default class PasteModifierExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._seat = Clutter.get_default_backend().get_default_seat();
        this._keyboard = this._seat.create_virtual_device(
            Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this._timeouts = new Set();
        this._settingsIds = [];

        Main.wm.addKeybinding(
            'paste-unix', this._settings,
            Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL,
            () => this._convertAndPaste('unix'));

        Main.wm.addKeybinding(
            'paste-windows', this._settings,
            Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL,
            () => this._convertAndPaste('windows'));

        this._buildIndicator();
    }

    disable() {
        Main.wm.removeKeybinding('paste-unix');
        Main.wm.removeKeybinding('paste-windows');
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];
        this._indicator?.destroy();
        this._indicator = null;
        this._toast?.destroy();
        this._toast = null;
        this._keyboard = null;
        this._seat = null;
        this._settings = null;
    }

    _buildIndicator() {
        const indicator = new PanelMenu.Button(0.0, 'Paste Modifier', false);
        indicator.add_child(new St.Icon({
            icon_name: PANEL_ICON,
            style_class: 'system-status-icon',
        }));

        this._addToggle(indicator.menu, 'restore-clipboard', 'Restore clipboard');
        this._addToggle(indicator.menu, 'notify-on-paste', 'Notify on paste');

        indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const settingsItem = new PopupMenu.PopupImageMenuItem(
            'Settings\u2026', 'emblem-system-symbolic');
        settingsItem.connect('activate', () => this.openPreferences());
        indicator.menu.addMenuItem(settingsItem);

        Main.panel.addToStatusArea(this.uuid, indicator);
        this._indicator = indicator;
    }

    _addToggle(menu, key, label) {
        const item = new PopupMenu.PopupSwitchMenuItem(
            label, this._settings.get_boolean(key));
        item.connect('toggled', (_i, state) =>
            this._settings.set_boolean(key, state));
        this._settingsIds.push(this._settings.connect(`changed::${key}`, () =>
            item.setToggleState(this._settings.get_boolean(key))));
        menu.addMenuItem(item);
    }

    _convertAndPaste(target) {
        const style = this._settings.get_string('style');
        const delay = this._settings.get_int('paste-delay');
        const restore = this._settings.get_boolean('restore-clipboard');
        const label = target === 'unix' ? 'UNIX path pasted' : 'Windows path pasted';
        const clipboard = St.Clipboard.get_default();
        const mimetypes = clipboard.get_mimetypes(CLIPBOARD);

        if (mimetypes.some(m => m.startsWith('text/plain'))) {
            clipboard.get_text(CLIPBOARD, (cb, text) => {
                if (!text)
                    return;
                const converted = target === 'unix' ? toUnix(text, style) : toWindows(text);
                this._emitPaste(converted, delay, restore ? text : null, label);
            });
            return;
        }

        // File-manager copies expose file:// URIs but no text/plain. This path
        // cannot restore the original clipboard.
        const uriType = mimetypes.includes('x-special/gnome-copied-files')
            ? 'x-special/gnome-copied-files'
            : mimetypes.includes('text/uri-list') ? 'text/uri-list' : null;
        if (!uriType)
            return;

        clipboard.get_content(CLIPBOARD, uriType, (cb, bytes) => {
            const data = bytes?.get_data();
            if (!data || data.length === 0)
                return;
            const converted = this._urisToText(data, uriType, target, style);
            if (converted)
                this._emitPaste(converted, delay, null, label);
        });
    }

    _urisToText(data, mimetype, target, style) {
        let lines = new TextDecoder().decode(data).split('\n');
        if (mimetype === 'x-special/gnome-copied-files')
            lines = lines.slice(1);  // drop the "copy"/"cut" operation token
        const out = [];
        for (let line of lines) {
            line = line.trim();
            if (!line || line.startsWith('#'))
                continue;
            let path = line;
            if (line.startsWith('file://'))
                path = Gio.File.new_for_uri(line).get_path() || line;
            out.push(target === 'unix' ? toUnix(path, style) : toWindows(path));
        }
        return out.join('\n');
    }

    _emitPaste(text, delay, original, label) {
        const clipboard = St.Clipboard.get_default();
        clipboard.set_text(CLIPBOARD, text);
        // The trigger modifiers (Alt/Shift) are still held when this runs, so a
        // synthesized Ctrl+V would arrive as Ctrl+Alt+V. Wait until they are
        // released, then let the new clipboard offer settle, then paste.
        this._whenModifiersReleased(() => {
            this._delay(delay, () => {
                this._sendPaste();
                if (original !== null)
                    this._delay(180, () => clipboard.set_text(CLIPBOARD, original));
                this._maybeNotify(label);
            });
        });
    }

    _whenModifiersReleased(fn) {
        const mask = Clutter.ModifierType.SHIFT_MASK |
            Clutter.ModifierType.CONTROL_MASK |
            Clutter.ModifierType.MOD1_MASK |
            Clutter.ModifierType.SUPER_MASK;
        let attempts = 0;
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
            const [, , mods] = global.get_pointer();
            if ((mods & mask) === 0 || ++attempts > 100) {
                this._timeouts.delete(id);
                fn();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        this._timeouts.add(id);
    }

    _maybeNotify(label) {
        if (!this._settings.get_boolean('notify-on-paste'))
            return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        this._toast?.destroy();
        const toast = new St.Label({style_class: 'paste-modifier-toast', text: label});
        toast.opacity = 0;
        Main.layoutManager.uiGroup.add_child(toast);
        this._toast = toast;

        const [, width] = toast.get_preferred_width(-1);
        const [, height] = toast.get_preferred_height(-1);
        toast.set_position(
            monitor.x + Math.floor((monitor.width - width) / 2),
            monitor.y + Math.floor(monitor.height * 0.75 - height / 2));

        toast.ease({
            opacity: 255,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => toast.ease({
                opacity: 0,
                delay: 900,
                duration: 400,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (this._toast === toast)
                        this._toast = null;
                    toast.destroy();
                },
            }),
        });
    }

    _delay(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeouts.delete(id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
    }

    _sendPaste() {
        const win = global.display.focus_window;
        const isTerminal = win ? TERMINAL_RE.test(win.get_wm_class() || '') : false;

        let t = GLib.get_monotonic_time();  // microseconds
        const tap = (keyval, state) => {
            this._keyboard.notify_keyval(t, keyval, state);
            t += 1;
        };

        tap(Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
        if (isTerminal)
            tap(Clutter.KEY_Shift_L, Clutter.KeyState.PRESSED);
        tap(Clutter.KEY_v, Clutter.KeyState.PRESSED);
        tap(Clutter.KEY_v, Clutter.KeyState.RELEASED);
        if (isTerminal)
            tap(Clutter.KEY_Shift_L, Clutter.KeyState.RELEASED);
        tap(Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
    }
}
