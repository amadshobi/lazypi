/**
 * Primary Agent Manager Extension for Pi & PiChamber
 *
 * - Enables switching primary personas/agents (mode: "primary" | "all") per session
 * - Dynamically swaps APPEND_SYSTEM.md persona with the selected agent's prompt
 * - Prunes global context files (`~/.pi/agent/AGENTS.md`, `~/AGENTS.md`) when `stripGlobalContext: true`
 * - Filters `<available_skills>` and active tools (`pi.setActiveTools`) per agent config
 * - Supports both `/agent-select <name>` and inline `<agent_switch name="..."/>` composer tags
 */

import * as os from "node:os";
import * as path from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
	type BuildSystemPromptOptions,
	type ExtensionAPI,
	type ExtensionContext,
	formatSkillsForPrompt,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { type AgentConfig, discoverAgents } from "./subagent/agents.ts";

const AGENT_STATE_ENTRY_TYPE = "lazypi.agent";

const VALID_THINKING_LEVELS = new Set<ThinkingLevel>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

function isGlobalContextFile(filePath: string): boolean {
	const normalized = path.resolve(filePath);
	const home = path.resolve(os.homedir());
	const agentDir = path.resolve(getAgentDir());
	return (
		normalized === path.join(agentDir, "AGENTS.md") ||
		normalized === path.join(home, "AGENTS.md") ||
		normalized === path.join(home, ".agents", "AGENTS.md")
	);
}

function buildAgentSystemPrompt(
	baseSystemPrompt: string,
	options: BuildSystemPromptOptions,
	agent: AgentConfig,
): string {
	const promptCwd = (options.cwd || process.cwd()).replace(/\\/g, "/");
	const tools = agent.tools && agent.tools.length > 0 ? agent.tools : (options.selectedTools ?? ["read", "bash", "edit", "write"]);
	const skillFileReadTool = (["read", "bash"] as const).find((t) => tools.includes(t));

	// Extract Pi's standard preamble (Available tools + Guidelines + Pi documentation) before appendSystemPrompt / <project_context>
	let preamble = baseSystemPrompt;
	if (options.appendSystemPrompt) {
		const idx = preamble.indexOf(`\n\n${options.appendSystemPrompt}`);
		if (idx !== -1) {
			preamble = preamble.slice(0, idx);
		}
	}
	for (const marker of ["\n\n<project_context>", "\n\nThe following skills provide", "\n<available_skills>", "\nCurrent working directory:"]) {
		const idx = preamble.indexOf(marker);
		if (idx !== -1) {
			preamble = preamble.slice(0, idx);
		}
	}

	let prompt = options.customPrompt ? options.customPrompt.trim() : preamble.trim();

	if (agent.systemPrompt && agent.systemPrompt.trim()) {
		prompt += `\n\n${agent.systemPrompt.trim()}`;
	}

	// Filter context files (strip global AGENTS.md when stripGlobalContext is enabled)
	const rawContextFiles = options.contextFiles ?? [];
	const contextFiles = agent.stripGlobalContext
		? rawContextFiles.filter((f) => !isGlobalContextFile(f.path))
		: rawContextFiles;

	if (contextFiles.length > 0) {
		prompt += "\n\n<project_context>\n\n";
		prompt += "Project-specific instructions and guidelines:\n\n";
		for (const { path: filePath, content } of contextFiles) {
			prompt += `<project_instructions path="${filePath}">\n${content}\n</project_instructions>\n\n`;
		}
		prompt += "</project_context>\n";
	}

	// Filter skills based on agent.skills configuration
	const rawSkills = options.skills ?? [];
	let filteredSkills = rawSkills;
	if (Array.isArray(agent.skills)) {
		if (agent.skills.length === 0) {
			filteredSkills = [];
		} else if (!agent.skills.includes("*")) {
			const allowed = new Set(agent.skills.map((s) => s.toLowerCase()));
			filteredSkills = rawSkills.filter((s) => allowed.has(s.name.toLowerCase()));
		}
	}

	if (skillFileReadTool && filteredSkills.length > 0) {
		prompt += formatSkillsForPrompt(filteredSkills, skillFileReadTool);
	}

	prompt += `\nCurrent working directory: ${promptCwd}`;
	return prompt;
}

