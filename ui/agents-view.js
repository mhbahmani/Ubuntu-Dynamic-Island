import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Atk from 'gi://Atk';
import GLib from 'gi://GLib';
import {AGENTS, AGENT_STATES, agentSummary, agentSessionReferences} from '../services/agents-model.js';
import {column, row, label, button, setEnabled, notchToggle} from './widgets.js';

const RECENT = new Set(['finished', 'closed']);
const PRIORITY = {approval:0, input:0, error:1, interrupted:2, working:3, idle:4, unknown:5, finished:6, closed:7};
const icons = new Map(Object.keys(AGENT_STATES).map(state => [state,
    Gio.FileIcon.new(Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().resolve_relative_path(`assets/agents/${state}-symbolic.svg`))]));
const harnessIcons = new Map(Object.keys(AGENTS).map(provider => [provider,
    Gio.FileIcon.new(Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().resolve_relative_path(`assets/agents/${provider}.svg`))]));
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
        this.summary = label('', 'ubuntu-island-source'); this.summary.x_expand = true; this.header.add_child(this.summary);
        this.clearButton = textButton('Clear', () => this._control({control:'clear-finished'}), 'ubuntu-island-agent-clear');
        this.clearButton.accessible_name = 'Clear finished sessions'; this.header.add_child(this.clearButton);
        this.notchButton = notchToggle(settings, 'pill-show-agents', 'agent status'); this.header.add_child(this.notchButton);
        this.scroll = new St.ScrollView({style_class:'ubuntu-island-agent-scroll', overlay_scrollbars:true, x_expand:true, y_expand:true});
        this.scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this.stack = new St.Widget({layout_manager:new Clutter.BinLayout(), x_expand:true, y_expand:true});
        this.actor.add_child(this.stack); this.stack.add_child(this.scroll);
        this.adjustment = this.scroll.get_vscroll_bar().get_adjustment();
        this.content = column('ubuntu-island-agents-content'); this.content.y_expand = true; this.scroll.set_child(this.content);
        this.list = column('ubuntu-island-agent-list'); this.content.add_child(this.list);
        this.activeList = column('ubuntu-island-agent-list'); this.list.add_child(this.activeList);
        this.empty = column('ubuntu-island-agent-empty'); this.list.add_child(this.empty);
        // An empty observer snapshot says nothing about whether hooks are
        // installed. Keep setup in preferences, not in the idle session list.
        this.empty.add_child(wrap('No sessions to show', 'ubuntu-island-agent-title'));
        this.empty.add_child(wrap('Start a session in your terminal or use Ask an agent below.'));
        this.editor = column('ubuntu-island-agent-editor'); this.editor.y_expand = true; this.content.add_child(this.editor);
        this.provider = settings.get_string('agents-provider');
        // Keep the entry mapped while choosing a harness. The menu overlays the
        // composer rather than replacing the page or changing its allocation.
        this.composer = new St.Widget({style_class:'ubuntu-island-agent-composer',
            layout_manager:new Clutter.BinLayout(), x_expand:true, y_expand:true});
        this.editor.add_child(this.composer);
        const face = column('ubuntu-island-agent-composer-face'); face.x_expand = face.y_expand = true;
        this.composer.add_child(face);
        this.prompt = new St.Entry({style_class:'ubuntu-island-agent-prompt', can_focus:true, reactive:true,
            x_expand:true, y_expand:true, hint_text:'Ask anything…', accessible_name:'Ask an agent'});
        this.prompt.clutter_text.set_single_line_mode(false); this.prompt.clutter_text.set_line_wrap(true); this.prompt.clutter_text.set_max_length(16000);
        face.add_child(this.prompt);
        const toolbar = row('ubuntu-island-agent-composer-toolbar'); face.add_child(toolbar);
        this.providerButton = textButton('', () => this._chooseHarness(), 'ubuntu-island-agent-harness');
        const providerFace = row('ubuntu-island-agent-toolbar');
        this.providerLabel = label('', 'ubuntu-island-agent-message'); providerFace.add_child(this.providerLabel);
        providerFace.add_child(new St.Icon({icon_name:'pan-down-symbolic', icon_size:12}));
        this.providerButton.set_child(providerFace); toolbar.add_child(this.providerButton);
        toolbar.add_child(new St.Widget({x_expand:true}));
        this.submit = button('go-up-symbolic', 'Start session (Ctrl+Enter)', () => this._submit(), 16,
            'ubuntu-island-quick-ask-send'); toolbar.add_child(this.submit);
        this.harnessMenu = column('ubuntu-island-agent-harness-menu');
        this.harnessMenu.x_expand = this.harnessMenu.y_expand = true;
        this.harnessMenu.x_align = Clutter.ActorAlign.START; this.harnessMenu.y_align = Clutter.ActorAlign.START;
        this.harnessMenu.hide(); this.composer.add_child(this.harnessMenu);
        this.harnessMenu.connect('notify::visible', () => {
            if (!this.harnessMenu.visible) this.providerButton.remove_accessible_state(Atk.StateType.EXPANDED);
        });
        for (const [provider, name] of Object.entries(AGENTS)) {
            const option = textButton(name, () => {
                this.provider = provider; this.settings.set_string('agents-provider', provider);
                this.harnessMenu.hide(); this._syncEditor(); this._focusPrompt();
            });
            option.accessible_name = name; this.harnessMenu.add_child(option);
        }
        const project = row('ubuntu-island-agent-project'); this.editor.add_child(project);
        project.add_child(new St.Icon({icon_name:'folder-symbolic', icon_size:14, y_align:Clutter.ActorAlign.CENTER}));
        this.folder = new St.Entry({style_class:'ubuntu-island-agent-entry', can_focus:true, x_expand:true,
            text:settings.get_string('agents-project') || GLib.get_home_dir(), accessible_name:'Project folder'});
        project.add_child(this.folder);
        this.hint = wrap(''); this.editor.add_child(this.hint);
        this.prompt.clutter_text.connect('text-changed', () => setEnabled(this.submit, Boolean(this.prompt.text.trim())));
        this.prompt.clutter_text.connect('key-focus-in', () => this.composer.add_style_pseudo_class('focus'));
        this.prompt.clutter_text.connect('key-focus-out', () => this.composer.remove_style_pseudo_class('focus'));
        this.prompt.connect('button-press-event', () => { this.harnessMenu.hide(); return Clutter.EVENT_PROPAGATE; });
        this.harnessMenu.connect('key-press-event', (_actor, event) => {
            const key = event.get_key_symbol();
            if ([Clutter.KEY_Escape, Clutter.KEY_Tab, Clutter.KEY_ISO_Left_Tab].includes(key)) {
                this.harnessMenu.hide(); this._focusPrompt(); return Clutter.EVENT_STOP;
            }
            if ([Clutter.KEY_Up, Clutter.KEY_Down].includes(key)) {
                const children = this.harnessMenu.get_children();
                const index = children.findIndex(child => child.contains(global.stage.get_key_focus()));
                children[(index + (key === Clutter.KEY_Up ? -1 : 1) + children.length) % children.length].grab_key_focus();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.sessionMenu = column('ubuntu-island-agent-session-menu');
        this.sessionMenu.reactive = true;
        this.sessionMenu.x_expand = this.sessionMenu.y_expand = true;
        this.sessionMenu.x_align = Clutter.ActorAlign.END; this.sessionMenu.y_align = Clutter.ActorAlign.START;
        this.menuIdentity = new St.Entry({style_class:'ubuntu-island-agent-entry', can_focus:true,
            reactive:true, accessible_name:'Session ID'});
        this.menuIdentity.clutter_text.editable = false;
        this.sessionMenu.add_child(this.menuIdentity);
        this.menuUpdated = label('', 'ubuntu-island-agent-menu-note'); this.sessionMenu.add_child(this.menuUpdated);
        this.hideSession = textButton('', () => {
            const id = this.menuSession?.session.id;
            this._closeSessionMenu();
            if (id) void this._control({control:'dismiss', id});
        });
        const hideFace = row('ubuntu-island-agent-toolbar');
        hideFace.add_child(new St.Icon({icon_name:'view-conceal-symbolic',icon_size:14}));
        hideFace.add_child(label('Hide session', 'ubuntu-island-agent-message'));
        this.hideSession.set_child(hideFace); this.sessionMenu.add_child(this.hideSession);
        this.sessionMenu.hide(); this.stack.add_child(this.sessionMenu);
        this.sessionMenu.connect('notify::allocation', () => this._positionSessionMenu());
        this.sessionMenu.connect('captured-event', (_actor, event) => {
            if (event.type() !== Clutter.EventType.KEY_PRESS) return Clutter.EVENT_PROPAGATE;
            const key = event.get_key_symbol();
            const backward = key === Clutter.KEY_ISO_Left_Tab || event.get_state() & Clutter.ModifierType.SHIFT_MASK;
            if (key === Clutter.KEY_Escape) {
                this._closeSessionMenu(true); return Clutter.EVENT_STOP;
            }
            if ([Clutter.KEY_Tab, Clutter.KEY_ISO_Left_Tab].includes(key)) {
                if (backward && this.hideSession.has_key_focus()) this.menuIdentity.grab_key_focus();
                else if (!backward && this.menuIdentity.contains(global.stage.get_key_focus())) this.hideSession.grab_key_focus();
                else this._closeSessionMenu(true);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.adjustment.connect('notify::value', () => { this._closeSessionMenu(); this._syncMotion(); });
        this.scroll.connect('notify::allocation', () => this._syncMotion());
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
        this.prompt.clutter_text.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Return && event.get_state() & Clutter.ModifierType.CONTROL_MASK) {
                this._submit(); return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.actor.connect('notify::mapped', () => {
            if (this.actor.mapped) { this.regroup = true; this.actions.agentExpire?.(); this.render(this.snapshot); }
            else { this._cancelFocus(); this.harnessMenu.hide(); this._closeSessionMenu(); }
            this._syncMotion();
        });
        this.stSettings = St.Settings.get();
        const motion = this.stSettings.connect('notify::enable-animations', () => this._syncMotion());
        const preference = settings.connect('changed::disable-animations', () => this._syncMotion());
        const providerChanged = settings.connect('changed::agents-provider', () => {
            if (this.mode === 'ask') this._syncEditor();
            else this.render(this.snapshot);
        });
        const focus = global.stage.connect('notify::key-focus', () => {
            // Read focus after Clutter finishes changing it and allocating the
            // target. A single coalesced idle also avoids fighting native scroll.
            if (!this.actor.mapped || this.revealIdle) return;
            this.revealIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this.revealIdle = 0; this._revealFocus(); return GLib.SOURCE_REMOVE;
            });
        });
        this.actor.connect('destroy', () => {
            this.dead = true;
            if (this.menuCapture) global.stage.disconnect(this.menuCapture);
            this.menuCapture = 0;
            this._cancelFocus();
            this.stSettings.disconnect(motion); settings.disconnect(preference); settings.disconnect(providerChanged);
            global.stage.disconnect(focus);
        });
        this.regroup = true; this.show('list');
    }
    _revealFocus() {
        const target = global.stage.get_key_focus();
        if (this.sessionMenu.visible && target && !this.sessionMenu.contains(target) && !this.menuSession?.menu.contains(target))
            this._closeSessionMenu();
        if (this.harnessMenu.visible && target && !this.harnessMenu.contains(target) && !this.providerButton.contains(target))
            this.harnessMenu.hide();
        if (!this.actor.mapped || !target?.mapped || !this.content.contains(target)) return;
        // Keep the session's title and status together when its menu button
        // receives focus, rather than revealing just the small button.
        const item = this.mode === 'list' && [...this.rows.values()].find(row => row.actor.contains(target));
        const visibleTarget = item?.actor || target;
        // Use content coordinates: native focus scrolling can update the
        // adjustment before transformed positions catch up on the next frame.
        let top = 0;
        for (let actor = visibleTarget; actor !== this.content; actor = actor.get_parent())
            top += actor.y;
        const height = visibleTarget.height, page = this.adjustment.page_size;
        const value = this.adjustment.value;
        const next = top < value || height > page ? top : Math.max(value, top + height - page);
        // A still-running wheel transition must not pull keyboard focus back
        // outside the viewport on the next frame.
        this.adjustment.remove_transition('value');
        this.adjustment.value = Math.max(this.adjustment.lower,
            Math.min(this.adjustment.upper - page, next));
    }
    _syncMotion() {
        if (this.dead) return;
        const run = this.actor.mapped && this.mode === 'list' && this.snapshot?.connected &&
            this.stSettings?.enable_animations && !this.settings.get_boolean('disable-animations');
        if (!run) {
            for (const item of this.rows.values()) this._spin(item.glyph, false);
            return;
        }
        const top = this.scroll.get_transformed_position()[1], bottom = top + this.scroll.height;
        for (const item of this.rows.values()) {
            const y = item.actor.get_transformed_position()[1];
            this._spin(item.glyph, run && item.glyph.mapped && item.session.state === 'working' && y + item.actor.height > top && y < bottom);
        }
    }
    _spin(actor, run) {
        if (run && !actor.get_transition('agent-working')) {
            const interval = new Clutter.Interval({value_type:GObject.TYPE_DOUBLE}); interval.set_initial(0); interval.set_final(360);
            actor.add_transition('agent-working', new Clutter.PropertyTransition({property_name:'rotation-angle-z',
                interval, duration:1800, repeat_count:-1, progress_mode:Clutter.AnimationMode.LINEAR}));
        } else if (!run) { actor.remove_transition('agent-working'); actor.rotation_angle_z = 0; }
    }
    _chooseHarness() {
        this.harnessMenu.visible = !this.harnessMenu.visible;
        if (this.harnessMenu.visible) {
            this.providerButton.add_accessible_state(Atk.StateType.EXPANDED);
            const items = this.harnessMenu.get_children();
            const selected = Object.keys(AGENTS).indexOf(this.provider);
            items.forEach((item, index) => {
                item.set_style_pseudo_class(index === selected ? 'checked' : '');
                item.accessible_name = `${Object.values(AGENTS)[index]}${index === selected ? ', selected' : ''}`;
            });
            items[Math.max(0, selected)].grab_key_focus();
        } else { this.providerButton.remove_accessible_state(Atk.StateType.EXPANDED); this._focusPrompt(); }
    }
    _focusPrompt() {
        this._cancelFocus();
        this.focusIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this.focusIdle = 0;
            if (!this.dead && this.actor.mapped && this.mode === 'ask') this.prompt.grab_key_focus();
            return GLib.SOURCE_REMOVE;
        });
    }
    _syncEditor() {
        this.provider = this.settings.get_string('agents-provider');
        this.providerLabel.text = AGENTS[this.provider];
        this.providerButton.accessible_name = `Choose harness. ${AGENTS[this.provider]} selected`;
        if (!this.harnessMenu.visible) this.providerButton.remove_accessible_state(Atk.StateType.EXPANDED);
        this.hint.text = ''; this.hint.hide();
        this.hint.remove_style_class_name('ubuntu-island-agent-error');
        setEnabled(this.submit, Boolean(this.prompt.text.trim()));
    }
    _submit() {
        if (this.mode !== 'ask' || !this.submit.reactive) return;
        try {
            if (!this.prompt.text.trim()) throw new Error('Write a prompt before starting a session.');
            if (this.folder.text.trim() && !this.folder.text.trim().startsWith('/')) throw new Error('Enter an absolute project folder, such as /home/you/project.');
            const message = this.actions.agentAsk({provider:this.provider, prompt:this.prompt.text, cwd:this.folder.text.trim() || GLib.get_home_dir()});
            this.settings.set_string('agents-project', this.folder.text.trim() || GLib.get_home_dir());
            this.submit.grab_key_focus();
            this.prompt.text = ''; this.show('list'); this.message.text = message; this.askButton.grab_key_focus();
        } catch (error) {
            this.hint.text = error.message; this.hint.show(); this.hint.add_style_class_name('ubuntu-island-agent-error');
            // Scroll the inline error into view without discarding the draft.
            this.adjustment.value = this.adjustment.upper;
        }
    }
    _cancelFocus() {
        if (this.focusIdle) GLib.Source.remove(this.focusIdle);
        if (this.revealIdle) GLib.Source.remove(this.revealIdle);
        this.focusIdle = this.revealIdle = 0;
    }
    show(mode, focusPrompt = true) {
        this._cancelFocus();
        this._closeSessionMenu();
        this.mode = mode;
        this.harnessMenu.hide();
        this.back.accessible_name = 'Back to sessions';
        this.heading.text = mode === 'ask' ? 'Quick Ask' : 'Agents';
        this.back.visible = mode !== 'list'; this.clearButton.visible = this.notchButton.visible = mode === 'list'; this.summary.visible = mode === 'list';
        this.list.visible = mode === 'list'; this.editor.visible = mode === 'ask';
        this.askButton.visible = mode === 'list';
        this.footer.visible = mode === 'list'; this.undoRow.visible = mode === 'list' && Boolean(this.snapshot?.undo);
        this.message.text = ''; this.adjustment.remove_transition('value'); this.adjustment.value = 0;
        if (mode === 'ask') {
            this._syncEditor();
            if (focusPrompt) this._focusPrompt();
        }
        else if (mode === 'list') this.render(this.snapshot);
        this._syncMotion(); this.actions.relayout?.();
    }
    handleEscape() {
        if (this.sessionMenu.visible) { this._closeSessionMenu(true); return true; }
        if (this.harnessMenu.visible) { this.harnessMenu.hide(); this._focusPrompt(); return true; }
        if (this.mode === 'list') return false;
        const previous = this.mode;
        this.show('list', false);
        if (previous === 'ask') this.askButton.grab_key_focus();
        return true;
    }
    _containsPoint(actor, event) {
        if (!actor?.mapped) return false;
        const [x,y] = event.get_coords(), [left,top] = actor.get_transformed_position(), [width,height] = actor.get_transformed_size();
        return x >= left && x <= left + width && y >= top && y <= top + height;
    }
    _closeSessionMenu(restoreFocus = false) {
        if (this.menuCapture) global.stage.disconnect(this.menuCapture);
        this.menuCapture = 0;
        const anchor = this.menuSession?.menu;
        this.sessionMenu.hide(); this.menuSession = null;
        anchor?.remove_accessible_state(Atk.StateType.EXPANDED);
        anchor?.remove_style_pseudo_class('active');
        if (restoreFocus && anchor?.mapped) anchor.grab_key_focus();
    }
    _session(item) {
        const wasOpen = this.menuSession === item;
        this._closeSessionMenu();
        if (wasOpen) { item.menu.grab_key_focus(); return; }
        this.menuSession = item;
        const time = new Date(item.session.updated).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        this.menuIdentity.text = item.session.session || item.session.id;
        this.menuIdentity.accessible_name = `${AGENTS[item.session.provider]} session ID, profile ${item.session.profile || 'default'}`;
        this.menuUpdated.text = `Last activity · ${time}`;
        this.hideSession.accessible_name = `Hide ${item.session.label}, session ${item.reference} from the list. Keep the agent running`;
        item.menu.add_accessible_state(Atk.StateType.EXPANDED); item.menu.add_style_pseudo_class('active');
        this.sessionMenu.show();
        // The island's modal grab can retarget empty-space presses to its root,
        // bypassing the view. Capture only while this small menu is open.
        this.menuCapture = global.stage.connect('captured-event', (_stage, event) => {
            if ([Clutter.EventType.BUTTON_PRESS, Clutter.EventType.TOUCH_BEGIN].includes(event.type()) &&
                !this._containsPoint(this.sessionMenu, event) && !this._containsPoint(this.menuSession?.menu, event))
                this._closeSessionMenu();
            return Clutter.EVENT_PROPAGATE;
        });
        this._positionSessionMenu();
        this.hideSession.grab_key_focus();
    }
    _positionSessionMenu() {
        if (!this.menuSession || !this.sessionMenu.visible) return;
        const anchor = this.menuSession.menu;
        const y = anchor.get_transformed_position()[1] - this.stack.get_transformed_position()[1];
        const height = this.sessionMenu.height || this.sessionMenu.get_preferred_height(-1)[1];
        this.sessionMenu.translation_y = Math.max(0, Math.min(y + anchor.height, this.stack.height - height));
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
    render(snapshot) {
        this.snapshot = snapshot;
        if (!this.actor.mapped || this.mode !== 'list') return;
        const sessions = snapshot?.sessions || [];
        const references = agentSessionReferences(sessions);
        setEnabled(this.clearButton, !this.pending && sessions.some(s => RECENT.has(s.state)));
        this.summary.text = snapshot?.connected ? agentSummary(sessions) : 'Observer offline';
        this.summary.accessible_name = `Last reported: ${this.summary.text}`;
        this.provider = this.settings.get_string('agents-provider');
        this.askTarget.text = this.provider === 'claude' ? 'Claude' : AGENTS[this.provider];
        this.askButton.accessible_name = `Quick Ask with ${AGENTS[this.provider]}`;
        this.empty.visible = sessions.length === 0;
        this.undoRow.visible = Boolean(snapshot?.undo);
        this.undoText.text = snapshot?.undo ? `${snapshot.undo.count} session${snapshot.undo.count === 1 ? '' : 's'} hidden` : '';
        this.message.text = snapshot?.message || (snapshot?.dropped ? 'Some events were missed. Status is the last report received.' : '');
        for (const [id, item] of this.rows) if (!sessions.some(s => s.id === id)) {
            if (this.menuSession === item) this._closeSessionMenu();
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
                const harness = new St.Icon({icon_size:24, y_align:Clutter.ActorAlign.CENTER,
                    style_class:'ubuntu-island-agent-harness-icon'}); face.add_child(harness);
                const details = column('ubuntu-island-agent-details'); details.x_expand = true; face.add_child(details);
                const title = label('', 'ubuntu-island-agent-title'), status = label('', 'ubuntu-island-agent-state');
                const stateRow = row('ubuntu-island-agent-state-row');
                const glyph = new St.Icon({icon_size:12,y_align:Clutter.ActorAlign.CENTER}); glyph.set_pivot_point(0.5,0.5);
                stateRow.add_child(glyph); stateRow.add_child(status); details.add_child(title); details.add_child(stateRow);
                const arrow = new St.Icon({icon_name:'go-next-symbolic',icon_size:12,y_align:Clutter.ActorAlign.CENTER,
                    style_class:'ubuntu-island-agent-open-arrow'}); face.add_child(arrow);
                item = {actor, title, status, open, glyph, harness, arrow, session};
                open.connect('clicked', () => { if (open.reactive) this.actions.agentOpen(item.session); });
                item.menu = button('view-more-symbolic', 'Session options', () => this._session(item), 14, 'ubuntu-island-agent-menu-button'); actor.add_child(item.menu);
                item.menu.y_align = Clutter.ActorAlign.CENTER;
                this.activeList.add_child(actor); this.rows.set(session.id, item);
                glyph.connect('notify::mapped', () => this._syncMotion());
                actor.connect('notify::allocation', () => this._syncMotion());
            }
            item.session = session; item.title.text = session.label;
            item.reference = references.get(session.id);
            const state = AGENT_STATES[session.state] || 'Unknown';
            item.status.text = `${state} · ${item.reference}`;
            item.harness.gicon = harnessIcons.get(session.provider);
            item.harness.accessible_name = AGENTS[session.provider];
            item.glyph.gicon = icons.get(session.state) || icons.get('unknown');
            item.glyph.set_style_class_name(`ubuntu-island-agent-${session.state}`);
            const canOpen = Boolean(this.actions.agentWindow?.(session));
            if (!canOpen && item.open.has_key_focus()) item.menu.grab_key_focus();
            setEnabled(item.open, canOpen); item.open.track_hover = canOpen; item.arrow.visible = canOpen;
            item.open.accessible_role = canOpen ? Atk.Role.PUSH_BUTTON : Atk.Role.PANEL;
            item.open.accessible_name = `${canOpen ? 'Open window for ' : ''}${session.label}, ${AGENTS[session.provider]}, session ${item.reference}. Last reported ${state} at ${new Date(session.updated).toLocaleString()}`;
            item.menu.accessible_name = `Options for ${session.label}, session ${item.reference}`;
        }
        if (this.regroup) {
            for (const session of [...sessions].sort((a,b) => PRIORITY[a.state] - PRIORITY[b.state] || b.updated - a.updated)) {
                const actor = this.rows.get(session.id).actor;
                actor.get_parent().remove_child(actor); this.activeList.add_child(actor);
            }
            this.regroup = false;
        }
        this._syncMotion();
    }
}
