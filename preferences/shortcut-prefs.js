import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';

const KEY = 'island-quick-ask-shortcut';
export function quickAskShortcut(settings, window) {
    const row = new Adw.ActionRow({title:'Quick Ask shortcut',
        subtitle:'Open a compact prompt in the notch, even when session tracking is off.'});
    const shortcut = new Gtk.ShortcutLabel({disabled_text:'Set shortcut'});
    const edit = new Gtk.Button({child:shortcut, valign:Gtk.Align.CENTER, tooltip_text:'Set Quick Ask shortcut'});
    row.add_suffix(edit); row.activatable_widget = edit;
    const sync = () => { shortcut.accelerator = settings.get_strv(KEY)[0] || ''; };
    sync(); const id = settings.connect(`changed::${KEY}`, sync);
    let dialog = null;
    edit.connect('clicked', () => {
        if (dialog) { dialog.present(); return; }
        dialog = new Gtk.Window({title:'Set Quick Ask shortcut', transient_for:window, modal:true,
            default_width:420, resizable:false});
        const content = new Gtk.Box({orientation:Gtk.Orientation.VERTICAL, spacing:16,
            margin_top:24, margin_bottom:24, margin_start:24, margin_end:24});
        const hint = new Gtk.Label({label:'Press a combination with Ctrl, Alt or Super.\nFor example: Super + Alt + Space.', wrap:true, justify:Gtk.Justification.CENTER});
        content.append(hint);
        const buttons = new Gtk.Box({spacing:8, halign:Gtk.Align.CENTER}); content.append(buttons);
        const cancel = new Gtk.Button({label:'Cancel'}), clear = new Gtk.Button({label:'Disable shortcut'});
        buttons.append(cancel); buttons.append(clear);
        cancel.connect('clicked', () => dialog.close());
        clear.connect('clicked', () => { settings.set_strv(KEY, []); dialog.close(); });
        const keys = new Gtk.EventControllerKey();
        keys.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
        keys.connect('key-pressed', (_controller, keyval, _code, state) => {
            if (keyval === Gdk.KEY_Escape) { dialog.close(); return true; }
            const modifiers = state & Gtk.accelerator_get_default_mod_mask();
            if (keyval === Gdk.KEY_BackSpace && !modifiers) { settings.set_strv(KEY, []); dialog.close(); return true; }
            if ([Gdk.KEY_Control_L,Gdk.KEY_Control_R,Gdk.KEY_Shift_L,Gdk.KEY_Shift_R,Gdk.KEY_Alt_L,Gdk.KEY_Alt_R,
                Gdk.KEY_Super_L,Gdk.KEY_Super_R,Gdk.KEY_Meta_L,Gdk.KEY_Meta_R].includes(keyval)) return true;
            const key = Gdk.keyval_to_lower(keyval);
            if (!(modifiers & (Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.ALT_MASK | Gdk.ModifierType.SUPER_MASK)) || !Gtk.accelerator_valid(key, modifiers)) {
                hint.label = 'Use Ctrl, Alt or Super with another key.\nEscape cancels; Backspace disables the shortcut.';
                return true;
            }
            settings.set_strv(KEY, [Gtk.accelerator_name(key, modifiers)]); dialog.close(); return true;
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