export default function (pi: ExtensionAPI): void {
	let activeAgentName: string | undefined;
	// Last agent name persisted to the session log. Guarding on this keeps the
	// composer's per-message `<agent_switch/>` ping from writing a duplicate
	// `lazypi.agent` entry on every prompt (it only fires on a real change).
	let persistedAgentName: string | undefined;

	const resolvePrimaryAgent = (cwd: string, requestedName?: string): { agent: AgentConfig; allPrimary: AgentConfig[]; defaultAgent: string } | null => {
		const discovery = discoverAgents(cwd, "both");
		const allPrimary = discovery.agents.filter((a) => a.mode === "primary" || a.mode === "all");
		if (allPrimary.length === 0) return null;

		const targetName = (requestedName || activeAgentName || discovery.defaultAgent || "blin").toLowerCase();
		const matched =
			allPrimary.find((a) => a.name.toLowerCase() === targetName) ??
			allPrimary.find((a) => a.name.toLowerCase() === discovery.defaultAgent.toLowerCase()) ??
			allPrimary[0];

		return { agent: matched, allPrimary, defaultAgent: discovery.defaultAgent || "blin" };
	};

	/**
	 * Records the active agent in the session log only when it actually differs
	 * from the last persisted value. Agents matching the configured default are
	 * skipped entirely so a fresh session stays free of state-noise entries.
	 */
	const persistActiveAgent = (agentName: string, defaultAgent: string): void => {
		const unchanged = persistedAgentName?.toLowerCase() === agentName.toLowerCase();
		if (unchanged) return;

		// A fresh session already implies the default agent, so recording it would
		// only add noise. Switching *back* to the default still has to be written,
		// otherwise resuming the session would restore the previous non-default one.
		const isDefault = agentName.toLowerCase() === defaultAgent.toLowerCase();
		if (isDefault && persistedAgentName === undefined) {
			persistedAgentName = agentName;
			return;
		}

		persistedAgentName = agentName;
		try {
			pi.appendEntry(AGENT_STATE_ENTRY_TYPE, { agent: agentName, timestamp: Date.now() });
		} catch {}
	};

	const applyAgentRuntimeSettings = async (agent: AgentConfig, ctx: ExtensionContext) => {
		if (agent.tools && agent.tools.length > 0) {
			const registeredNames = new Set(pi.getAllTools().map((t) => t.name));
			const validTools = agent.tools.filter((t) => registeredNames.has(t));
			if (validTools.length > 0) {
				pi.setActiveTools(validTools);
			}
		}

		if (agent.model && ctx.modelRegistry) {
			const slashIdx = agent.model.indexOf("/");
			if (slashIdx > 0) {
				const providerId = agent.model.slice(0, slashIdx);
				const modelId = agent.model.slice(slashIdx + 1);
				const found = ctx.modelRegistry.find(providerId, modelId);
				if (found) {
					await pi.setModel(found);
				}
			}
		}

		if (agent.thinking && VALID_THINKING_LEVELS.has(agent.thinking as ThinkingLevel)) {
			pi.setThinkingLevel(agent.thinking as ThinkingLevel);
		}
	};

	// Restore active agent on session start
	pi.on("session_start", async (_event, ctx) => {
		activeAgentName = undefined;
		persistedAgentName = undefined;
		try {
			const entries = ctx.sessionManager.getEntries();
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i] as { type?: string; customType?: string; data?: { agent?: string } };
				if (entry.type === "custom" && entry.customType === AGENT_STATE_ENTRY_TYPE && entry.data?.agent) {
					activeAgentName = entry.data.agent;
					persistedAgentName = entry.data.agent;
					break;
				}
			}
		} catch {}

		const resolved = resolvePrimaryAgent(ctx.cwd, activeAgentName);
		if (resolved) {
			activeAgentName = resolved.agent.name;
			if (resolved.agent.tools && resolved.agent.tools.length > 0) {
				const registeredNames = new Set(pi.getAllTools().map((t) => t.name));
				const validTools = resolved.agent.tools.filter((t) => registeredNames.has(t));
				if (validTools.length > 0) {
					pi.setActiveTools(validTools);
				}
			}
		}
	});

	// Intercept inline `<agent_switch name="..."/>` tag injected by PiChamber composer when switching agents
	pi.on("input", async (event, ctx) => {
		const match = event.text.match(/^<agent_switch\s+name="([^"]+)"\s*\/>\s*/i);
		if (!match) return { action: "continue" };

		const requested = match[1].trim();
		const remainingText = event.text.slice(match[0].length);
		const resolved = resolvePrimaryAgent(ctx.cwd, requested);
		if (resolved) {
			activeAgentName = resolved.agent.name;
			persistActiveAgent(activeAgentName, resolved.defaultAgent);
			await applyAgentRuntimeSettings(resolved.agent, ctx);
		}

		if (!remainingText.trim()) {
			return { action: "handled" };
		}
		return { action: "transform", text: remainingText };
	});

	// Dynamically build system prompt & prune context/skills for the active primary agent
	pi.on("before_agent_start", async (event, ctx) => {
		const resolved = resolvePrimaryAgent(ctx.cwd, activeAgentName);
		if (!resolved) return;

		const { agent } = resolved;
		activeAgentName = agent.name;

		if (agent.tools && agent.tools.length > 0) {
			const registeredNames = new Set(pi.getAllTools().map((t) => t.name));
			const validTools = agent.tools.filter((t) => registeredNames.has(t));
			if (validTools.length > 0) {
				pi.setActiveTools(validTools);
			}
		}

		const systemPrompt = buildAgentSystemPrompt(event.systemPrompt, event.systemPromptOptions, agent);
		return { systemPrompt };
	});

	pi.registerCommand("agent-select", {
		description: "Switch the active primary agent for the current session",
		getArgumentCompletions: (prefix) => {
			const resolved = resolvePrimaryAgent(process.cwd());
			if (!resolved) return null;
			const items = resolved.allPrimary
				.filter((a) => a.name.toLowerCase().startsWith(prefix.toLowerCase()))
				.map((a) => ({
					value: a.name,
					label: `${a.displayName || a.name} (${a.mode})`,
					description: a.description,
				}));
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			const requested = (args || "").trim();
			const resolved = resolvePrimaryAgent(ctx.cwd, requested || undefined);
			if (!resolved) return;

			if (!requested) {
				if (ctx.hasUI && ctx.ui.select) {
					const chosen = await ctx.ui.select(
						"Select Primary Agent:",
						resolved.allPrimary.map((a) => `${a.name} — ${a.description}`),
					);
					if (!chosen) return;
					const chosenName = chosen.split(" — ")[0].trim();
					const nextResolved = resolvePrimaryAgent(ctx.cwd, chosenName);
					if (nextResolved) {
						activeAgentName = nextResolved.agent.name;
						persistActiveAgent(activeAgentName, nextResolved.defaultAgent);
						await applyAgentRuntimeSettings(nextResolved.agent, ctx);
						if (ctx.hasUI) {
							ctx.ui.notify(`Switched primary agent to: ${nextResolved.agent.displayName || nextResolved.agent.name}`, "info");
						}
					}
				}
				return;
			}

			const exact = resolved.allPrimary.find((a) => a.name.toLowerCase() === requested.toLowerCase());
			if (!exact) {
				if (ctx.hasUI) {
					ctx.ui.notify(
						`Agent "${requested}" is not available as a primary agent. Available: ${resolved.allPrimary.map((a) => a.name).join(", ")}`,
						"warning",
					);
				}
				return;
			}

			activeAgentName = exact.name;
			persistActiveAgent(activeAgentName, resolved.defaultAgent);
			await applyAgentRuntimeSettings(exact, ctx);
			if (ctx.hasUI) {
				ctx.ui.notify(`Active agent: ${exact.displayName || exact.name}`, "info");
			}
		},
	});
}
