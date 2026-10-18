/**
 * Logic check for `client.js` of `@local/dsh-done-notify`.
 *
 * Runs the real module inside a Node VM with a small React hooks stub, a
 * listener-recording DOM stub, fake timers, fake Web Notification, and a fake
 * `ctx.configForms` service. It drives both surfaces through their real decision
 * paths:
 *
 * 1. notifier: idle-transition detection, main-view / subagent filtering, focus
 *    state, system notices, stacking, auto-dismiss, hover pause, click-to-open;
 * 2. settings page: live config values, switch/segment writes, write failures,
 *    permission states, loading state, and the test-notice button;
 * 3. settings bridge: fallback namespace, nested-namespace resolution, and the
 *    overlay/settings registrations produced by `apply`.
 *
 * This is a decision-and-branch check, NOT visual verification: no CSS is
 * applied and nothing is rendered in a browser.
 *
 * Run: node check.mjs
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');
const hostSource = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const localeEn = JSON.parse(readFileSync(new URL('./locale/en.json', import.meta.url), 'utf8'));
const localeZh = JSON.parse(readFileSync(new URL('./locale/zh.json', import.meta.url), 'utf8'));

const DEFAULT_SETTINGS = {
	notifyWhenFocused: true,
	systemNotifications: true,
	notifySubagents: false,
	toastLifetimeSeconds: 12,
};

/* ------------------------------------------------------------------ timers */

let clock = 0;
let nextTimerId = 1;
const timers = new Map();

function fakeSetTimeout(callback, delay) {
	const id = nextTimerId++;
	const ms = Number(delay);
	timers.set(id, { at: clock + (Number.isFinite(ms) ? ms : 0), callback });
	return id;
}
function fakeClearTimeout(id) {
	timers.delete(id);
}
function flushTimers() {
	for (let guard = 0; guard < 1000; guard++) {
		const due = [...timers.entries()].filter(([, timer]) => timer.at <= clock).sort((a, b) => a[1].at - b[1].at);
		if (due.length === 0) return;
		for (const [id, timer] of due) {
			if (!timers.delete(id)) continue;
			timer.callback();
		}
	}
	throw new Error('timer flush did not settle');
}
function advance(ms) {
	clock += ms;
	flushTimers();
}

/* ---------------------------------------------------------------- mini React */

let CURRENT = null;
let CURSOR = 0;
let EFFECTS = [];

function sameDeps(left, right) {
	if (left === undefined || right === undefined) return false;
	if (left.length !== right.length) return false;
	for (let i = 0; i < left.length; i++) if (!Object.is(left[i], right[i])) return false;
	return true;
}

const react = {
	createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
	useState: (initial) => {
		const index = CURSOR++;
		const slots = CURRENT.slots;
		if (slots[index] === undefined) {
			slots[index] = { kind: 'state', value: typeof initial === 'function' ? initial() : initial };
		}
		const slot = slots[index];
		const set = (next) => {
			slot.value = typeof next === 'function' ? next(slot.value) : next;
		};
		return [slot.value, set];
	},
	useRef: (initial) => {
		const index = CURSOR++;
		const slots = CURRENT.slots;
		if (slots[index] === undefined) slots[index] = { kind: 'ref', value: { current: initial } };
		return slots[index].value;
	},
	useCallback: (fn, deps) => {
		const index = CURSOR++;
		const slots = CURRENT.slots;
		const previous = slots[index];
		if (previous !== undefined && previous.kind === 'callback' && sameDeps(previous.deps, deps)) return previous.fn;
		slots[index] = { kind: 'callback', fn, deps };
		return fn;
	},
	useEffect: (fn, deps) => {
		EFFECTS.push({ index: CURSOR++, fn, deps });
	},
};

const liveInstances = [];

function createInstance(component, makeProps) {
	const instance = {
		component,
		makeProps,
		slots: [],
		tree: null,
		render() {
			CURRENT = instance;
			CURSOR = 0;
			EFFECTS = [];
			const tree = component(makeProps(instance));
			for (const effect of EFFECTS) {
				const previous = instance.slots[effect.index];
				if (previous !== undefined && previous.kind === 'effect' && sameDeps(previous.deps, effect.deps)) continue;
				if (previous !== undefined && typeof previous.cleanup === 'function') previous.cleanup();
				const cleanup = effect.fn();
				instance.slots[effect.index] = {
					kind: 'effect',
					deps: effect.deps,
					cleanup: typeof cleanup === 'function' ? cleanup : undefined,
				};
			}
			instance.tree = tree;
			return tree;
		},
		unmount() {
			for (const slot of instance.slots) {
				if (slot !== undefined && typeof slot.cleanup === 'function') slot.cleanup();
			}
			instance.slots.length = 0;
			instance.tree = null;
		},
	};
	liveInstances.push(instance);
	return instance;
}

function unmountAll() {
	for (const instance of liveInstances.splice(0)) instance.unmount();
}

/* -------------------------------------------------------------------- DOM */

const documentListeners = [];
const windowListeners = [];
const styleTags = [];

