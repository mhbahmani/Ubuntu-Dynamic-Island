import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import {AGENTS} from '../services/agents-model.js';
import {agentIcon} from './agent-icon.js';
import {column, row, label, icon, button, setEnabled} from './widgets.js';

// A local draft only. Launching reuses the same validated CLI launch path as
// the full composer; neither settings nor the observer receive prompt contents.
export class QuickAsk {
    constructor(settings, actions) {
        this.settings = settings; this.actions = actions;
        this.actor = column('ubuntu-island-quick-ask');
        const line = row('ubuntu-island-quick-ask-line'); this.actor.add_child(line);
        const glyph = icon(agentIcon, 18); glyph.y_align = Clutter.ActorAlign.CENTER; line.add_child(glyph);
        this.prompt = new St.Entry({style_class:'ubuntu-island-quick-ask-entry', x_expand:true, can_focus:true,
            accessible_name:'Quick Ask prompt'});
        this.prompt.clutter_text.set_max_length(16000); line.add_child(this.prompt);
        this.send = button('go-next-symbolic', 'Send to agent', () => this.submit(), 16, 'ubuntu-island-quick-ask-send'); line.add_child(this.send);
        line.add_child(button('window-close-symbolic', 'Close Quick Ask', () => actions.closeQuickAsk(), 14, 'ubuntu-island-agent-menu-button'));
        this.target = label('', 'ubuntu-island-source', false);
        this.target.clutter_text.line_wrap = true;
        this.target.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR; this.actor.add_child(this.target);
        this.error = label('', 'ubuntu-island-agent-message ubuntu-island-agent-error', false);
        this.error.clutter_text.line_wrap = true; this.error.hide(); this.actor.add_child(this.error);
        this.error.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this.prompt.clutter_text.connect('text-changed', () => setEnabled(this.send, Boolean(this.prompt.text.trim())));
        this.prompt.clutter_text.connect('activate', () => this.submit());
        this.actor.connect('notify::mapped', () => {
            if (this.actor.mapped) this.refresh();
            else this._cancelRelayout();
        });
        this.actor.connect('style-changed', () => this._queueRelayout());
        const ids = ['agents-provider', 'agents-project'].map(key => settings.connect(`changed::${key}`, () => {
            if (this.actor.mapped) this.refresh();
        }));
        this.actor.connect('destroy', () => {
            this._cancelRelayout();
            for (const id of ids) settings.disconnect(id);
        });
    }
    _cancelRelayout() {
        if (this._layoutIdle) GLib.Source.remove(this._layoutIdle);
        this._layoutIdle = 0;
    }
    _queueRelayout() {
        if (!this.actor.mapped || this._layoutIdle) return;
        // Measure after theme/font invalidation has reached the entry and labels.
        this._layoutIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._layoutIdle = 0;
            if (this.actor.mapped) this.actions.relayout?.();
            return GLib.SOURCE_REMOVE;
        });
    }
    refresh() {
        const provider = AGENTS[this.settings.get_string('agents-provider')];
        this.prompt.hint_text = 'Ask anything…';
        this.target.text = `${provider} · Enter to start in terminal`;
        this.send.accessible_name = `Start a new ${provider} session`;
        setEnabled(this.send, Boolean(this.prompt.text.trim()));
        this._queueRelayout();
    }
    open() { this.error.hide(); this.refresh(); }
    focus() { if (this.actor.mapped) this.prompt.grab_key_focus(); }
    submit() {
        if (!this.actor.mapped) return;
        try {
            if (!this.prompt.text.trim()) throw new Error('Type a message first.');
            this.actions.agentAsk({provider:this.settings.get_string('agents-provider'),
                prompt:this.prompt.text,
                cwd:this.settings.get_string('agents-project') || GLib.get_home_dir()});
            this.send.grab_key_focus(); this.prompt.text = ''; this.error.hide();
        } catch (error) {
            this.error.text = error.message.length > 400 ? `${error.message.slice(0, 399)}…` : error.message;
            this.error.show(); this.focus();
        }
        this.actions.relayout?.();
    }
}
