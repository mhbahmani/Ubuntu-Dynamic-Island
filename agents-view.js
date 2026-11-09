import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {AGENTS, AGENT_STATES, agentSummary, cleanText} from './services/agents-model.js';
import {column, row, label, button, setEnabled, notchToggle} from './widgets.js';

function textButton(text, action) {
    const actor = new St.Button({label:text, style_class:'ubuntu-island-agent-button', can_focus:true, reactive:true, track_hover:true});
    actor.connect('clicked', action); return actor;
}
export class AgentsView {
    constructor(section, settings, actions) {
        this.settings = settings; this.actions = actions; this.rows = new Map(); this.mode = 'list';
        this.content = section.content;
        this.content.add_style_class_name('ubuntu-island-agents-content');
        section.box.add_style_class_name('ubuntu-island-agents-section');
        section.header.add_child(notchToggle(settings, 'pill-show-agents', 'agent status'));
        section.header.add_child(button('emblem-system-symbolic', 'Agent preferences', () => actions.preferences('agents'), 14, 'ubuntu-island-title-toggle'));
        this.summary = label('Local sessions', 'ubuntu-island-source');
        this.content.add_child(this.summary);
        this.list = column('ubuntu-island-agent-list'); this.content.add_child(this.list);
        this.message = label('', 'ubuntu-island-agent-message', false);
        this.message.clutter_text.line_wrap = true; this.content.add_child(this.message);
        this.toolbar = row('ubuntu-island-agent-toolbar');
        this.askButton = textButton('Quick ask…', () => this.show('ask'));
        this.toolbar.add_child(this.askButton);
        this.toolbar.add_child(textButton('Clear list', () => actions.agentClear()));
        this.content.add_child(this.toolbar);
        this.content.set_child_at_index(this.toolbar, 1);
        this.editor = column('ubuntu-island-agent-editor'); this.content.add_child(this.editor);
        const choices = row('ubuntu-island-agent-toolbar'); this.editor.add_child(choices);
        this.provider = settings.get_string('agents-provider');
        this.destination = settings.get_string('agents-destination');
        this.providerButton = textButton('', () => this._choose('provider'));
        this.destinationButton = textButton('', () => this._choose('destination'));
        choices.add_child(this.providerButton); choices.add_child(this.destinationButton);
        this.options = column('ubuntu-island-agent-options'); this.editor.add_child(this.options);
        this.editor.add_child(label('Prompt', 'ubuntu-island-source'));
        this.prompt = new St.Entry({style_class:'ubuntu-island-agent-prompt', can_focus:true, x_expand:true, hint_text:'What would you like to ask?', accessible_name:'Prompt'});
        this.prompt.clutter_text.set_single_line_mode(false);
        this.prompt.clutter_text.set_line_wrap(true);
        this.prompt.clutter_text.set_max_length(16000);
        this.editor.add_child(this.prompt);
        this.folder = new St.Entry({style_class:'ubuntu-island-agent-entry', can_focus:true, x_expand:true,
            text:settings.get_string('agents-project'), hint_text:'/path/to/project', accessible_name:'Project folder'});
        this.editor.add_child(this.folder);
        this.hint = label('', 'ubuntu-island-agent-message', false); this.hint.clutter_text.line_wrap = true;
        this.editor.add_child(this.hint);
        const submitRow = row('ubuntu-island-agent-toolbar'); this.editor.add_child(submitRow);
        this.submit = textButton('', () => this._submit()); submitRow.add_child(this.submit);
        submitRow.add_child(textButton('Back', () => this.show('list')));
        this.prompt.clutter_text.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Return && event.get_state() & Clutter.ModifierType.CONTROL_MASK) {
                this._submit(); return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.windowList = column('ubuntu-island-agent-list'); this.content.add_child(this.windowList);
        this.content.connect('notify::mapped', () => { if (this.content.mapped) this.render(this.snapshot); });
        this.message.connect('notify::text', () => { this.message.visible = Boolean(this.message.text); });
        this.message.hide();
        this.show('list');
    }
    _choose(kind) {
        this.options.destroy_all_children();
        const entries = kind === 'provider' ? Object.entries(AGENTS) : [
            ['terminal','Start in terminal'],['copy-terminal','Copy & open terminal'],['desktop','Copy & open app'],['web','Copy & open website']];
        for (const [value, name] of entries) this.options.add_child(textButton(name, () => {
            this[kind] = value; this.settings.set_string(`agents-${kind}`, value);
            this.options.destroy_all_children(); this._syncEditor();
        }));
    }
    _syncEditor() {
        this.providerButton.label = AGENTS[this.provider];
        this.providerButton.accessible_name = `Choose agent. ${AGENTS[this.provider]} selected`;
        this.destinationButton.label = {terminal:'Terminal', 'copy-terminal':'Copy → terminal', desktop:'Desktop app', web:'Website'}[this.destination];
        this.destinationButton.accessible_name = `Choose destination. ${this.destinationButton.label} selected`;
        this.folder.visible = this.destination.includes('terminal');
        this.submit.label = this.destination === 'terminal' ? 'Start in terminal' : 'Copy & open';
        this.hint.text = this.destination === 'terminal' ? 'Starts a new request. Prompt arguments may be visible to local processes.'
            : 'Copies the prompt; paste it in the selected app. Clipboard history may retain it.';
        setEnabled(this.submit, !(this.destination === 'web' && this.provider === 'opencode'));
        if (this.destination === 'web' && this.provider === 'opencode') this.hint.text = 'Choose Terminal or Desktop for OpenCode.';
    }
    _submit() {
        try {
            this.message.text = this.actions.agentAsk({provider:this.provider, destination:this.destination,
                prompt:this.prompt.text, cwd:this.folder.text});
            this.prompt.text = '';
            this.show('list', true);
        } catch (error) { this.hint.text = error.message; }
    }
    show(mode, preserveMessage = false) {
        this.mode = mode;
        this.list.visible = mode === 'list'; this.toolbar.visible = mode === 'list';
        this.editor.visible = mode === 'ask'; this.windowList.visible = mode === 'windows';
        if (!preserveMessage) this.message.text = '';
        this.summary.visible = mode === 'list';
        if (mode === 'ask') { this._syncEditor(); this.prompt.grab_key_focus(); }
        else if (mode === 'list') this.render(this.snapshot, preserveMessage);
        this.actions.relayout?.();
    }
    selectWindow(session, windows) {
        this.windowList.destroy_all_children();
        this.windowList.add_child(label('Select the window for this session', 'ubuntu-island-source'));
        if (this.actions.agentHasApp?.(session.provider)) this.windowList.add_child(textButton('Open configured app',
            () => {
                try { this.actions.agentOpenApp(session.provider); }
                catch (error) { this.message.text = error.message; }
            }));
        for (const window of windows.slice(0, 40)) this.windowList.add_child(textButton(cleanText(window.get_title(), 70) || 'Untitled window',
            () => this.actions.agentActivate(session, window)));
        if (!windows.length) this.windowList.add_child(label('No application windows are available.'));
        this.windowList.add_child(textButton('Back', () => this.show('list')));
        this.show('windows');
    }
    render(snapshot, preserveMessage = false) {
        this.snapshot = snapshot;
        if (!this.content.mapped || this.mode !== 'list') return;
        const sessions = snapshot?.sessions || [];
        this.summary.text = `Last reported · ${agentSummary(sessions)}`;
        if (!preserveMessage) this.message.text = snapshot?.message || (snapshot?.dropped
            ? 'Some events could not be tracked. Clear the list and start a fresh turn.' : !sessions.length
                ? 'No tracked sessions. Enable local integrations in Agents preferences, then start a session.' : '');
        for (const [id, item] of this.rows) if (!sessions.some(s => s.id === id)) {
            const focus = global.stage.get_key_focus();
            if (focus && item.actor.contains(focus)) this.askButton.grab_key_focus();
            item.actor.destroy(); this.rows.delete(id);
        }
        for (const session of sessions) {
            let item = this.rows.get(session.id);
            if (!item) {
                const actor = row('ubuntu-island-agent-row');
                const details = column('ubuntu-island-agent-details'); details.x_expand = true;
                const title = label('', 'ubuntu-island-agent-title');
                const status = label('', 'ubuntu-island-agent-state');
                details.add_child(title); details.add_child(status); actor.add_child(details);
                item = {actor,title,status,session};
                item.open = textButton('Open', () => this.actions.agentOpen(item.session)); actor.add_child(item.open);
                actor.add_child(button('window-close-symbolic','Dismiss tracked session', () => this.actions.agentDismiss(item.session.id),12,'ubuntu-island-title-toggle'));
                this.list.add_child(actor); this.rows.set(session.id, item);
            }
            item.session = session;
            item.title.text = `${AGENTS[session.provider]} · ${session.label}`;
            const state = AGENT_STATES[session.state] || 'Unknown';
            const time = new Date(session.updated).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
            item.status.text = `${state} · ${time}`;
            item.status.set_style_class_name(`ubuntu-island-agent-state ubuntu-island-agent-${session.state}`);
            item.open.accessible_name = `Open ${AGENTS[session.provider]} session ${session.label}`;
            item.actor.accessible_name = `${item.title.text}. Last reported ${state} at ${time}`;
        }
    }
}