const documentStub = {
	hidden: false,
	hasFocus: () => true,
	body: {},
	head: {
		appendChild: (tag) => {
			styleTags.push(tag);
		},
	},
	createElement: () => {
		const tag = {
			dataset: {},
			textContent: '',
			removed: false,
			remove() {
				tag.removed = true;
			},
		};
		return tag;
	},
	addEventListener: (type, listener) => documentListeners.push({ type, listener }),
	removeEventListener: (type, listener) => {
		const index = documentListeners.findIndex((entry) => entry.type === type && entry.listener === listener);
		if (index >= 0) documentListeners.splice(index, 1);
	},
};

class FakeNotification {
	static permission = 'default';
	static requests = 0;
	static instances = [];
	static requestPermission() {
		FakeNotification.requests += 1;
		FakeNotification.permission = 'granted';
		return Promise.resolve('granted');
	}
	constructor(title, options) {
		this.title = title;
		this.options = options ?? {};
		this.closed = false;
		FakeNotification.instances.push(this);
	}
	close() {
		this.closed = true;
	}
}

const windowStub = {
	__ModuleLoader__: {
		load: (value) => {
			registration = value;
		},
	},
	Notification: FakeNotification,
	setTimeout: fakeSetTimeout,
	clearTimeout: fakeClearTimeout,
	setInterval: () => 0,
	clearInterval: () => {},
	addEventListener: (type, listener) => windowListeners.push({ type, listener }),
	removeEventListener: (type, listener) => {
		const index = windowListeners.findIndex((entry) => entry.type === type && entry.listener === listener);
		if (index >= 0) windowListeners.splice(index, 1);
	},
	focus: () => {
		windowStub.focused += 1;
	},
	focused: 0,
	innerWidth: 1440,
	innerHeight: 900,
};

let registration;
const sandbox = {
	window: windowStub,
	document: documentStub,
	console,
	setTimeout: fakeSetTimeout,
	clearTimeout: fakeClearTimeout,
	setInterval: () => 0,
	clearInterval: () => {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'client.js' });
const SandboxMap = vm.runInContext('Map', sandbox);
const SandboxPromise = vm.runInContext('Promise', sandbox);

assert.ok(registration !== undefined, 'client module registered a factory');
assert.equal(registration.id, packageJson.name, 'factory id equals the package name');

/* ------------------------------------------------------------ fake settings */

/**
 * One settings-form service double with the exact surface the bridge uses:
 * a describe mirror plus per-namespace forms with revision-free writes.
 */
