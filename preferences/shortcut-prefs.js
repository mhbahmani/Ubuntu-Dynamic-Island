import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';

export function shortcutRow(settings, window, key, title, subtitle) {
    const row = new Adw.ActionRow({title, subtitle});
    const shortcut = new Gtk.ShortcutLabel({disabled_text:'Set shortcut'});
    const edit = new Gtk.Button({child:shortcut, valign:Gtk.Align.CENTER, tooltip_text:`Set ${title}`});
    row.add_suffix(edit); row.activatable_widget = edit;
    const sync = () => { shortcut.accelerator = settings.get_strv(key)[0] || ''; };
    sync(); const id = settings.connect(`changed::${key}`, sync);
    let dialog = null;
    edit.connect('clicked', () => {
        if (dialog) { dialog.present(); return; }
        dialog = new Gtk.Window({title:`Set ${title}`, transient_for:window, modal:true,
            default_width:420, resizable:false});
        const content = new Gtk.Box({orientation:Gtk.Orientation.VERTICAL, spacing:16,
            margin_top:24, margin_bottom:24, margin_start:24, margin_end:24});
        const hint = new Gtk.Label({label:'Press a combination with Ctrl, Alt or Super.\nFor example: Super + Alt + Space.', wrap:true, justify:Gtk.Justification.CENTER});
        content.append(hint);
        const buttons = new Gtk.Box({spacing:8, halign:Gtk.Align.CENTER}); content.append(buttons);
        const cancel = new Gtk.Button({label:'Cancel'}), clear = new Gtk.Button({label:'Disable shortcut'});
        buttons.append(cancel); buttons.append(clear);
        cancel.connect('clicked', () => dialog.close());
        clear.connect('clicked', () => { settings.set_strv(key, []); dialog.close(); });
        const keys = new Gtk.EventControllerKey();
        keys.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
        keys.connect('key-pressed', (_controller, keyval, _code, state) => {
            if (keyval === Gdk.KEY_Escape) { dialog.close(); return true; }
            const modifiers = state & Gtk.accelerator_get_default_mod_mask();
            if (keyval === Gdk.KEY_BackSpace && !modifiers) { settings.set_strv(key, []); dialog.close(); return true; }
            if ([Gdk.KEY_Control_L,Gdk.KEY_Control_R,Gdk.KEY_Shift_L,Gdk.KEY_Shift_R,Gdk.KEY_Alt_L,Gdk.KEY_Alt_R,
                Gdk.KEY_Super_L,Gdk.KEY_Super_R,Gdk.KEY_Meta_L,Gdk.KEY_Meta_R].includes(keyval)) return true;
            const acceleratorKey = Gdk.keyval_to_lower(keyval);
            if (!(modifiers & (Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.ALT_MASK | Gdk.ModifierType.SUPER_MASK)) || !Gtk.accelerator_valid(acceleratorKey, modifiers)) {
                hint.label = 'Use Ctrl, Alt or Super with another key.\nEscape cancels; Backspace disables the shortcut.';
                return true;
            }
            const accelerator = Gtk.accelerator_name(acceleratorKey, modifiers);
            const otherKeys = ['island-quick-ask-shortcut', 'island-toggle-shortcut', 'island-next-tab-shortcut', 'island-previous-tab-shortcut'];
            const canonical = value => {
                const [valid, keyval, mods] = Gtk.accelerator_parse(value);
                return valid ? Gtk.accelerator_name(keyval, mods) : value;
            };
            if (otherKeys.some(other => other !== key && settings.get_strv(other).some(value => canonical(value) === accelerator))) {
                hint.label = 'Another Island action already uses this shortcut. Choose a different combination.';
                return true;
            }
            settings.set_strv(key, [accelerator]); dialog.close(); return true;
        });
        dialog.add_controller(keys); dialog.set_child(content);
        dialog.connect('map', () => dialog.get_surface()?.inhibit_system_shortcuts(null));
        dialog.connect('close-request', () => {
            dialog.get_surface()?.restore_system_shortcuts(); dialog = null; return false;
        });
        dialog.present();
    });
    window.connect('close-request', () => { dialog?.close(); settings.disconnect(id); return false; });
    return row;
}

export function quickAskShortcut(settings, window) {
    return shortcutRow(settings, window, 'island-quick-ask-shortcut', 'Quick Ask shortcut',
        'Open a compact prompt in the notch, even when session tracking is off.');
}
