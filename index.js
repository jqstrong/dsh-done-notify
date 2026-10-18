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
	/** Show the in-page notice card inside the DSH window. */
	notifyInApp: z.boolean().default(true)
		.description('Show a notice card at the bottom-right of the DSH window.'),
	/** Raise desktop system notifications (Windows notification center). */
	systemNotifications: z.boolean().default(true)
		.description('Send a desktop system notification on every run end and waiting choice.'),
	/** Notify when a conversation waits for the user's choice or approval. */
	notifyWhenNeedsInput: z.boolean().default(true)
		.description('Notify when a conversation is waiting for your choice, confirmation or approval.'),
	/** Also notify when the finished conversation is the one on screen. */
	notifyWhenFocused: z.boolean().default(true)
		.description('Also notify when the finished conversation is the one on screen.'),
	/** Announce subagent Sessions too. */
	notifySubagents: z.boolean().default(false)
		.description('Also announce subagent conversations; off by default to avoid noise.'),
	/** How long an in-app notice stays on screen, in seconds. */
	toastLifetimeSeconds: z.number().min(3).max(60).default(12)
		.description('How long an in-app notice stays on screen, in seconds (3–60).'),
};

export const Config = z.object({
	notifyInApp: SettingsFields.notifyInApp.volatile(),
	systemNotifications: SettingsFields.systemNotifications.volatile(),
	notifyWhenNeedsInput: SettingsFields.notifyWhenNeedsInput.volatile(),
	notifyWhenFocused: SettingsFields.notifyWhenFocused.volatile(),
	notifySubagents: SettingsFields.notifySubagents.volatile(),
	toastLifetimeSeconds: SettingsFields.toastLifetimeSeconds.volatile(),
});

export function apply() {}
