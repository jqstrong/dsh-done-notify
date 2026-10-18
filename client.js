/**
 * Client half of `@local/dsh-done-notify`.
 *
 * Two surfaces, one settings source:
 *
 * 1. Completion notifier in `shell.overlay` (the frame-wide floating layer):
 *    watches the Client's own session-status source and raises a notice when a
 *    conversation changes from `running` to idle. The in-app toast always
 *    appears (unless the finished conversation is the one on screen and that is
 *    switched off); a system-level Web Notification is raised while the window
 *    is hidden or unfocused.
 *
 * 2. A Settings page in `settings.section` ("运行通知" / "Run notifications")
 *    with switches for the behavior, the notice lifetime, the notification
 *    permission status, and a test-notice button.
 *
 * Settings are the plugin's Host `Config` fields (see index.js): every field is
 * volatile, so the official configuration-form pipeline serves them as a live
 * settings namespace, writes them into the profile patch layer, and the UI here
 * edits them through `ctx.configForms` (revision-safe Host writes). The
 * notifier and the page share one bridge over that namespace, so a toggle takes
 * effect immediately without a reload.
 *
 * No Harness Client package is imported: React comes from the page's module
 * table, icons are inline SVG, and every style reads theme tokens.
 */

window.__ModuleLoader__.load({
	id: '@local/dsh-done-notify',
	factory(require) {
		const React = require('react');
		const h = React.createElement;

		/** Locale namespace whose dictionaries carry every visible string. */
		const NS = 'done-notify';
		/** Loader row id; also the Host settings namespace the forms are keyed by. */
		const ROW_ID = 'done-notify';

		/* ---------------------------------------------------------------- config */

		/** Ask for the notification permission on the first pointer/key gesture. */
		const REQUEST_PERMISSION_ON_FIRST_GESTURE = true;
		/** How many notices may stack at once. */
		const MAX_TOASTS = 4;
		/** How long an OS notice stays in the notification center. */
		const SYSTEM_NOTICE_TTL_MS = 15000;
		/** Offered notice lifetimes, in seconds. */
		const LIFETIME_PRESETS = [6, 12, 20, 30];
		/** Fallback values while the Host settings document is not readable yet. */
		const DEFAULT_SETTINGS = Object.freeze({
			notifyWhenFocused: true,
			systemNotifications: true,
			notifySubagents: false,
			toastLifetimeSeconds: 12,
		});
		const FALLBACK_STATE = Object.freeze({
			status: 'fallback',
			writable: false,
			values: DEFAULT_SETTINGS,
		});

		/* --------------------------------------------------------------- locale */

		const zh = {
			title: '对话已完成',
			body: '会话 {id} 已结束运行，点击打开',
			systemTitle: 'DSH · 对话已完成',
			systemBody: '会话 {id} 已结束运行，点击回到会话',
			close: '关闭通知',
			region: '完成通知',
			'toast.testTitle': '这是一条测试提示',
			'toast.testBody': '若看到此卡片，说明提示工作正常。',
			'test.systemTitle': 'DSH · 测试通知',
			'test.systemBody': '系统通知工作正常。',
			'settings.nav': '运行通知',
			'settings.intro': '会话运行结束后会弹出提示。以下设置保存在当前 DSH 配置档案中，重启后依然有效。',
			'settings.loading': '正在读取设置…',
			'settings.unavailable': '当前配置档案没有提供这个插件的设置项。',
			'settings.readonly': '当前配置档案为只读，设置无法保存。',
			'settings.saveFailed': '保存失败，请重试。',
			'settings.savedHint': '修改会立即生效。',
			'settings.seconds': '{seconds} 秒',
			'row.focused.title': '当前会话完成时也提示',
			'row.focused.description': '关闭后只有后台会话跑完才提示；你正在看的会话结束时不再弹卡片。',
			'row.system.title': '系统通知',
			'row.system.description': '窗口最小化或失焦时，运行结束会发送系统级通知（需要通知权限）。',
			'row.subagent.title': '子代理会话也提示',
			'row.subagent.description': '开启后，子代理（subagent）运行结束同样会提示；默认关闭以免打扰。',
			'row.duration.title': '提示显示时长',
			'row.duration.description': '应用内提示卡片自动消失前停留的时间。',
			'row.permission.title': '通知权限',
			'row.permission.description': '系统通知需要浏览器 / 桌面壳的通知权限。',
			'permission.granted': '已授权',
			'permission.default': '尚未授权',
			'permission.denied': '已被拒绝，请在系统设置中允许本应用发送通知',
			'permission.unsupported': '当前环境不支持系统通知',
			'permission.request': '申请权限',
			'row.test.title': '测试通知',
			'row.test.description': '立刻发送一条应用内提示；已开启系统通知且已授权时，同时发送系统通知。',
			'row.test.action': '发送测试',
			'row.state.saving': '保存中…',
		};

		const en = {
			title: 'Run finished',
			body: 'Session {id} finished running — click to open',
			systemTitle: 'DSH · Run finished',
			systemBody: 'Session {id} finished running — click to return',
			close: 'Dismiss notification',
			region: 'Completion notices',
			'toast.testTitle': 'Test notification',
			'toast.testBody': 'If you can see this card, notices work.',
			'test.systemTitle': 'DSH · Test notification',
			'test.systemBody': 'System notifications work.',
			'settings.nav': 'Run notifications',
			'settings.intro': 'A notice appears when a conversation finishes running. These settings are stored in the active DSH profile and survive restarts.',
			'settings.loading': 'Reading settings…',
			'settings.unavailable': 'The active profile does not serve settings for this plugin.',
			'settings.readonly': 'The active profile is read-only, so settings cannot be saved.',
			'settings.saveFailed': 'Could not save. Please try again.',
			'settings.savedHint': 'Changes take effect immediately.',
			'settings.seconds': '{seconds}s',
			'row.focused.title': 'Notify while the window is focused',
			'row.focused.description': 'When off, only background conversations announce their finish.',
			'row.system.title': 'System notifications',
			'row.system.description': 'While the window is minimized or unfocused, send an OS-level notice when a run ends (requires notification permission).',
			'row.subagent.title': 'Notify for subagent conversations',
			'row.subagent.description': 'Also announce subagent runs. Off by default to avoid noise.',
			'row.duration.title': 'Notice lifetime',
			'row.duration.description': 'How long the in-app card stays on screen before it disappears.',
			'row.permission.title': 'Notification permission',
			'row.permission.description': 'System notifications require the browser / desktop notification permission.',
			'permission.granted': 'Granted',
			'permission.default': 'Not granted yet',
			'permission.denied': 'Denied — allow notifications for this app in the system settings',
			'permission.unsupported': 'System notifications are not supported here',
			'permission.request': 'Request permission',
			'row.test.title': 'Test notification',
			'row.test.description': 'Send an in-app notice now; a system notice follows when it is enabled and permitted.',
			'row.test.action': 'Send test',
			'row.state.saving': 'Saving…',
		};

		/* ---------------------------------------------------------------- style */

		const CSS = [
			/* Toast stack in the click-through overlay; notices take pointer events. */
			'.dshDoneNotify_stack{position:fixed;right:16px;bottom:16px;z-index:1200;',
			'display:flex;flex-direction:column;gap:8px;width:min(360px,calc(100vw - 24px));',
			'max-height:70vh;overflow:visible;pointer-events:none;font:inherit;text-align:start}',
			'.dshDoneNotify_toast{pointer-events:auto;box-sizing:border-box;display:flex;align-items:flex-start;gap:10px;',
			'width:100%;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;',
			'background:var(--dsw-alias-bg-overlay,#fff);color:var(--dsw-alias-label-primary);',
			'box-shadow:0 12px 28px rgba(15,23,42,.16),0 2px 6px rgba(15,23,42,.08);',
			'cursor:pointer;animation:dshDoneNotify_in .16s ease-out}',
			'.dshDoneNotify_toast:hover{background:var(--dsw-alias-bg-layer-1,#fff)}',
			'.dshDoneNotify_toast:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid ',
			'var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}',
			'.dshDoneNotify_icon{flex:none;display:inline-flex;align-items:center;justify-content:center;',
			'width:26px;height:26px;border-radius:999px;',
			'background:var(--dsw-alias-bg-layer-2,#eef2f7);',
			'background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#16a34a) 16%,transparent);',
			'color:var(--dsw-alias-state-success-primary,#16a34a)}',
			'.dshDoneNotify_icon svg{width:16px;height:16px}',
			'.dshDoneNotify_content{min-width:0;flex:1 1 auto}',
			'.dshDoneNotify_title{font-size:13px;line-height:20px;font-weight:600;',
			'color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
			'.dshDoneNotify_body{margin-top:2px;font-size:12px;line-height:18px;',
			'color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
			'.dshDoneNotify_close{flex:none;inline-size:22px;block-size:22px;padding:0;margin:-2px -2px 0 0;',
			'display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;',
			'background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
			'.dshDoneNotify_close:hover{background:var(--dsw-alias-bg-layer-2,#eef2f7)}',
			'.dshDoneNotify_close svg{inline-size:12px;block-size:12px}',
			'@keyframes dshDoneNotify_in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
			'@media (width<=560px){.dshDoneNotify_stack{inset-inline:12px;bottom:12px;width:auto}}',
			'@media (prefers-reduced-motion:reduce){.dshDoneNotify_toast{animation:none}}',
			/* Settings page: one preference row per line, matching the General section. */
			'.dshDoneNotify_settings{display:flex;flex-direction:column;width:100%;padding-top:8px}',
			'.dshDoneNotify_intro{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
			'.dshDoneNotify_rows{display:flex;flex-direction:column;width:100%;margin-top:8px}',
			'.dshDoneNotify_row{display:flex;justify-content:space-between;align-items:center;gap:24px;',
			'padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
			'.dshDoneNotify_rows>.dshDoneNotify_row:last-child{border-bottom:none;padding-bottom:8px}',
			'.dshDoneNotify_rowText{min-width:0}',
			'.dshDoneNotify_rowTitle{color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px}',
			'.dshDoneNotify_rowDescription{margin-top:4px;color:var(--dsw-alias-label-secondary);',
			'font-size:12px;line-height:18px}',
			'.dshDoneNotify_rowError{margin-top:4px;color:var(--dsw-alias-state-error-primary);',
			'font-size:12px;line-height:18px}',
			'.dshDoneNotify_control{flex:none;display:inline-flex;align-items:center;gap:10px;min-width:0}',
			'.dshDoneNotify_state{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}',
			'.dshDoneNotify_granted{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:18px}',
			'.dshDoneNotify_permission{display:inline-flex;align-items:center;gap:6px;min-width:0}',
			'.dshDoneNotify_dot{flex:none;inline-size:6px;block-size:6px;border-radius:50%;',
			'background:var(--dsw-alias-state-idle-primary,#94a3b8)}',
			'.dshDoneNotify_dotOk{background:var(--dsw-alias-state-success-primary,#16a34a)}',
			'.dshDoneNotify_dotBad{background:var(--dsw-alias-state-error-primary,#dc2626)}',
			'.dshDoneNotify_note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;padding:8px 0 0}',
			/* Switch: the shipped 36x20 control, renamed and token-based. */
			'.dshDoneNotify_switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;',
			'padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3,#cbd5e1);',
			'cursor:pointer;transition:background .12s ease}',
			'.dshDoneNotify_switch[aria-checked=true]{background:var(--dsw-alias-brand-primary,#2563eb)}',
			'.dshDoneNotify_switch:disabled{cursor:default;opacity:.5}',
			'.dshDoneNotify_switch:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid ',
			'var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}',
			'.dshDoneNotify_thumb{display:block;width:16px;height:16px;border-radius:50%;',
			'background:var(--dsw-alias-switch-thumb,#fff);transition:transform .12s ease,background .12s ease}',
			'.dshDoneNotify_switch[aria-checked=true] .dshDoneNotify_thumb{',
			'background:var(--dsw-alias-label-primary-foreground,#fff);transform:translateX(16px)}',
			/* Small buttons and the lifetime segments. */
			'.dshDoneNotify_button{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;',
			'background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;',
			'padding:5px 12px;font:inherit;font-size:12px;line-height:18px;transition:background .12s ease}',
			'.dshDoneNotify_button:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}',
			'.dshDoneNotify_button:disabled{opacity:.5;cursor:default}',
			'.dshDoneNotify_button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid ',
			'var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}',
			'.dshDoneNotify_segments{display:inline-flex;gap:2px;padding:2px;border-radius:8px;',
			'background:var(--dsw-alias-bg-layer-2,#eef2f7)}',
			'.dshDoneNotify_segment{border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);',
			'cursor:pointer;padding:4px 10px;font:inherit;font-size:12px;line-height:18px;white-space:nowrap}',
			'.dshDoneNotify_segment:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
			'.dshDoneNotify_segment[aria-pressed=true]{background:var(--dsw-alias-bg-overlay,#fff);',
			'color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(15,23,42,.12)}',
			'.dshDoneNotify_segment:disabled{cursor:default;opacity:.6}',
			'.dshDoneNotify_segment:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid ',
			'var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:1px}',
			'@media (prefers-reduced-motion:reduce){.dshDoneNotify_thumb{transition:none}}',
		].join('');

		/* -------------------------------------------------------------- helpers */

		const IDENTITY = (value) => value;
		const EMPTY_STATUS = new Map();
		const EMPTY_SESSION_LIST = { phase: 'pending', ids: [], byId: {} };

		/** No-op hooks used only when a standard prop is absent. */
		function useEmptyStatus(_selector) {
			return EMPTY_STATUS;
		}
		function useEmptySessions(_selector) {
			return EMPTY_SESSION_LIST;
		}
		function useFallbackSettings(_selector) {
			return FALLBACK_STATE;
		}

		/** Local fallback translator, used only when the locale seat is absent. */
		function fallbackTranslate(key, params) {
			const template = zh[key] ?? key;
			if (params === undefined) return template;
			return template.replace(/\{(\w+)\}/gu, (match, name) => (name in params ? String(params[name]) : match));
		}

		/** Short, human-recognizable tail of a Session id. */
		function shortSessionId(sessionId) {
			const text = typeof sessionId === 'string' ? sessionId : String(sessionId ?? '');
			const tail = text.replace(/^session-/u, '');
			return tail.length > 6 ? tail.slice(-6) : tail;
		}

		/** Whether the page is hidden, minimized, or its window is not focused. */
		function isWindowInactive() {
			try {
				if (typeof document === 'undefined') return true;
				if (document.hidden === true) return true;
				if (typeof document.hasFocus === 'function' && document.hasFocus() === false) return true;
				return false;
			}
			catch (_error) {
				return false;
			}
		}

		/** The browser notification permission, or `'unsupported'`. */
		function readPermission() {
			try {
				const Ctor = typeof window === 'undefined' ? undefined : window.Notification;
				if (typeof Ctor !== 'function') return 'unsupported';
				return typeof Ctor.permission === 'string' ? Ctor.permission : 'unsupported';
			}
			catch (_error) {
				return 'unsupported';
			}
		}

		/** Ask for the permission and resolve the resulting state. */
		function requestPermission() {
			try {
				const Ctor = typeof window === 'undefined' ? undefined : window.Notification;
				if (typeof Ctor !== 'function' || typeof Ctor.requestPermission !== 'function') return Promise.resolve(readPermission());
				const result = Ctor.requestPermission();
				if (result !== undefined && typeof result.then === 'function') {
					return result.then((next) => (typeof next === 'string' ? next : readPermission()), () => readPermission());
				}
				return Promise.resolve(readPermission());
			}
			catch (_error) {
				return Promise.resolve(readPermission());
			}
		}

		/** A bell with a check: the notice glyph. */
		function bellIcon() {
			return h(
				'svg',
				{ viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, focusable: 'false' },
				h('path', {
					fill: 'currentColor',
					d: 'M8 1.5a4.5 4.5 0 0 0-4.5 4.5v2.3c0 .8-.3 1.6-.9 2.2l-.8.9c-.5.5-.1 1.4.6 1.4h11.2c.7 0 1.1-.9.6-1.4l-.8-.9c-.6-.6-.9-1.4-.9-2.2V6A4.5 4.5 0 0 0 8 1.5Z',
				}),
				h('path', {
					fill: 'currentColor',
					d: 'M6.2 12.6c.2.9.9 1.5 1.8 1.5s1.6-.6 1.8-1.5H6.2Z',
				}),
			);
		}

		/** The dismiss glyph. */
		function closeIcon() {
			return h(
				'svg',
				{ viewBox: '0 0 12 12', width: 12, height: 12, 'aria-hidden': true, focusable: 'false' },
				h('path', {
					fill: 'none',
					stroke: 'currentColor',
					'stroke-width': 1.6,
					'stroke-linecap': 'round',
					d: 'M2.5 2.5l7 7M9.5 2.5l-7 7',
				}),
			);
		}

		/* ------------------------------------------------------- test-notice bus */

		/** Settings-page test button → running notifier instances. */
		const previewListeners = new Set();
		function requestTestNotice() {
			for (const listener of [...previewListeners]) {
				try {
					listener();
				}
				catch (_error) {
					/* One broken listener must not stop the others. */
				}
			}
		}

		/* ------------------------------------------------------- settings bridge */

		/** Compare two normalized setting objects field by field. */
		function sameSettings(left, right) {
			return left.notifyWhenFocused === right.notifyWhenFocused
				&& left.systemNotifications === right.systemNotifications
				&& left.notifySubagents === right.notifySubagents
				&& left.toastLifetimeSeconds === right.toastLifetimeSeconds;
		}

		/** Coerce one Host form value into the client's settings shape. */
		function normalizeSettings(value) {
			const source = value !== null && typeof value === 'object' ? value : {};
			const boolean = (name) => (typeof source[name] === 'boolean' ? source[name] : DEFAULT_SETTINGS[name]);
			const rawSeconds = typeof source.toastLifetimeSeconds === 'number' && Number.isFinite(source.toastLifetimeSeconds)
				? source.toastLifetimeSeconds
				: DEFAULT_SETTINGS.toastLifetimeSeconds;
			const seconds = Math.min(60, Math.max(3, Math.round(rawSeconds)));
			return {
				notifyWhenFocused: boolean('notifyWhenFocused'),
				systemNotifications: boolean('systemNotifications'),
				notifySubagents: boolean('notifySubagents'),
				toastLifetimeSeconds: seconds,
			};
		}

		/**
		 * One live view over this plugin's Host settings namespace.
		 *
		 * The namespace is the Loader row id. When the settings document has not
		 * arrived yet the controller still binds that id; once the document is in,
		 * a served namespace ending in the row id is accepted as well so a
		 * composed profile that nests the row elsewhere keeps working.
		 * @param configForms - the Client settings-form service.
		 * @returns store, write path and disposal.
		 */
		function createSettingsBridge(configForms) {
			const mirror = configForms.describe();
			const listeners = new Set();
			let form;
			let formNs;
			let offForm;
			let disposed = false;
			let snapshot = FALLBACK_STATE;

			function publish(next) {
				if (disposed) return;
				const unchanged = next.status === snapshot.status
					&& next.writable === snapshot.writable
					&& sameSettings(next.values, snapshot.values);
				if (unchanged) return;
				snapshot = next;
				for (const listener of [...listeners]) {
					try {
						listener();
					}
					catch (_error) {
						/* A listener failure must not break the shared source. */
					}
				}
			}

			/** Re-derive the snapshot from the bound form. */
			function sync() {
				if (disposed) return;
				if (form === undefined) {
					publish(FALLBACK_STATE);
					return;
				}
				const state = form.getSnapshot();
				publish({
					status: state.status,
					writable: state.writable === true,
					values: normalizeSettings(state.value),
				});
			}

			/** Pick the namespace the Host serves for this row. */
			function servedNamespace() {
				const view = mirror.getSnapshot().view;
				if (view === undefined || !Array.isArray(view.namespaces)) return undefined;
				const rows = view.namespaces;
				const exact = rows.find((row) => row.ns === ROW_ID);
				if (exact !== undefined) return exact.ns;
				const nested = rows.find((row) => typeof row.ns === 'string' && row.ns.endsWith(ROW_ID));
				return nested === undefined ? undefined : nested.ns;
			}

			/** Bind or re-bind the form for the currently served namespace. */
			function attach() {
				if (disposed) return;
				const next = servedNamespace() ?? formNs ?? ROW_ID;
				if (next !== formNs) {
					if (offForm !== undefined) {
						offForm();
						offForm = undefined;
					}
					formNs = next;
					form = configForms.get(formNs);
					offForm = form.subscribe(sync);
				}
				sync();
			}

			const offMirror = mirror.subscribe(attach);
			try {
				const pending = mirror.ensure();
				if (pending !== undefined && pending !== null && typeof pending.catch === 'function') pending.catch(() => {});
			}
			catch (_error) {
				/* The mirror retries on the next invalidation; defaults stay in effect. */
			}
			attach();

			return {
				store: {
					getSnapshot: () => snapshot,
					subscribe: (listener) => {
						listeners.add(listener);
						return () => {
							listeners.delete(listener);
						};
					},
				},
				/** Persist one field through the revision-safe Host write. */
				set(field, value) {
					if (disposed || form === undefined) return Promise.resolve(false);
					try {
						const result = form.set(field, value);
						return result !== undefined && typeof result.then === 'function' ? result : Promise.resolve(false);
					}
					catch (_error) {
						return Promise.resolve(false);
					}
				},
				dispose() {
					disposed = true;
					offMirror();
					if (offForm !== undefined) offForm();
					offForm = undefined;
					listeners.clear();
				},
			};
		}

		/* --------------------------------------------------------------- plugin */

		/** Insert the plugin stylesheet; returns its removal. */
		function insertStylesheet() {
			const tag = document.createElement('style');
			tag.dataset.plugin = '@local/dsh-done-notify';
			tag.dataset.pluginCss = NS;
			tag.textContent = CSS;
			document.head.appendChild(tag);
			return () => {
				tag.remove();
			};
		}

		/**
		 * Ask for the notification permission on the first gesture. Browsers only
		 * grant a notification prompt from a user activation, so the first click
		 * or key press is the earliest safe moment; later run completions can then
		 * raise OS notices without the page being focused.
		 */
		function installPermissionPrompt() {
			if (!REQUEST_PERMISSION_ON_FIRST_GESTURE) return () => {};
			try {
				if (typeof window === 'undefined') return () => {};
				const Ctor = window.Notification;
				if (typeof Ctor !== 'function' || Ctor.permission !== 'default') return () => {};
				const cleanup = () => {
					document.removeEventListener('pointerdown', ask, true);
					document.removeEventListener('keydown', ask, true);
				};
				let armed = true;
				function ask() {
					if (!armed) return;
					armed = false;
					cleanup();
					void requestPermission();
				}
				document.addEventListener('pointerdown', ask, true);
				document.addEventListener('keydown', ask, true);
				return () => {
					armed = false;
					cleanup();
				};
			}
			catch (_error) {
				return () => {};
			}
		}

		/** Build the notifier component around one client plugin context. */
		function createNotifier(ctx) {
			/** Open the finished Session when a notice is activated. */
			function openSession(sessionId) {
				if (typeof sessionId !== 'string' || sessionId.length === 0) return false;
				let workspace;
				try {
					workspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined;
				}
				catch (_error) {
					workspace = undefined;
				}
				if (workspace !== undefined && workspace !== null && typeof workspace.openSession === 'function') {
					try {
						workspace.openSession(sessionId);
						return true;
					}
					catch (_error) {
						/* Fall through: the toast is still dismissible. */
					}
				}
				return false;
			}

			/** Raise an OS-level notice, for a completion or for the test button. */
			function fireSystemNotice(sessionId, tr, options) {
				const preview = options !== undefined && options.preview === true;
				try {
					if (typeof window === 'undefined') return;
					const Ctor = window.Notification;
					if (typeof Ctor !== 'function') return;
					if (Ctor.permission !== 'granted') return;
					const title = preview ? tr('test.systemTitle') : tr('systemTitle');
					const body = preview ? tr('test.systemBody') : tr('systemBody', { id: shortSessionId(sessionId) });
					const notice = new Ctor(title, {
						body,
						tag: preview ? 'dsh-done-notify:test' : `dsh-done-notify:${sessionId}`,
						renotify: false,
						silent: false,
					});
					notice.onclick = () => {
						try {
							notice.close();
						}
						catch (_error) {
							/* The notice may already be gone. */
						}
						try {
							window.focus();
						}
						catch (_error) {
							/* Focus can be refused by the shell; opening still works. */
						}
						openSession(sessionId);
					};
					window.setTimeout(() => {
						try {
							notice.close();
						}
						catch (_error) {
							/* Already closed. */
						}
					}, SYSTEM_NOTICE_TTL_MS);
				}
				catch (_error) {
					/* System notices are best-effort; the in-app toast remains. */
				}
			}

			return function DoneNotify(props) {
				const tr = typeof props.t === 'function' ? props.t : fallbackTranslate;
				const useNotifierSettings = typeof props.useNotifierSettings === 'function' ? props.useNotifierSettings : useFallbackSettings;
				const useSessionStatus = typeof props.useSessionStatus === 'function' ? props.useSessionStatus : useEmptyStatus;
				const useSessions = typeof props.useSessions === 'function' ? props.useSessions : useEmptySessions;

				const settingState = useNotifierSettings(IDENTITY);
				const settings = (settingState !== null && typeof settingState === 'object' && settingState.values !== undefined)
					? settingState.values
					: DEFAULT_SETTINGS;
				const notifyWhenFocused = settings.notifyWhenFocused === true;
				const systemNotifications = settings.systemNotifications === true;
				const notifySubagents = settings.notifySubagents === true;
				const toastLifetimeMs = Math.max(3, settings.toastLifetimeSeconds) * 1000;

				const status = useSessionStatus(IDENTITY);
				const sessions = useSessions(IDENTITY);

				const [toasts, setToasts] = React.useState([]);
				const sessionsRef = React.useRef(sessions);
				const toastsRef = React.useRef(toasts);
				const previousRunning = React.useRef(new Map());
				const timers = React.useRef(new Map());
				const sequence = React.useRef(0);
				sessionsRef.current = sessions;
				toastsRef.current = toasts;

				/** Remove one notice and its timer. */
				const dismiss = React.useCallback((key) => {
					const timer = timers.current.get(key);
					if (timer !== undefined) {
						window.clearTimeout(timer);
						timers.current.delete(key);
					}
					setToasts((current) => current.filter((toast) => toast.key !== key));
				}, []);

				/** Arm the auto-dismiss timer; it waits until the window is visible. */
				const armTimer = React.useCallback((key) => {
					if (timers.current.has(key)) return;
					if (isWindowInactive()) return;
					const timer = window.setTimeout(() => {
						timers.current.delete(key);
						dismiss(key);
					}, toastLifetimeMs);
					timers.current.set(key, timer);
				}, [dismiss, toastLifetimeMs]);

				/** Append one notice, dropping an older notice for the same Session. */
				const pushToast = React.useCallback((sessionId) => {
					setToasts((current) => {
						sequence.current += 1;
						const entry = { key: `${sessionId ?? 'test'}:${sequence.current}`, sessionId };
						const kept = current.filter((toast) => toast.sessionId !== sessionId);
						kept.push(entry);
						return kept.slice(-MAX_TOASTS);
					});
				}, []);

				/**
				 * Detect idle transitions from the Client's session-status source.
				 * The status snapshot is a Map of Session id to
				 * `{ running, pendingInteraction, completionUnread }`.
				 */
				React.useEffect(() => {
					if (!(status instanceof Map)) return;
					const previous = previousRunning.current;
					const next = new Map();
					const finished = [];
					for (const [sessionId, state] of status) {
						const running = state?.running === true;
						next.set(sessionId, running);
						if (previous.get(sessionId) === true && running === false) finished.push(sessionId);
					}
					previousRunning.current = next;
					if (finished.length === 0) return;
					const inactive = isWindowInactive();
					const list = sessionsRef.current;
					for (const sessionId of finished) {
						const row = list?.byId?.[sessionId];
						if (row === undefined) {
							/* Unknown row: only a window that is away justifies a notice. */
							if (!inactive) continue;
						}
						else {
							if (!notifySubagents
								&& (row.origin === 'subagent' || row.parentSessionId !== undefined)) continue;
							const isMainView = ((row.retainedBy?.mainView ?? 0) > 0);
							if (isMainView && !inactive && !notifyWhenFocused) continue;
						}
						pushToast(sessionId);
						if (inactive && systemNotifications) fireSystemNotice(sessionId, tr);
					}
				}, [status, pushToast, tr, notifyWhenFocused, systemNotifications, notifySubagents]);

				/* The Settings page's test button asks the running notifier to speak. */
				React.useEffect(() => {
					const handle = () => {
						pushToast(null);
						if (systemNotifications) fireSystemNotice(null, tr, { preview: true });
					};
					previewListeners.add(handle);
					return () => {
						previewListeners.delete(handle);
					};
				}, [pushToast, tr, systemNotifications]);

				/* Keep one dismiss timer per live notice; drop timers of removed ones. */
				React.useEffect(() => {
					const live = new Set(toasts.map((toast) => toast.key));
					for (const [key, timer] of timers.current) {
						if (live.has(key)) continue;
						window.clearTimeout(timer);
						timers.current.delete(key);
					}
					for (const key of live) armTimer(key);
				}, [toasts, armTimer]);

				/* A hidden page throttles timers; re-arm a full lifetime on return. */
				React.useEffect(() => {
					const wake = () => {
						if (isWindowInactive()) return;
						for (const toast of toastsRef.current) {
							const timer = timers.current.get(toast.key);
							if (timer !== undefined) window.clearTimeout(timer);
							timers.current.delete(toast.key);
							armTimer(toast.key);
						}
					};
					document.addEventListener('visibilitychange', wake);
					window.addEventListener('focus', wake);
					return () => {
						document.removeEventListener('visibilitychange', wake);
						window.removeEventListener('focus', wake);
					};
				}, [armTimer]);

				/* Clear every timer when the entry unmounts. */
				React.useEffect(() => () => {
					for (const timer of timers.current.values()) window.clearTimeout(timer);
					timers.current.clear();
				}, []);

				if (toasts.length === 0) return null;

				const toastNodes = toasts.map((toast) => {
					const preview = toast.sessionId === null;
					const pause = () => {
						const timer = timers.current.get(toast.key);
						if (timer !== undefined) {
							window.clearTimeout(timer);
							timers.current.delete(toast.key);
						}
					};
					const resume = () => {
						armTimer(toast.key);
					};
					const open = () => {
						dismiss(toast.key);
						if (!preview) openSession(toast.sessionId);
					};
					const title = preview ? tr('toast.testTitle') : tr('title');
					const body = preview ? tr('toast.testBody') : tr('body', { id: shortSessionId(toast.sessionId) });
					return h(
						'div',
						{
							key: toast.key,
							className: 'dshDoneNotify_toast',
							role: 'status',
							tabIndex: 0,
							onClick: open,
							onKeyDown: (event) => {
								if (event?.key !== 'Enter' && event?.key !== ' ') return;
								if (typeof event.preventDefault === 'function') event.preventDefault();
								open();
							},
							onMouseEnter: pause,
							onMouseLeave: resume,
						},
						h('span', { className: 'dshDoneNotify_icon', 'aria-hidden': true }, bellIcon()),
						h(
							'div',
							{ className: 'dshDoneNotify_content' },
							h('div', { className: 'dshDoneNotify_title' }, title),
							h('div', { className: 'dshDoneNotify_body' }, body),
						),
						h(
							'button',
							{
								type: 'button',
								className: 'dshDoneNotify_close',
								'aria-label': tr('close'),
								onClick: (event) => {
									if (typeof event?.stopPropagation === 'function') event.stopPropagation();
									dismiss(toast.key);
								},
							},
							closeIcon(),
						),
					);
				});

				return h(
					'div',
					{
						className: 'dshDoneNotify_stack',
						role: 'region',
						'aria-label': tr('region'),
						'aria-live': 'polite',
					},
					toastNodes,
				);
			};
		}

		/* ----------------------------------------------------------- settings page */

		/** One preference line: title/description on the left, a control on the right. */
		function renderRow(rowProps, control) {
			return h(
				'div',
				{ key: rowProps.key, className: 'dshDoneNotify_row' },
				h(
					'div',
					{ className: 'dshDoneNotify_rowText' },
					h('div', { className: 'dshDoneNotify_rowTitle' }, rowProps.title),
					rowProps.description !== undefined
						? h('div', { className: 'dshDoneNotify_rowDescription' }, rowProps.description)
						: null,
					rowProps.error !== undefined ? h('div', { className: 'dshDoneNotify_rowError', role: 'alert' }, rowProps.error) : null,
				),
				h('div', { className: 'dshDoneNotify_control' }, control),
			);
		}

		/** The shipped switch control, renamed and token-based. */
		function renderSwitch(switchProps) {
			return h(
				'button',
				{
					type: 'button',
					role: 'switch',
					'aria-checked': switchProps.checked === true,
					'aria-label': switchProps.label,
					disabled: switchProps.disabled === true,
					className: 'dshDoneNotify_switch',
					onClick: () => {
						if (switchProps.disabled === true) return;
						switchProps.onChange(switchProps.checked !== true);
					},
				},
				h('span', { className: 'dshDoneNotify_thumb' }),
			);
		}

		/** Build the Settings page component around the shared bridge. */
		function createSettingsPage(bridge) {
			return function DoneNotifySettings(props) {
				const tr = typeof props.t === 'function' ? props.t : fallbackTranslate;
				const useNotifierSettings = typeof props.useNotifierSettings === 'function' ? props.useNotifierSettings : useFallbackSettings;
				const state = useNotifierSettings(IDENTITY);
				const ready = state.status === 'ready';
				const writable = state.writable === true && ready;
				const values = state.values ?? DEFAULT_SETTINGS;

				const [pending, setPending] = React.useState(null);
				const [failed, setFailed] = React.useState(null);
				const [permission, setPermission] = React.useState(readPermission);
				const alive = React.useRef(true);
				React.useEffect(() => () => {
					alive.current = false;
				}, []);

				/* Permission can change outside this page; re-read on focus/visibility. */
				React.useEffect(() => {
					const refresh = () => setPermission(readPermission());
					window.addEventListener('focus', refresh);
					document.addEventListener('visibilitychange', refresh);
					let status;
					const onChange = () => refresh();
					try {
						const permissions = window.navigator?.permissions;
						if (permissions !== undefined && typeof permissions.query === 'function') {
							permissions.query({ name: 'notifications' }).then((result) => {
								status = result;
								if (typeof result.addEventListener === 'function') result.addEventListener('change', onChange);
							}, () => {});
						}
					}
					catch (_error) {
						/* The Permissions API is optional. */
					}
					return () => {
						window.removeEventListener('focus', refresh);
						document.removeEventListener('visibilitychange', refresh);
						try {
							if (status !== undefined && typeof status.removeEventListener === 'function') {
								status.removeEventListener('change', onChange);
							}
						}
						catch (_error) {
							/* Ignore a missing listener surface. */
						}
					};
				}, []);

				/** Write one field through the Host settings form. */
				const setField = (field, value) => {
					if (!writable || pending !== null) return;
					setPending(field);
					setFailed(null);
					bridge.set(field, value).then((accepted) => {
						if (!alive.current) return;
						if (accepted !== true) setFailed(field);
					}, () => {
						if (alive.current) setFailed(field);
					}).finally(() => {
						if (alive.current) setPending(null);
					});
				};

				const askPermission = () => {
					requestPermission().then((next) => {
						if (alive.current) setPermission(typeof next === 'string' ? next : readPermission());
					});
				};

				const busy = pending !== null;
				const switchRow = (field, title, description) => renderRow(
					{
						key: field,
						title,
						description,
						error: failed === field ? tr('settings.saveFailed') : undefined,
					},
					renderSwitch({
						checked: values[field] === true,
						disabled: !writable || busy,
						label: title,
						onChange: (next) => setField(field, next),
					}),
				);

				const seconds = values.toastLifetimeSeconds;
				const presets = LIFETIME_PRESETS.includes(seconds)
					? LIFETIME_PRESETS
					: [...LIFETIME_PRESETS, seconds].sort((left, right) => left - right);
				const durationControl = h(
					'div',
					{
						className: 'dshDoneNotify_segments',
						role: 'group',
						'aria-label': tr('row.duration.title'),
					},
					presets.map((option) => h(
						'button',
						{
							key: option,
							type: 'button',
							'aria-pressed': option === seconds,
							disabled: !writable || busy,
							className: 'dshDoneNotify_segment',
							onClick: () => setField('toastLifetimeSeconds', option),
						},
						tr('settings.seconds', { seconds: option }),
					)),
				);

				let permissionState = tr('permission.unsupported');
				if (permission === 'granted') permissionState = tr('permission.granted');
				else if (permission === 'default') permissionState = tr('permission.default');
				else if (permission === 'denied') permissionState = tr('permission.denied');

				let permissionControl;
				if (permission === 'unsupported') {
					permissionControl = h('span', { className: 'dshDoneNotify_state' }, permissionState);
				}
				else {
					const dotClass = permission === 'granted'
						? 'dshDoneNotify_dot dshDoneNotify_dotOk'
						: permission === 'denied'
							? 'dshDoneNotify_dot dshDoneNotify_dotBad'
							: 'dshDoneNotify_dot';
					const textClass = permission === 'granted' ? 'dshDoneNotify_granted' : 'dshDoneNotify_state';
					const canAsk = permission === 'default' || permission === 'denied';
					permissionControl = h(
						'div',
						{ className: 'dshDoneNotify_control' },
						h(
							'span',
							{ className: 'dshDoneNotify_permission' },
							h('span', { className: dotClass, 'aria-hidden': true }),
							h('span', { className: textClass }, permissionState),
						),
						canAsk
							? h(
								'button',
								{ type: 'button', className: 'dshDoneNotify_button', onClick: askPermission },
								tr('permission.request'),
							)
							: null,
					);
				}

				const preferenceRows = [
					switchRow('notifyWhenFocused', tr('row.focused.title'), tr('row.focused.description')),
					switchRow('systemNotifications', tr('row.system.title'), tr('row.system.description')),
					switchRow('notifySubagents', tr('row.subagent.title'), tr('row.subagent.description')),
					renderRow(
						{
							key: 'duration',
							title: tr('row.duration.title'),
							description: tr('row.duration.description'),
							error: failed === 'toastLifetimeSeconds' ? tr('settings.saveFailed') : undefined,
						},
						durationControl,
					),
					renderRow(
						{
							key: 'permission',
							title: tr('row.permission.title'),
							description: tr('row.permission.description'),
						},
						permissionControl,
					),
					renderRow(
						{
							key: 'test',
							title: tr('row.test.title'),
							description: tr('row.test.description'),
						},
						h(
							'button',
							{
								type: 'button',
								className: 'dshDoneNotify_button',
								onClick: () => requestTestNotice(),
							},
							tr('row.test.action'),
						),
					),
				];

				let note = tr('settings.savedHint');
				if (!ready) {
					note = state.status === 'unavailable' ? tr('settings.unavailable') : tr('settings.loading');
				}
				else if (!writable) {
					note = tr('settings.readonly');
				}
				else if (busy) {
					note = tr('row.state.saving');
				}

				return h(
					'div',
					{ className: 'dshDoneNotify_settings' },
					h('p', { className: 'dshDoneNotify_intro' }, tr('settings.intro')),
					h('div', { className: 'dshDoneNotify_rows' }, preferenceRows),
					h('div', { className: 'dshDoneNotify_note', role: ready ? undefined : 'status' }, note),
				);
			};
		}

		/** The section's nav label, following the active locale on every projection. */
		function navLabel(ctx) {
			try {
				const dictionary = ctx.locale.getSnapshot().active === 'en' ? en : zh;
				return dictionary['settings.nav'];
			}
			catch (_error) {
				return zh['settings.nav'];
			}
		}

		return {
			inject: ['slots', 'locale'],
			apply(ctx) {
				ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'done-notify: dictionaries');
				ctx.effect(() => insertStylesheet(), 'done-notify: stylesheet');
				ctx.effect(() => installPermissionPrompt(), 'done-notify: notification permission');

				let bridge;
				try {
					const configForms = typeof ctx.get === 'function' ? ctx.get('configForms') : undefined;
					if (configForms !== undefined && configForms !== null && typeof configForms.get === 'function') {
						bridge = createSettingsBridge(configForms);
						ctx.effect(() => () => bridge.dispose(), 'done-notify: settings bridge');
					}
				}
				catch (_error) {
					bridge = undefined;
				}

				const notifierOptions = {
					name: 'shell.overlay',
					id: 'done-notify',
					order: 80,
					locale: NS,
				};
				if (bridge !== undefined) {
					notifierOptions.inject = () => ({ hooks: { notifierSettings: bridge.store } });
				}
				ctx.slots.inject('shell.overlay', () => ctx.slots.register(notifierOptions, createNotifier(ctx)));

				if (bridge === undefined) return;
				ctx.slots.inject('settings.section', () => ctx.slots.register({
					name: 'settings.section',
					id: 'done-notify',
					order: 25,
					label: () => navLabel(ctx),
					locale: NS,
					inject: () => ({
						hooks: { notifierSettings: bridge.store },
						setNotifierSetting: (field, value) => bridge.set(field, value),
					}),
				}, createSettingsPage(bridge)));
			},
		};
	},
});
