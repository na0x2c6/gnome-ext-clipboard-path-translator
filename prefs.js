// SPDX-FileCopyrightText: 2026 na0x2c6
// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const ShortcutRow = GObject.registerClass(
class ShortcutRow extends Adw.ActionRow {
    _init(settings, key, title) {
        super._init({title});
        this._settings = settings;
        this._key = key;

        this._shortcutLabel = new Gtk.ShortcutLabel({
            valign: Gtk.Align.CENTER,
            disabled_text: 'Disabled',
        });
        this.add_suffix(this._shortcutLabel);

        const editButton = new Gtk.Button({
            icon_name: 'document-edit-symbolic',
            valign: Gtk.Align.CENTER,
            has_frame: false,
            tooltip_text: 'Change shortcut',
        });
        editButton.connect('clicked', () => this._capture());
        this.add_suffix(editButton);
        this.activatable_widget = editButton;

        this._sync();
        this._changedId = settings.connect(`changed::${key}`, () => this._sync());
        this.connect('destroy', () => {
            if (this._changedId) {
                settings.disconnect(this._changedId);
                this._changedId = 0;
            }
        });
    }

    _sync() {
        const accels = this._settings.get_strv(this._key);
        this._shortcutLabel.set_accelerator(accels.length ? accels[0] : '');
    }

    _capture() {
        const dialog = new Adw.Window({
            modal: true,
            transient_for: this.get_root(),
            default_width: 420,
            default_height: 170,
            title: 'Set Shortcut',
        });

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            valign: Gtk.Align.CENTER,
            margin_top: 24, margin_bottom: 24, margin_start: 24, margin_end: 24,
        });
        box.append(new Gtk.Label({
            label: 'Press the new shortcut.\nEsc to cancel, Backspace to clear.',
            justify: Gtk.Justification.CENTER,
        }));
        dialog.set_content(box);

        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_c, keyval, keycode, state) => {
            let mask = state & Gtk.accelerator_get_default_mod_mask();
            mask &= ~Gdk.ModifierType.LOCK_MASK;

            if (keyval === Gdk.KEY_Escape && mask === 0) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            if (keyval === Gdk.KEY_BackSpace && mask === 0) {
                this._settings.set_strv(this._key, []);
                dialog.close();
                return Gdk.EVENT_STOP;
            }

            const isFunctionKey = keyval >= Gdk.KEY_F1 && keyval <= Gdk.KEY_F35;
            if (mask === 0 && !isFunctionKey)
                return Gdk.EVENT_STOP;
            if (!Gtk.accelerator_valid(keyval, mask))
                return Gdk.EVENT_STOP;

            const accel = Gtk.accelerator_name_with_keycode(
                Gdk.Display.get_default(), keyval, keycode, mask);
            this._settings.set_strv(this._key, [accel]);
            dialog.close();
            return Gdk.EVENT_STOP;
        });
        dialog.add_controller(controller);
        dialog.present();
    }
});

export default class PasteModifierPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        window.add(page);

        const shortcuts = new Adw.PreferencesGroup({title: 'Shortcuts'});
        page.add(shortcuts);
        shortcuts.add(new ShortcutRow(settings, 'paste-unix', 'Paste as UNIX path'));
        shortcuts.add(new ShortcutRow(settings, 'paste-windows', 'Paste as Windows path'));

        const conversion = new Adw.PreferencesGroup({title: 'Conversion'});
        page.add(conversion);

        const styleIds = ['wsl', 'msys', 'plain'];
        const styleRow = new Adw.ComboRow({
            title: 'Drive mapping style',
            subtitle: 'C:\\ ↔ /mnt/c (WSL), /c (MSYS), or c:/ (Plain)',
            model: new Gtk.StringList({
                strings: ['WSL  (/mnt/c)', 'MSYS  (/c)', 'Plain  (c:/)'],
            }),
        });
        styleRow.selected = Math.max(0, styleIds.indexOf(settings.get_string('style')));
        styleRow.connect('notify::selected', () =>
            settings.set_string('style', styleIds[styleRow.selected]));
        conversion.add(styleRow);

        const behavior = new Adw.PreferencesGroup({
            title: 'Behavior',
            description: 'NOTE: UNC paths (\\\\server\\share) always map to smb://server/share.',
        });
        page.add(behavior);

        const restoreRow = new Adw.SwitchRow({
            title: 'Restore clipboard after paste',
            subtitle: 'Put the original contents back once pasting is done',
        });
        restoreRow.active = settings.get_boolean('restore-clipboard');
        restoreRow.connect('notify::active', () =>
            settings.set_boolean('restore-clipboard', restoreRow.active));
        behavior.add(restoreRow);

        const notifyRow = new Adw.SwitchRow({
            title: 'Notify on paste',
            subtitle: 'Show a brief on-screen message after converting and pasting',
        });
        notifyRow.active = settings.get_boolean('notify-on-paste');
        notifyRow.connect('notify::active', () =>
            settings.set_boolean('notify-on-paste', notifyRow.active));
        behavior.add(notifyRow);

        const delayRow = new Adw.SpinRow({
            title: 'Paste delay (ms)',
            subtitle: 'Wait before sending the paste keystroke; raise if paste misses',
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 2000, step_increment: 10, page_increment: 50,
            }),
        });
        delayRow.value = settings.get_int('paste-delay');
        delayRow.connect('notify::value', () =>
            settings.set_int('paste-delay', delayRow.get_value()));
        settings.connect('changed::paste-delay', () =>
            delayRow.set_value(settings.get_int('paste-delay')));
        behavior.add(delayRow);
    }
}
