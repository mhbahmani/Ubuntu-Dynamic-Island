import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Atk from 'gi://Atk';
import GLib from 'gi://GLib';
import {AGENTS, AGENT_STATES, agentSummary, cleanText} from './services/agents-model.js';
import {column, row, label, button, setEnabled, notchToggle} from './widgets.js';

const DESTINATIONS = {terminal:'Terminal', 'copy-terminal':'Copy to terminal', desktop:'Desktop app', web:'Website'};
const RECENT = new Set(['finished', 'closed']);
const PRIORITY = {approval:0, input:0, error:1, interrupted:2, working:3, idle:4, unknown:5, finished:6, closed:7};
const icons = new Map(Object.keys(AGENT_STATES).map(state => [state,
    Gio.FileIcon.new(Gio.File.new_for_uri(import.meta.url).get_parent().resolve_relative_path(`assets/agents/${state}-symbolic.svg`))]));
function textButton(text, action, css = '') {
    const actor = new St.Button({label:text, style_class:`ubuntu-island-agent-button ${css}`, can_focus:true, reactive:true, track_hover:true});
    actor.connect('clicked', action); return actor;
}
function wrap(text, css = 'ubuntu-island-agent-message') {
    const actor = label(text, css, false); actor.clutter_text.line_wrap = true; actor.x_expand = true; return actor;
}

