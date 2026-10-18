import z from '@deepseek-ai/schemastery';

/**
 * Host half of `@local/dsh-done-notify`.
 *
 * It owns no runtime behavior: it exists so the plugin row carries the
 * notification preferences as its Loader `Config`. Every field is `volatile`,
 * which is what makes it a live settings form — the Settings UI edits it
 * through the official configuration-form pipeline and the values are written
 * to the profile patch layer, so they survive restarts and can also be edited
 * there directly.
 */
const SettingsFields = {
	/** Also show the in-app notice when the finished conversation is on screen. */
	notifyWhenFocused: z.boolean().default(true)
		.description('Show the in-app notice even when the finished conversation is the one on screen.'),
	/** Raise an OS-level notice while the window is hidden or unfocused. */
	systemNotifications: z.boolean().default(true)
		.description('Send a system notification when a run ends while the window is hidden or unfocused.'),
	/** Announce subagent Sessions too. */
	notifySubagents: z.boolean().default(false)
		.description('Also announce subagent conversations; off by default to avoid noise.'),
	/** How long an in-app notice stays on screen, in seconds. */
	toastLifetimeSeconds: z.number().min(3).max(60).default(12)
		.description('How long an in-app notice stays on screen, in seconds (3–60).'),
};

export const Config = z.object({
	notifyWhenFocused: SettingsFields.notifyWhenFocused.volatile(),
	systemNotifications: SettingsFields.systemNotifications.volatile(),
	notifySubagents: SettingsFields.notifySubagents.volatile(),
	toastLifetimeSeconds: SettingsFields.toastLifetimeSeconds.volatile(),
});

export function apply() {}