function createConfigForms() {
	const mirrorListeners = new Set();
	let mirrorState = { status: 'idle', view: undefined, error: null };
	const forms = new Map();
	const writes = [];
	let acceptWrites = true;
	let revision = 1;

	function createForm(ns) {
		const listeners = new Set();
		let state = { status: 'loading', value: undefined, base: undefined, user: undefined, revision: 0, writable: true };
		return {
			ns,
			getSnapshot: () => state,
			subscribe: (listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
			publish(next) {
				state = { ...state, ...next };
				for (const listener of [...listeners]) listener();
			},
			set(field, value) {
				writes.push({ ns, field, value });
				if (!acceptWrites) return SandboxPromise.resolve(false);
				state = {
					...state,
					status: 'ready',
					writable: true,
					revision: revision++,
					value: { ...(state.value ?? {}), [field]: value },
				};
				for (const listener of [...listeners]) listener();
				return SandboxPromise.resolve(true);
			},
		};
	}

	return {
		writes,
		forms,
		setAcceptWrites(next) {
			acceptWrites = next;
		},
		describe: () => ({
			getSnapshot: () => mirrorState,
			subscribe: (listener) => {
				mirrorListeners.add(listener);
				return () => {
					mirrorListeners.delete(listener);
				};
			},
			ensure: () => SandboxPromise.resolve(),
		}),
		get(ns) {
			if (!forms.has(ns)) forms.set(ns, createForm(ns));
			return forms.get(ns);
		},
		serve(ns, value) {
			const form = this.get(ns);
			mirrorState = {
				status: 'ready',
				view: { writable: true, namespaces: [{ ns, schema: {}, value, revision: revision++ }] },
				error: null,
			};
			for (const listener of [...mirrorListeners]) listener();
			form.publish({ status: 'ready', writable: true, value, revision: revision++ });
			return form;
		},
	};
}

/* ---------------------------------------------------------------- wiring */

function makeContext(configForms, localeState) {
	const captured = {
		effectLabels: [],
		registrations: new Map(),
		dicts: undefined,
		ns: undefined,
	};
	const ctx = {
		locale: {
			register: (ns, dicts) => {
				captured.ns = ns;
				captured.dicts = dicts;
				return () => {};
			},
			getSnapshot: () => localeState,
		},
		effect: (callback, label) => {
			captured.effectLabels.push(label);
			callback();
			return () => {};
		},
		get: (name) => {
			if (name === 'uiWorkspace') return { openSession: (sessionId) => openSessions.push(sessionId) };
			if (name === 'configForms') return configForms;
			return undefined;
		},
		slots: {
			inject: (key, callback) => {
				const disposer = callback();
				return typeof disposer === 'function' ? disposer : () => {};
			},
			register: (options, component) => {
				captured.registrations.set(options.name, { options, component });
				return () => {};
			},
		},
	};
	return { ctx, captured };
}

const plugin = registration.factory((spec) => {
	if (spec === 'react') return react;
	assert.fail(`unexpected import: ${spec}`);
});
assert.deepEqual([...plugin.inject], ['slots', 'locale'], 'declares slots and locale');

const openSessions = [];
const localeState = { active: 'zh', revision: 0 };
const configForms = createConfigForms();
const { ctx, captured } = makeContext(configForms, localeState);
plugin.apply(ctx);

/* Registration surface. */
assert.equal(captured.ns, 'done-notify', 'locale namespace');
assert.ok(captured.dicts.zh !== undefined && captured.dicts.en !== undefined, 'both dictionaries registered');
assert.deepEqual(
	captured.effectLabels,
	['done-notify: dictionaries', 'done-notify: stylesheet', 'done-notify: notification permission',
		'done-notify: settings bridge'],
	'effects installed in order',
);
assert.equal(styleTags.length, 1, 'one stylesheet tag inserted');
assert.equal(styleTags[0].dataset.plugin, '@local/dsh-done-notify');
assert.ok(styleTags[0].textContent.includes('.dshDoneNotify_switch[aria-checked=true]'), 'switch styles present');
assert.ok(styleTags[0].textContent.includes('.dshDoneNotify_row'), 'settings row styles present');

const overlay = captured.registrations.get('shell.overlay');
const section = captured.registrations.get('settings.section');
assert.ok(overlay !== undefined, 'notifier registered in shell.overlay');
assert.equal(overlay.options.id, 'done-notify');
assert.equal(overlay.options.order, 80);
assert.equal(overlay.options.locale, 'done-notify');
assert.ok(section !== undefined, 'settings page registered in settings.section');
assert.equal(section.options.id, 'done-notify');
assert.equal(section.options.order, 25);
assert.equal(section.options.locale, 'done-notify');
assert.equal(typeof section.options.label, 'function', 'nav label is a projection thunk');
assert.equal(section.options.label(), '运行通知', 'zh nav label');
localeState.active = 'en';
assert.equal(section.options.label(), 'Run notifications', 'en nav label follows the locale');
localeState.active = 'zh';

const overlayInject = overlay.options.inject();
const sectionInject = section.options.inject();
assert.equal(typeof overlayInject.hooks.notifierSettings.getSnapshot, 'function', 'notifier gets the shared store');
assert.equal(typeof sectionInject.hooks.notifierSettings.getSnapshot, 'function', 'page gets the shared store');
assert.equal(typeof sectionInject.setNotifierSetting, 'function', 'page gets the write path');

const settingsStore = overlayInject.hooks.notifierSettings;
assert.equal(settingsStore.getSnapshot().status, 'loading', 'settings start in the loading state');
assert.deepEqual({ ...settingsStore.getSnapshot().values }, DEFAULT_SETTINGS, 'defaults are shown while loading');
assert.equal(configForms.forms.has('done-notify'), true, 'the bridge binds the row-id namespace first');

/* --------------------------------------------------------- permission prompt */

assert.ok(overlayInject !== undefined);
const pointerdown = documentListeners.filter((entry) => entry.type === 'pointerdown');
assert.equal(pointerdown.length, 1, 'first-gesture permission prompt installed');
pointerdown[0].listener();
assert.equal(FakeNotification.requests, 1, 'gesture asks for the NOTIFICATION permission once');
assert.equal(documentListeners.filter((entry) => entry.type === 'pointerdown').length, 0, 'listener removed after asking');

/* ----------------------------------------------- registrations without forms */

{
	const bare = createConfigForms();
	const bareCtx = makeContext(bare, { active: 'zh', revision: 0 });
	bareCtx.ctx.get = (name) => (name === 'configForms' ? undefined : bareCtx.ctx.get(name));
	plugin.apply(bareCtx.ctx);
	assert.ok(bareCtx.captured.registrations.has('shell.overlay'), 'notifier still registers without configForms');
	assert.equal(bareCtx.captured.registrations.has('settings.section'), false, 'no page without a settings service');
	const bareOverlay = bareCtx.captured.registrations.get('shell.overlay');
	assert.equal(bareOverlay.options.inject, undefined, 'no settings hook without a bridge');
}

/* ------------------------------------------------------------ render helpers */

function translate(locale) {
	const dict = captured.dicts[locale];
	return function t(key, params) {
		const template = dict[key] ?? key;
		if (params === undefined) return template;
		return template.replace(/\{(\w+)\}/gu, (match, name) => (name in params ? String(params[name]) : match));
	};
}
const tZh = translate('zh');
const tEn = translate('en');

function sessionRow(id, options = {}) {
	return {
		id,
		sessionId: id,
		running: options.running === true,
		retainedBy: options.mainView === true ? { mainView: 1 } : {},
		...(options.subagent === true ? { origin: 'subagent', parentSessionId: 'session-parent' } : {}),
	};
}

function statusOf(rows) {
	const map = new SandboxMap();
	for (const row of rows) map.set(row.id, { running: row.running, pendingInteraction: undefined, completionUnread: false });
	return map;
}

function listOf(rows) {
	const byId = {};
	for (const row of rows) byId[row.id] = row;
	return { phase: 'ready', ids: rows.map((row) => row.id), byId };
}

function textOf(node) {
	if (node === null || node === undefined || node === false) return '';
	if (typeof node === 'string' || typeof node === 'number') return String(node);
	if (Array.isArray(node)) return node.map(textOf).filter(Boolean).join(' ');
	return (node.children ?? []).map(textOf).filter(Boolean).join(' ');
}

function findAll(node, predicate, out = []) {
	if (node === null || node === undefined) return out;
	if (Array.isArray(node)) {
		for (const child of node) findAll(child, predicate, out);
		return out;
	}
	if (typeof node !== 'object') return out;
	if (predicate(node)) out.push(node);
	findAll(node.children, predicate, out);
	return out;
}

const byClass = (className) => (node) => node.props?.className === className;

function toastsOf(tree) {
	return findAll(tree, byClass('dshDoneNotify_toast'));
}
function titlesOf(tree) {
	return findAll(tree, byClass('dshDoneNotify_title')).map((node) => textOf(node));
}
function bodiesOf(tree) {
	return findAll(tree, byClass('dshDoneNotify_body')).map((node) => textOf(node));
}
function notesOf(tree) {
	return findAll(tree, byClass('dshDoneNotify_note')).map((node) => textOf(node));
}

function setWindowState({ hidden = false, focused = true } = {}) {
	documentStub.hidden = hidden;
	documentStub.hasFocus = () => focused;
}

function resetWorld() {
	setWindowState({ hidden: false, focused: true });
	FakeNotification.permission = 'granted';
	FakeNotification.requests = 0;
	FakeNotification.instances.length = 0;
	openSessions.length = 0;
	windowStub.focused = 0;
	timers.clear();
	clock = 0;
	unmountAll();
}

const notifierComponent = overlay.component;
const pageComponent = section.component;

/** One notifier instance bound to the shared settings store. */
function createNotifierInstance(locale = 'zh') {
	return createInstance(notifierComponent, (instance) => ({
		useNotifierSettings: (selector) => selector(settingsStore.getSnapshot()),
		useSessionStatus: (selector) => selector(instance.status ?? new SandboxMap()),
		useSessions: (selector) => selector(instance.sessions ?? listOf([])),
		t: locale === 'en' ? tEn : tZh,
	}));
}

/** Publish a config change through the real form → bridge path. */
function publishConfig(overrides) {
	const value = { ...DEFAULT_SETTINGS, ...overrides };
	const form = configForms.forms.get('done-notify');
	form.publish({ status: 'ready', writable: true, value, revision: 100 + configForms.writes.length });
}

/** One settings-page instance over the shared bridge. */
function createPageInstance(options = {}) {
	return createInstance(pageComponent, () => ({
		useNotifierSettings: (selector) => selector(settingsStore.getSnapshot()),
		setNotifierSetting: options.setNotifierSetting ?? sectionInject.setNotifierSetting,
		t: options.locale === 'en' ? tEn : tZh,
	}));
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Drive one status publication through a notifier instance. */
function publishStatus(instance, rows, sessionList = listOf(rows)) {
	instance.status = statusOf(rows);
	instance.sessions = sessionList;
	return instance.render();
}

/* ------------------------------------------------ settings page: loading state */

/* 0. The page renders its loading state before the settings document arrives. */
{
	FakeNotification.permission = 'default';
	const page = createPageInstance();
	page.render();
	const text = textOf(page.tree);
	assert.ok(text.includes('正在读取设置…'), 'loading note before the settings document arrives');
	assert.ok(text.includes('当前会话完成时也提示'), 'switches are rendered while loading');
	const switches = findAll(page.tree, (node) => node.props?.role === 'switch');
	assert.equal(switches.length, 3, 'three switches');
	assert.equal(switches.every((node) => node.props.disabled === true), true, 'switches are disabled until ready');
	const intro = findAll(page.tree, byClass('dshDoneNotify_intro')).map(textOf)[0] ?? '';
	assert.ok(intro.includes('配置档案'), 'intro explains where the settings live');
	const rowsWrap = findAll(page.tree, byClass('dshDoneNotify_rows'))[0];
	assert.ok(rowsWrap !== undefined, 'preference rows are grouped under one wrapper');
	assert.equal(findAll(page.tree, byClass('dshDoneNotify_row')).length, 6, 'six preference rows');
	page.render();
	/* Loading note is a status region for assistive tech. */
	const note = findAll(page.tree, byClass('dshDoneNotify_note'))[0];
	assert.equal(note.props.role, 'status');
}

/* --------------------------------------------------------- notifier: basics */

/* 1. A background conversation finishing while focused raises one toast. */
resetWorld();
publishConfig({});
{
	const assistant = createNotifierInstance();
	publishStatus(assistant, [sessionRow('s-alpha', { running: true })]);
	assert.equal(assistant.tree, null, 'nothing is shown while running');
	publishStatus(assistant, [sessionRow('s-alpha')]);
	assistant.render();
	assert.equal(toastsOf(assistant.tree).length, 1, 'one toast after the idle transition');
	assert.deepEqual(titlesOf(assistant.tree), ['对话已完成'], 'localized toast title');
	assert.deepEqual(bodiesOf(assistant.tree), ['会话 -alpha 已结束运行，点击打开'], 'body names the session tail');
	assert.equal(FakeNotification.instances.length, 1, 'OS notice is raised even while the window is focused');
	assert.equal(FakeNotification.instances[0].title, 'DSH · 对话已完成');
	assert.equal(assistant.tree.props['aria-live'], 'polite');
}

/* 1b. English locale swaps every toast string through the locale seat. */
{
	resetWorld();
	const assistant = createNotifierInstance('en');
	publishStatus(assistant, [sessionRow('s-alpha', { running: true })]);
	publishStatus(assistant, [sessionRow('s-alpha')]);
	assistant.render();
	assert.deepEqual(titlesOf(assistant.tree), ['Run finished'], 'English toast title');
	assert.deepEqual(bodiesOf(assistant.tree), ['Session -alpha finished running — click to open'], 'English toast body');
	assert.deepEqual(FakeNotification.instances.map((notice) => notice.title), ['DSH · Run finished'], 'English OS notice title');
}

/* 2. The on-screen conversation finishing also notifies by default. */
{
	resetWorld();
	const assistant = createNotifierInstance();
	publishStatus(assistant, [sessionRow('s-main', { running: true, mainView: true })]);
	publishStatus(assistant, [sessionRow('s-main', { mainView: true })]);
	assistant.render();
	assert.equal(toastsOf(assistant.tree).length, 1, 'in-app toast for the visible conversation');
	assert.equal(FakeNotification.instances.length, 1, 'OS notice for the visible conversation too');
}

/* 3. notifyWhenFocused=false keeps the visible conversation quiet. */
{
	resetWorld();
	publishConfig({ notifyWhenFocused: false });
	const assistant = createNotifierInstance();
	publishStatus(assistant, [sessionRow('s-main', { running: true, mainView: true })]);
	publishStatus(assistant, [sessionRow('s-main', { mainView: true })]);
	assistant.render();
	assert.equal(toastsOf(assistant.tree).length, 0, 'no toast for the visible conversation when switched off');
	publishStatus(assistant, [sessionRow('s-back', { running: true })]);
	publishStatus(assistant, [sessionRow('s-back')]);
	assistant.render();
	assert.equal(toastsOf(assistant.tree).length, 1, 'background conversations still notify');
	assert.equal(FakeNotification.instances.length, 1, 'background completion raises an OS notice as well');
	publishConfig({});
}

/* 4. Hidden window: toast queued + OS notice raised; click opens and focuses. */
{
	resetWorld();
	const assistant = createNotifierInstance();
	publishStatus(assistant, [sessionRow('s-main', { running: true, mainView: true })]);
	setWindowState({ hidden: true, focused: false });
	publishStatus(assistant, [sessionRow('s-main', { mainView: true })]);
	assistant.render();
	assert.equal(toastsOf(assistant.tree).length, 1, 'toast waits for the return');
	assert.equal(FakeNotification.instances.length, 1, 'OS notice raised while away');
	const notice = FakeNotification.instances[0];
	assert.equal(notice.title, 'DSH · 对话已完成');
	assert.ok(notice.options.body.includes('s-main'.slice(-6)), 'OS notice names the session');
	notice.onclick();
	assert.deepEqual(openSessions, ['s-main'], 'OS notice click opens the Session');
	assert.equal(windowStub.focused, 1, 'OS notice click focuses the window');
	advance(60000);
	assistant.render();
	assert.equal(toastsOf(assistant.tree).length, 1, 'toast survives while hidden');
	setWindowState({ hidden: false, focused: true });
	for (const entry of documentListeners.filter((item) => item.type === 'visibilitychange')) entry.listener();
	advance(500);
	assistant.render();
	assert.equal(toastsOf(assistant.tree).length, 1, 'toast still present shortly after return');
	advance(13000);
	assistant.render();
	assert.equal(toastsOf(assistant.tree).length, 0, 'toast dismissed after the lifetime on return');
}

/* 5. systemNotifications=false suppresses OS notices only. */
{
	resetWorld();
	publishConfig({ systemNotifications: false });
	const assistant = createNotifierInstance();
	publishStatus(assistant, [sessionRow('s-quiet', { running: true })]);
	setWindowState({ hidden: true, focused: false });
	publishStatus(assistant, [sessionRow('s-quiet')]);
	assistant.render();
	assert.equal(toastsOf(assistant.tree).length, 1, 'in-app toast still queued');
	assert.equal(FakeNotification.instances.length, 0, 'no OS notice when switched off');
	publishConfig({});
	resetWorld();
}

/* 6. Subagent filtering follows notifySubagents. */
{
	resetWorld();
	const assistant = createNotifierInstance();
	publishStatus(assistant, [sessionRow('s-child', { running: true, subagent: true })]);
	publishStatus(assistant, [sessionRow('s-child', { subagent: true })]);
	assistant.render();
	assert.equal(toastsOf(assistant.tree).length, 0, 'subagent finish is not announced by default');
	assert.equal(FakeNotification.instances.length, 0, 'no OS notice for a filtered subagent finish');
	publishConfig({ notifySubagents: true });
	publishStatus(assistant, [sessionRow('s-child2', { running: true, subagent: true })]);
	publishStatus(assistant, [sessionRow('s-child2', { subagent: true })]);
	assistant.render();
	assert.equal(toastsOf(assistant.tree).length, 1, 'subagent finish is announced when switched on');
	assert.equal(FakeNotification.instances.length, 1, 'subagent completion raises an OS notice when switched on');
	publishConfig({});
}

/* 7. Six background finishes keep only the newest MAX_TOASTS notices. */
{
	resetWorld();
	const assistant = createNotifierInstance();
	const runningRows = Array.from({ length: 6 }, (_, index) => sessionRow(`s-stack-${index}`, { running: true }));
	publishStatus(assistant, runningRows);
	publishStatus(assistant, runningRows.map((row) => sessionRow(row.id)));
	assistant.render();
	assert.equal(toastsOf(assistant.tree).length, 4, 'stack is capped at four');
	assert.deepEqual(
		bodiesOf(assistant.tree),
		['tack-2', 'tack-3', 'tack-4', 'tack-5'].map((tail) => `会话 ${tail} 已结束运行，点击打开`),
		'oldest notices were dropped',
	);
	assert.equal(FakeNotification.instances.length, 6, 'each finished Session is announced in the OS notification center');
}

/* 8. Notice lifetime follows the configured seconds. */
{
	resetWorld();
	publishConfig({ toastLifetimeSeconds: 6 });
	const assistant = createNotifierInstance();
	publishStatus(assistant, [sessionRow('s-life', { running: true })]);
	publishStatus(assistant, [sessionRow('s-life')]);
	assistant.render();
	assert.equal(toastsOf(assistant.tree).length, 1);
	advance(5900);
	assistant.render();
	assert.equal(toastsOf(assistant.tree).length, 1, 'still visible before the configured lifetime');
	advance(200);
	assistant.render();
	assert.equal(toastsOf(assistant.tree).length, 0, 'dismissed at the configured lifetime');
	publishConfig({});
}

/* 9. Hover pauses, click opens, close dismisses, keyboard opens. */
{
	resetWorld();
	const assistant = createNotifierInstance();
	publishStatus(assistant, [sessionRow('s-click', { running: true })]);
	publishStatus(assistant, [sessionRow('s-click')]);
	assistant.render();
	let [toast] = toastsOf(assistant.tree);
	toast.props.onMouseEnter();
	advance(20000);
	assistant.render();
	assert.equal(toastsOf(assistant.tree).length, 1, 'hovering keeps the notice');
	toast = toastsOf(assistant.tree)[0];
	toast.props.onMouseLeave();
	advance(12500);
	assistant.render();
	assert.equal(toastsOf(assistant.tree).length, 0, 'leaving re-arms and then dismisses');

	publishStatus(assistant, [sessionRow('s-open', { running: true })]);
	publishStatus(assistant, [sessionRow('s-open')]);
	assistant.render();
	[toast] = toastsOf(assistant.tree);
	toast.props.onClick();
	assert.deepEqual(openSessions, ['s-open'], 'click opens the finished Session');
	assistant.render();
	assert.equal(toastsOf(assistant.tree).length, 0, 'clicked toast removed');

	publishStatus(assistant, [sessionRow('s-key', { running: true })]);
	publishStatus(assistant, [sessionRow('s-key')]);
	assistant.render();
	[toast] = toastsOf(assistant.tree);
	let prevented = false;
	toast.props.onKeyDown({ key: 'Enter', preventDefault: () => { prevented = true; } });
	assert.equal(prevented, true, 'Enter is consumed');
	assert.deepEqual(openSessions, ['s-open', 's-key'], 'keyboard activation opens the Session');

	publishStatus(assistant, [sessionRow('s-close', { running: true })]);
	publishStatus(assistant, [sessionRow('s-close')]);
	assistant.render();
	const close = findAll(assistant.tree, byClass('dshDoneNotify_close'))[0];
	let stopped = false;
	close.props.onClick({ stopPropagation: () => { stopped = true; } });
	assert.equal(stopped, true, 'close stops the toast click');
	assistant.render();
	assert.equal(toastsOf(assistant.tree).length, 0, 'close removes the notice');
}

/* 13. Serving the namespace makes the page ready and shows the values. */
{
	configForms.serve('done-notify', { ...DEFAULT_SETTINGS });
	FakeNotification.permission = 'granted';
	const page = createPageInstance();
	page.render();
	const text = textOf(page.tree);
	assert.ok(text.includes('修改会立即生效。'), 'ready note');
	assert.ok(text.includes('已授权'), 'permission row reports the granted state');
	const switches = findAll(page.tree, (node) => node.props?.role === 'switch');
	assert.deepEqual(switches.map((node) => node.props['aria-checked']), [true, true, false], 'switch states follow the values');
	const segments = findAll(page.tree, byClass('dshDoneNotify_segment'));
	assert.deepEqual(segments.map(textOf), ['6 秒', '12 秒', '20 秒', '30 秒'], 'lifetime presets');
	assert.deepEqual(segments.map((node) => node.props['aria-pressed']), [false, true, false, false], 'current lifetime selected');
	assert.deepEqual(
		findAll(page.tree, (node) => typeof node.props?.className === 'string' && node.props.className.startsWith('dshDoneNotify_dot'))
			.map((node) => node.props.className),
		['dshDoneNotify_dot dshDoneNotify_dotOk'],
		'permission dot reflects the granted state',
	);
}

/* 13b. An invalid stored lifetime falls back to the default. */
{
	configForms.forms.get('done-notify').publish({
		status: 'ready',
		writable: true,
		value: { ...DEFAULT_SETTINGS, toastLifetimeSeconds: null },
		revision: 999,
	});
	const page = createPageInstance();
	page.render();
	const selected = findAll(page.tree, byClass('dshDoneNotify_segment'))
		.filter((node) => node.props['aria-pressed'] === true)
		.map(textOf);
	assert.deepEqual(selected, ['12 秒'], 'nil lifetime normalizes to the default');
	configForms.forms.get('done-notify').publish({
		status: 'ready',
		writable: true,
		value: { ...DEFAULT_SETTINGS },
		revision: 1000,
	});
}

/* 14. Toggling writes through the bridge and re-renders both surfaces. */
{
	resetWorld();
	const page = createPageInstance();
	page.render();
	const before = configForms.writes.length;
	const switches = findAll(page.tree, (node) => node.props?.role === 'switch');
	switches[0].props.onClick();
	await flush();
	page.render();
	assert.equal(configForms.writes.length, before + 1, 'one Host write queued');
	assert.deepEqual(
		{ field: configForms.writes.at(-1).field, value: configForms.writes.at(-1).value },
		{ field: 'notifyWhenFocused', value: false },
		'notifyWhenFocused written as false',
	);
	assert.equal(findAll(page.tree, (node) => node.props?.role === 'switch')[0].props['aria-checked'], false, 'switch reflects the new value');

	const segments = findAll(page.tree, byClass('dshDoneNotify_segment'));
	segments[2].props.onClick();
	await flush();
	page.render();
	assert.deepEqual(
		{ field: configForms.writes.at(-1).field, value: configForms.writes.at(-1).value },
		{ field: 'toastLifetimeSeconds', value: 20 },
		'segment writes the chosen lifetime',
	);
	assert.equal(notesOf(page.tree)[0], '修改会立即生效。');

	/* The notifier reads the same store: visible finishes go quiet now. */
	const assistant = createNotifierInstance();
	publishStatus(assistant, [sessionRow('s-main', { running: true, mainView: true })]);
	publishStatus(assistant, [sessionRow('s-main', { mainView: true })]);
	assistant.render();
	assert.equal(toastsOf(assistant.tree).length, 0, 'notifier applies the new notifyWhenFocused value immediately');

	publishConfig({});
	page.render();
}

/* 15. A refused write surfaces the localized error. */
{
	resetWorld();
	configForms.setAcceptWrites(false);
	const page = createPageInstance();
	page.render();
	const switches = findAll(page.tree, (node) => node.props?.role === 'switch');
	switches[1].props.onClick();
	await flush();
	page.render();
	const errors = findAll(page.tree, (node) => node.props?.className === 'dshDoneNotify_rowError').map(textOf);
	assert.deepEqual(errors, ['保存失败，请重试。'], 'write failure is reported on its row');
	configForms.setAcceptWrites(true);
	publishConfig({});
	page.render();
}

/* 16. The test button reaches the live notifier and marks the preview. */
{
	resetWorld();
	const assistant = createNotifierInstance();
	assistant.render();
	assert.equal(toastsOf(assistant.tree).length, 0);
	const page = createPageInstance();
	page.render();
	const testButton = findAll(page.tree, byClass('dshDoneNotify_button'))
		.find((node) => textOf(node) === '发送测试');
	assert.ok(testButton !== undefined, 'test button rendered');
	testButton.props.onClick();
	assistant.render();
	assert.equal(toastsOf(assistant.tree).length, 1, 'test notice appears in the toast stack');
	assert.deepEqual(titlesOf(assistant.tree), ['这是一条测试提示'], 'test notice title');
	assert.deepEqual(bodiesOf(assistant.tree), ['若看到此卡片，说明提示工作正常。'], 'test notice body');
	assert.equal(FakeNotification.instances.length, 1, 'system test notice raised too');
	assert.equal(FakeNotification.instances[0].title, 'DSH · 测试通知');
	openSessions.length = 0;
	toastsOf(assistant.tree)[0].props.onClick();
	assert.deepEqual(openSessions, [], 'test notice click does not try to open a Session');
}

/* 17. Permission states shown by the page. */
{
	const previous = windowStub.Notification;
	windowStub.Notification = undefined;
	FakeNotification.permission = 'denied';
	const page = createPageInstance();
	page.render();
	assert.ok(textOf(page.tree).includes('当前环境不支持系统通知'), 'unsupported state');
	windowStub.Notification = previous;

	FakeNotification.permission = 'denied';
	const denied = createPageInstance();
	denied.render();
	assert.ok(textOf(denied.tree).includes('已被拒绝'), 'denied state');

	FakeNotification.permission = 'default';
	const pending = createPageInstance();
	pending.render();
	assert.ok(textOf(pending.tree).includes('尚未授权'), 'not-granted state');
	const request = findAll(pending.tree, byClass('dshDoneNotify_button'))
		.find((node) => textOf(node) === '申请权限');
	assert.ok(request !== undefined, 'permission request button rendered');
	const before = FakeNotification.requests;
	request.props.onClick();
	await flush();
	assert.equal(FakeNotification.requests, before + 1, 'request button asks for the permission');
	FakeNotification.permission = 'granted';
	publishConfig({});
}

/* -------------------------------------------- nested namespace resolution */

/* 18. A profile that nests the row namespace still binds and writes correctly. */
{
	const nestedForms = createConfigForms();
	const nested = makeContext(nestedForms, { active: 'zh', revision: 0 });
	plugin.apply(nested.ctx);
	const nestedSection = nested.captured.registrations.get('settings.section');
	assert.ok(nestedSection !== undefined, 'page registered');
	const store = nested.captured.registrations.get('shell.overlay').options.inject().hooks.notifierSettings;
	assert.equal(store.getSnapshot().status, 'loading');
	assert.equal(nestedForms.forms.has('done-notify'), true, 'row-id namespace bound first');
	/* The Host document serves the nested entry id instead. */
	const nestedForm = nestedForms.serve('include:done-notify', { ...DEFAULT_SETTINGS, toastLifetimeSeconds: 30 });
	assert.notEqual(nestedForm, undefined);
	assert.equal(nestedForms.forms.has('include:done-notify'), true, 'nested namespace bound after the document arrives');
	assert.equal(store.getSnapshot().values.toastLifetimeSeconds, 30, 'values come from the nested namespace');
	const setter = nestedSection.options.inject().setNotifierSetting;
	await setter('toastLifetimeSeconds', 6);
	await flush();
	assert.deepEqual(
		{ ns: nestedForms.writes.at(-1).ns, field: nestedForms.writes.at(-1).field, value: nestedForms.writes.at(-1).value },
		{ ns: 'include:done-notify', field: 'toastLifetimeSeconds', value: 6 },
		'writes go to the nested namespace',
	);
}

/* --------------------------------------------------------------- resources */

/* 19. Package resources and the Host half. */
{
	const icon = readFileSync(new URL('./icon.svg', import.meta.url), 'utf8');
	assert.ok(icon.trimStart().startsWith('<svg'), 'icon is an SVG document');
	assert.ok(!/https?:\/\/(?!www\.w3\.org)/u.test(icon), 'icon references no external artwork');
	assert.deepEqual(
		Object.keys(packageJson.exports).sort(),
		['.', './client', './icon.svg', './locale/*.json', './package.json'].sort(),
		'manifest exports runtime, client, locale and icon entry points',
	);
	assert.equal(packageJson.dsh.bundle.patch, './cordis.patch.yml');
	assert.equal(packageJson.dsh.client.platform, 'web');
	assert.equal(packageJson.dsh.client.immediately, true);
	assert.ok(packageJson.files.includes('client.js') && packageJson.files.includes('index.js'));
	assert.equal(packageJson.license, 'MIT', 'license declared for the public repository');
	assert.equal(packageJson.repository.url, 'git+https://github.com/jqstrong/dsh-done-notify.git');
	assert.equal(packageJson.scripts.check, 'node check.mjs');
	const license = readFileSync(new URL('./LICENSE', import.meta.url), 'utf8');
	assert.ok(license.startsWith('MIT License'), 'LICENSE file present');
	const gitignore = readFileSync(new URL('./.gitignore', import.meta.url), 'utf8');
	assert.ok(gitignore.includes('node_modules/'), 'node_modules are not committed');
	assert.equal(localeEn.meta.title, 'Run Finished Notifications');
	assert.equal(localeZh.meta.title, '运行完成通知');
	assert.ok(localeZh.meta.description.includes('系统通知'));
	/* The Host half serves the four volatile preferences as a settings form. */
	for (const field of ['notifyWhenFocused', 'systemNotifications', 'notifySubagents', 'toastLifetimeSeconds']) {
		assert.ok(hostSource.includes(field), `Host Config declares ${field}`);
	}
	assert.ok(hostSource.includes('.volatile()'), 'every Host preference is volatile (live-editable)');
	assert.ok(hostSource.includes('export const Config'), 'Host exports a Config schema');
	assert.ok(hostSource.includes('export function apply'), 'Host exports apply');
}

console.log('check.mjs: all assertions passed');