// The header, composer shortcut and tab navigation stay outside the scrolling list.
// Reuse rows, and only regroup on reopening: incoming events never move a click target.
export class AgentsView {
    constructor(settings, actions) {
        this.settings = settings; this.actions = actions; this.rows = new Map(); this.mode = 'list';
        this.actor = column('ubuntu-island-agents'); this.actor.y_expand = true;
        this.header = row('ubuntu-island-agent-header'); this.actor.add_child(this.header);
        this.back = button('go-previous-symbolic', 'Back to sessions', () => this.handleEscape(), 14, 'ubuntu-island-agent-menu-button');
        this.header.add_child(this.back);
        this.heading = label('Agents', 'ubuntu-island-agent-heading'); this.header.add_child(this.heading);
        this.activity = new St.Icon({gicon:icons.get('working'), icon_size:14, style_class:'ubuntu-island-agent-working', y_align:Clutter.ActorAlign.CENTER});
        this.activity.set_pivot_point(0.5, 0.5); this.header.add_child(this.activity);
        this.summary = label('', 'ubuntu-island-source'); this.summary.x_expand = true; this.header.add_child(this.summary);
        this.clearButton = textButton('Clear', () => this._control({control:'clear-finished'}), 'ubuntu-island-agent-clear');
        this.clearButton.accessible_name = 'Clear finished sessions'; this.header.add_child(this.clearButton);
        this.notchButton = notchToggle(settings, 'pill-show-agents', 'agent status'); this.header.add_child(this.notchButton);
        this.scroll = new St.ScrollView({style_class:'ubuntu-island-agent-scroll', overlay_scrollbars:true, x_expand:true, y_expand:true});
        this.scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC); this.actor.add_child(this.scroll);
        this.adjustment = this.scroll.get_vscroll_bar().get_adjustment();
        this.content = column('ubuntu-island-agents-content'); this.scroll.set_child(this.content);
        this.list = column('ubuntu-island-agent-list'); this.content.add_child(this.list);
        this.activeList = column('ubuntu-island-agent-list'); this.list.add_child(this.activeList);
        this.recentButton = textButton('', () => {
            this.recentExpanded = !this.recentExpanded; this._syncRecent(); this.actions.relayout?.();
        }, 'ubuntu-island-agent-recent'); this.list.add_child(this.recentButton);
        this.recentList = column('ubuntu-island-agent-list'); this.list.add_child(this.recentList);
        this.empty = column('ubuntu-island-agent-empty'); this.list.add_child(this.empty);
        this.empty.add_child(wrap('Your sessions will appear here', 'ubuntu-island-agent-title'));
        this.empty.add_child(wrap('Connect a local agent to see when it needs you. Quick Ask is available without tracking.'));
        this.empty.add_child(textButton('Set up tracking', () => actions.preferences('agents')));
        this.editor = column('ubuntu-island-agent-editor'); this.content.add_child(this.editor);
        const choices = row('ubuntu-island-agent-toolbar'); this.editor.add_child(choices);
        this.provider = settings.get_string('agents-provider'); this.destination = settings.get_string('agents-destination');
        this.providerButton = textButton('', () => this._choose('provider'));
        this.destinationButton = textButton('', () => this._choose('destination'));
        choices.add_child(this.providerButton); choices.add_child(this.destinationButton);
        this.editor.add_child(label('Prompt', 'ubuntu-island-source'));
        this.prompt = new St.Entry({style_class:'ubuntu-island-agent-prompt', can_focus:true, x_expand:true,
            hint_text:'What would you like to ask?', accessible_name:'Prompt'});
        this.prompt.clutter_text.set_single_line_mode(false); this.prompt.clutter_text.set_line_wrap(true); this.prompt.clutter_text.set_max_length(16000);
        this.editor.add_child(this.prompt);
        this.folderLabel = label('Project folder', 'ubuntu-island-source'); this.editor.add_child(this.folderLabel);
        this.folder = new St.Entry({style_class:'ubuntu-island-agent-entry', can_focus:true, x_expand:true,
            text:settings.get_string('agents-project'), hint_text:'/path/to/project', accessible_name:'Project folder'}); this.editor.add_child(this.folder);
        this.hint = wrap(''); this.editor.add_child(this.hint);
        this.options = column('ubuntu-island-agent-options'); this.content.add_child(this.options);
        this.windowList = column('ubuntu-island-agent-options'); this.content.add_child(this.windowList);
        this.message = wrap(''); this.content.add_child(this.message);
        this.message.connect('notify::text', () => { this.message.visible = Boolean(this.message.text); }); this.message.hide();
        this.footer = column('ubuntu-island-agent-footer'); this.actor.add_child(this.footer);
        this.undoRow = row('ubuntu-island-agent-toolbar'); this.footer.add_child(this.undoRow);
        this.undoText = label('', 'ubuntu-island-agent-message'); this.undoText.x_expand = true; this.undoRow.add_child(this.undoText);
        this.undoButton = textButton('Undo', () => this._control({control:'restore', token:this.snapshot?.undo?.token})); this.undoRow.add_child(this.undoButton);
        this.askButton = textButton('', () => this.show('ask'), 'ubuntu-island-agent-ask'); this.footer.add_child(this.askButton);
        const askFace = row('ubuntu-island-agent-toolbar'); askFace.x_expand = true; askFace.x_align = Clutter.ActorAlign.FILL;
        askFace.add_child(new St.Icon({icon_name:'list-add-symbolic', icon_size:14}));
        const askLabel = label('Ask an agent…', 'ubuntu-island-agent-title'); askLabel.x_expand = true; askFace.add_child(askLabel);
        this.askTarget = label('', 'ubuntu-island-source'); askFace.add_child(this.askTarget); this.askButton.set_child(askFace);
        this.submitRow = row('ubuntu-island-agent-toolbar'); this.footer.add_child(this.submitRow);
        this.submit = textButton('', () => this._submit(), 'ubuntu-island-agent-primary'); this.submit.x_expand = true; this.submitRow.add_child(this.submit);
        this.submitRow.add_child(label('Ctrl + Enter', 'ubuntu-island-source'));
        this.prompt.clutter_text.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Return && event.get_state() & Clutter.ModifierType.CONTROL_MASK) {
                this._submit(); return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.actor.connect('notify::mapped', () => {
            if (this.actor.mapped) { this.regroup = true; this.recentExpanded = false; this.render(this.snapshot); }
            else this._cancelFocus();
            this._syncMotion();
        });
        this.stSettings = St.Settings.get();
        const motion = this.stSettings.connect('notify::enable-animations', () => this._syncMotion());
        const preference = settings.connect('changed::disable-animations', () => this._syncMotion());
        const focus = global.stage.connect('notify::key-focus', () => this._revealFocus());
        this.actor.connect('destroy', () => {
            this.dead = true; this.activity.remove_transition('agent-working');
            this._cancelFocus();
            this.stSettings.disconnect(motion); settings.disconnect(preference);
            global.stage.disconnect(focus);
        });
        this.regroup = true; this.show('list');
    }
    _revealFocus() {
        const target = global.stage.get_key_focus();
        if (!this.actor.mapped || !target?.mapped || !this.content.contains(target)) return;
        const top = this.scroll.get_transformed_position()[1];
        const y = target.get_transformed_position()[1];
        const height = target.get_transformed_size()[1];
        const bottom = top + this.scroll.get_transformed_size()[1];
        const offset = y < top || height > bottom - top ? y - top : Math.max(0, y + height - bottom);
        this.adjustment.value = Math.max(this.adjustment.lower,
            Math.min(this.adjustment.upper - this.adjustment.page_size, this.adjustment.value + offset));
    }
    _syncMotion() {
        const run = this.actor.mapped && this.mode === 'list' && this.snapshot?.connected &&
            this.snapshot.sessions.some(s => s.state === 'working') && this.stSettings.enable_animations && !this.settings.get_boolean('disable-animations');
        if (run && !this.activity.get_transition('agent-working')) {
            const interval = new Clutter.Interval({value_type:GObject.TYPE_DOUBLE}); interval.set_initial(0); interval.set_final(360);
            this.activity.add_transition('agent-working', new Clutter.PropertyTransition({property_name:'rotation-angle-z',
                interval, duration:1800, repeat_count:-1, progress_mode:Clutter.AnimationMode.LINEAR}));
        } else if (!run) { this.activity.remove_transition('agent-working'); this.activity.rotation_angle_z = 0; }
    }
    _choose(kind) {
        this.options.destroy_all_children(); this.choice = kind;
        for (const [value, name] of Object.entries(kind === 'provider' ? AGENTS : DESTINATIONS)) {
            const selected = this[kind] === value;
            const option = textButton(`${selected ? '✓  ' : ''}${name}`, () => {
                this[kind] = value; this.settings.set_string(`agents-${kind}`, value);
                this.show('ask', false); (kind === 'provider' ? this.providerButton : this.destinationButton).grab_key_focus();
            });
            option.accessible_name = `${name}${selected ? ', selected' : ''}`; this.options.add_child(option);
        }
        this.show('choices'); this.options.get_first_child()?.grab_key_focus();
    }
    _syncEditor() {
        this.providerButton.label = AGENTS[this.provider]; this.providerButton.accessible_name = `Choose agent. ${AGENTS[this.provider]} selected`;
        this.destinationButton.label = DESTINATIONS[this.destination]; this.destinationButton.accessible_name = `Choose destination. ${this.destinationButton.label} selected`;
        this.folder.visible = this.folderLabel.visible = this.destination.includes('terminal');
        this.submit.label = this.destination === 'terminal' ? 'Start session' : 'Copy & open';
        this.hint.text = this.destination === 'terminal' ? 'Opens a new terminal session. The prompt is passed as a local process argument.'
            : 'Copies your prompt. Paste it in the opened app; clipboard history may retain it.';
        this.hint.remove_style_class_name('ubuntu-island-agent-error');
        setEnabled(this.submit, !(this.destination === 'web' && this.provider === 'opencode'));
        if (!this.submit.reactive) this.hint.text = 'OpenCode needs Terminal or Desktop app. Choose another destination.';
    }
    _submit() {
        if (this.mode !== 'ask' || !this.submit.reactive) return;
        try {
            if (!this.prompt.text.trim()) throw new Error('Write a prompt before starting a session.');
            if (this.destination.includes('terminal') && !this.folder.text.trim().startsWith('/')) throw new Error('Enter an absolute project folder, such as /home/you/project.');
            const message = this.actions.agentAsk({provider:this.provider, destination:this.destination,
                prompt:this.prompt.text, cwd:this.folder.text.trim()});
            if (this.destination.includes('terminal')) this.settings.set_string('agents-project', this.folder.text.trim());
            this.submit.grab_key_focus();
            this.prompt.text = ''; this.show('list'); this.message.text = message; this.askButton.grab_key_focus();
        } catch (error) {
            this.hint.text = error.message; this.hint.add_style_class_name('ubuntu-island-agent-error');
            // Scroll the inline error into view without discarding the draft.
            this.adjustment.value = this.adjustment.upper;
        }
    }
    _cancelFocus() {
        if (this.focusIdle) GLib.Source.remove(this.focusIdle);
        this.focusIdle = 0;
    }
    show(mode, focusPrompt = true) {
        this._cancelFocus();
        this.mode = mode;
        this.back.accessible_name = mode === 'choices' ? 'Back to Quick Ask' : 'Back to sessions';
        this.heading.text = {list:'Agents', ask:'Quick Ask', choices:this.choice === 'provider' ? 'Choose agent' : 'Open in', session:'Session', windows:'Choose window'}[mode];
        this.back.visible = mode !== 'list'; this.clearButton.visible = this.notchButton.visible = mode === 'list'; this.summary.visible = mode === 'list';
        this.activity.visible = mode === 'list' && Boolean(this.snapshot?.sessions.some(s => s.state === 'working'));
        this.list.visible = mode === 'list'; this.editor.visible = mode === 'ask'; this.options.visible = ['choices', 'session'].includes(mode);
        this.windowList.visible = mode === 'windows'; this.askButton.visible = mode === 'list'; this.submitRow.visible = mode === 'ask';
        this.footer.visible = ['list', 'ask'].includes(mode); this.undoRow.visible = mode === 'list' && Boolean(this.snapshot?.undo);
        this.message.text = ''; this.adjustment.value = 0;
        if (mode === 'ask') {
            this._syncEditor();
            // Let the newly shown entry finish mapping before the input method
            // receives its cursor and surrounding text. Never focus a hidden tab.
            if (focusPrompt) this.focusIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this.focusIdle = 0;
                if (!this.dead && this.actor.mapped && this.mode === 'ask') this.prompt.grab_key_focus();
                return GLib.SOURCE_REMOVE;
            });
        }
        else if (mode === 'list') this.render(this.snapshot);
        this._syncMotion(); this.actions.relayout?.();
    }
    handleEscape() {
        if (this.mode === 'list') return false;
        const previous = this.mode;
        this.show(previous === 'choices' ? 'ask' : 'list', false);
        if (previous === 'choices') (this.choice === 'provider' ? this.providerButton : this.destinationButton).grab_key_focus();
        else if (previous === 'ask') this.askButton.grab_key_focus();
        else (this.rows.get(this.selectedSession?.id)?.open || this.askButton).grab_key_focus();
        return true;
    }
    _session(session) {
        this.selectedSession = session; this.options.destroy_all_children();
        this.options.add_child(wrap(session.label, 'ubuntu-island-agent-title'));
        this.options.add_child(wrap(`${AGENTS[session.provider]} · ${AGENT_STATES[session.state]}\nLast reported ${new Date(session.updated).toLocaleString()}`));
        this.options.add_child(textButton('Choose another window', () => this.actions.agentOpen(session, true)));
        this.options.add_child(textButton('Hide from list', () => this._control({control:'dismiss', id:session.id})));
        this.options.add_child(wrap('Hiding a session only changes this list. It does not stop the agent.'));
        this.show('session'); this.back.grab_key_focus();
    }
    async _control(value) {
        if (this.pending) return;
        this.pending = true; setEnabled(this.undoButton, false); setEnabled(this.clearButton, false);
        const before = this.snapshot, mode = this.mode;
        try {
            await this.actions.agentControl(value);
            if (!this.dead && this.mode === mode) {
                this.show('list'); if (this.actor.mapped) this.askButton.grab_key_focus();
                if (this.snapshot === before) this.message.text = 'Updating sessions…';
            }
        }
        catch { if (!this.dead) this.message.text = 'Observer unavailable. Re-enable Agents in settings to reconnect.'; }
        finally {
            this.pending = false;
            if (!this.dead) {
                setEnabled(this.undoButton, true);
                setEnabled(this.clearButton, this.snapshot?.sessions.some(s => RECENT.has(s.state)));
            }
        }
    }
    selectWindow(session, windows) {
        this.selectedSession = session; this.windowList.destroy_all_children();
        this.windowList.add_child(wrap(`Select the window for ${session.label}. This choice is remembered until the window closes.`));
        if (this.actions.agentHasApp?.(session.provider)) this.windowList.add_child(textButton('Open configured app', () => {
            try { this.actions.agentOpenApp(session.provider); } catch (error) { this.message.text = error.message; }
        }));
        for (const window of windows.slice(0, 40)) {
            const name = cleanText(window.get_title(), 160) || 'Untitled window';
            const target = textButton('', () => this.actions.agentActivate(session, window));
            target.set_child(label(name, 'ubuntu-island-agent-message')); target.accessible_name = name; this.windowList.add_child(target);
        }
        if (!windows.length) this.windowList.add_child(wrap('No application windows are available. Open a terminal or configure a desktop app in Agent settings.'));
        this.show('windows'); this.back.grab_key_focus();
    }
    _syncRecent() {
        const count = this.recentList.get_n_children();
        this.recentButton.visible = count > 0;
        this.recentButton.label = `${this.recentExpanded ? '▾' : '▸'}  Recent · ${count}`;
        this.recentButton.child.x_expand = true;
        this.recentButton.child.x_align = Clutter.ActorAlign.FILL;
        this.recentButton.accessible_name = `${this.recentExpanded ? 'Collapse' : 'Expand'} ${count} recent sessions`;
        if (this.recentExpanded) this.recentButton.add_accessible_state(Atk.StateType.EXPANDED);
        else this.recentButton.remove_accessible_state(Atk.StateType.EXPANDED);
        this.recentList.visible = count > 0 && Boolean(this.recentExpanded);
    }
    render(snapshot) {
        this.snapshot = snapshot;
        if (!this.actor.mapped || this.mode !== 'list') return;
        const sessions = snapshot?.sessions || [];
        setEnabled(this.clearButton, !this.pending && sessions.some(s => RECENT.has(s.state)));
        this.summary.text = snapshot?.connected ? agentSummary(sessions) : 'Observer offline';
        this.summary.accessible_name = `Last reported: ${this.summary.text}`;
        this.activity.visible = sessions.some(s => s.state === 'working');
        this.askTarget.text = `${this.provider === 'claude' ? 'Claude' : AGENTS[this.provider]} · ${DESTINATIONS[this.destination]}`;
        this.askButton.accessible_name = `Quick Ask. ${AGENTS[this.provider]}, ${DESTINATIONS[this.destination]}`;
        this.empty.visible = sessions.length === 0;
        this.undoRow.visible = Boolean(snapshot?.undo);
        this.undoText.text = snapshot?.undo ? `${snapshot.undo.count} session${snapshot.undo.count === 1 ? '' : 's'} hidden` : '';
        this.message.text = snapshot?.message || (snapshot?.dropped ? 'Some events were missed. Status is the last report received.' : '');
        for (const [id, item] of this.rows) if (!sessions.some(s => s.id === id)) {
            const focus = global.stage.get_key_focus();
            if (focus && item.actor.contains(focus)) this.askButton.grab_key_focus();
            item.actor.destroy(); this.rows.delete(id);
        }
        for (const session of sessions) {
            let item = this.rows.get(session.id);
            if (!item) {
                const actor = row('ubuntu-island-agent-row');
                const open = new St.Button({style_class:'ubuntu-island-agent-session', can_focus:true, reactive:true, track_hover:true, x_expand:true}); actor.add_child(open);
                const face = row('ubuntu-island-agent-face'); face.x_expand = true; face.x_align = Clutter.ActorAlign.FILL; open.set_child(face);
                const glyph = new St.Icon({icon_size:20, y_align:Clutter.ActorAlign.CENTER}); face.add_child(glyph);
                const details = column('ubuntu-island-agent-details'); details.x_expand = true; face.add_child(details);
                const title = label('', 'ubuntu-island-agent-title'), status = label('', 'ubuntu-island-agent-state');
                details.add_child(title); details.add_child(status);
                item = {actor, title, status, open, glyph, session};
                open.connect('clicked', () => this.actions.agentOpen(item.session));
                item.menu = button('view-more-symbolic', 'Session options', () => this._session(item.session), 14, 'ubuntu-island-agent-menu-button'); actor.add_child(item.menu);
                (RECENT.has(session.state) ? this.recentList : this.activeList).add_child(actor); this.rows.set(session.id, item);
            }
            item.session = session; item.title.text = session.label;
            const state = AGENT_STATES[session.state] || 'Unknown';
            item.status.text = `${AGENTS[session.provider]} · ${state}`;
            item.glyph.gicon = icons.get(session.state) || icons.get('unknown');
            item.glyph.set_style_class_name(`ubuntu-island-agent-${session.state}`);
            item.open.accessible_name = `Open ${session.label}, ${AGENTS[session.provider]}. Last reported ${state} at ${new Date(session.updated).toLocaleString()}`;
            item.menu.accessible_name = `Options for ${session.label}`;
            // A resumed session must not become invisible inside collapsed history.
            if (item.actor.get_parent() === this.recentList && !RECENT.has(session.state)) this.recentExpanded = true;
        }
        if (this.regroup) {
            for (const session of [...sessions].sort((a,b) => PRIORITY[a.state] - PRIORITY[b.state] || b.updated - a.updated)) {
                const actor = this.rows.get(session.id).actor;
                actor.get_parent().remove_child(actor); (RECENT.has(session.state) ? this.recentList : this.activeList).add_child(actor);
            }
            this.regroup = false;
        }
        this._syncRecent(); this._syncMotion();
    }
}
