/**
 * OpenCode-style Agent Discovery & Configuration Registry
 *
 * Supports:
 * - JSON config (`~/.pi/agent/agents.json`, `~/.agents/agents.json`, `.pi/agents.json`)
 * - Multi-directory Markdown & JSON discovery (`~/.pi/agent/agents`, `~/.agents`, `~/agents`, `~/agent`, etc.)
 * - Prompt resolution via `{file:~/path/to/persona.md}`, `{file:./rel/path}`, `{file:/abs/path}`, or inline string
 * - Execution modes: "primary" (chat UI only), "subagent" (subagent tool only), "all" (both)
 * - Context pruning flags (`stripGlobalContext`, `skills`, `tools`)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";
export type AgentMode = "primary" | "subagent" | "all";

export interface AgentConfig {
	name: string;
	displayName?: string;
	description: string;
	mode: AgentMode;
	prompt?: string;
	systemPrompt: string;
	tools?: string[];
	skills?: string[];
	model?: string;
	thinking?: string;
	stripGlobalContext?: boolean;
	color?: string;
	/** Sprite icon name (e.g. "robot-2", "hammer", "search"). Resolved by keyword when omitted. */
	icon?: string;
	disabled?: boolean;
	hidden?: boolean;
	source: "user" | "project";
	filePath: string;
}

export interface AgentsJsonFile {
	$schema?: string;
	defaultAgent?: string;
	agent?: Record<
		string,
		{
			name?: string;
			description?: string;
			mode?: AgentMode;
			prompt?: string;
			system?: string;
			tools?: string[] | Record<string, boolean>;
			skills?: string[];
			model?: string;
			thinking?: string;
			stripGlobalContext?: boolean;
			color?: string;
			icon?: string;
			disabled?: boolean;
			disable?: boolean;
			hidden?: boolean;
		}
	>;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	defaultAgent: string;
	projectAgentsDir: string | null;
}

type AgentFrontmatter = {
	name?: unknown;
	description?: unknown;
	mode?: unknown;
	prompt?: unknown;
	tools?: unknown;
	skills?: unknown;
	model?: unknown;
	thinking?: unknown;
	stripGlobalContext?: unknown;
	color?: unknown;
	icon?: unknown;
	disabled?: unknown;
	hidden?: unknown;
};

function expandHomePath(inputPath: string): string {
	const trimmed = inputPath.trim();
	if (trimmed === "~") return os.homedir();
	if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
		return path.join(os.homedir(), trimmed.slice(2));
	}
	return trimmed;
}

/**
 * Resolves `{file:path/to/file}` references inside a prompt string or returns
 * the inline prompt directly. Supports `~/`, relative paths, and absolute paths.
 */
export function resolvePromptString(rawPrompt: string | undefined, baseDir: string, cwd: string): string {
	if (!rawPrompt || typeof rawPrompt !== "string") return "";

	const fileTokenRegex = /\{file:([^}]+)\}/g;
	if (!fileTokenRegex.test(rawPrompt)) {
		return rawPrompt;
	}

	return rawPrompt.replace(/\{file:([^}]+)\}/g, (_match, rawTarget: string) => {
		const expanded = expandHomePath(rawTarget);
		const candidates = path.isAbsolute(expanded)
			? [expanded]
			: [
					path.resolve(baseDir, expanded),
					path.resolve(cwd, expanded),
					path.resolve(os.homedir(), expanded),
				];

		for (const candidate of candidates) {
			if (fs.existsSync(candidate)) {
				try {
					const rawContent = fs.readFileSync(candidate, "utf-8");
					if (candidate.endsWith(".md") && rawContent.trimStart().startsWith("---")) {
						const { body } = parseFrontmatter<Record<string, unknown>>(rawContent);
						return body.trim();
					}
					return rawContent.trim();
				} catch {
					return "";
				}
			}
		}
		return "";
	});
}

function normalizeMode(value: unknown, fallback: AgentMode = "all"): AgentMode {
	if (value === "primary" || value === "subagent" || value === "all") {
		return value;
	}
	return fallback;
}

function parseToolsConfig(value: unknown): string[] | undefined {
	if (Array.isArray(value)) {
		const list = value
			.filter((t): t is string => typeof t === "string")
			.map((t) => t.trim())
			.filter(Boolean);
		return list.length > 0 ? list : undefined;
	}
	if (typeof value === "string") {
		const list = value
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
		return list.length > 0 ? list : undefined;
	}
	if (value && typeof value === "object") {
		const enabled = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v === true)
			.map(([k]) => k.trim())
			.filter(Boolean);
		return enabled.length > 0 ? enabled : undefined;
	}
	return undefined;
}

function parseSkillsConfig(value: unknown): string[] | undefined {
	if (Array.isArray(value)) {
		return value
			.filter((s): s is string => typeof s === "string")
			.map((s) => s.trim())
			.filter(Boolean);
	}
	if (typeof value === "string") {
		return value
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	}
	return undefined;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

export function getGlobalAgentsJsonPath(): string {
	return path.join(getAgentDir(), "agents.json");
}

/**
 * Bootstraps `~/.pi/agent/agents.json` on first run so existing `APPEND_SYSTEM.md`
 * (`blin`) and markdown agents are immediately available in OpenCode JSON format.
 */
export function ensureDefaultAgentsJson(): string {
	const configPath = getGlobalAgentsJsonPath();
	if (fs.existsSync(configPath)) return configPath;

	const home = os.homedir();
	const appendSystemPath = path.join(getAgentDir(), "APPEND_SYSTEM.md");
	const builderMdPath = path.join(getAgentDir(), "agents", "builder.md");
	const buildPromptPath = path.join(home, ".agents", "prompt", "build.md");

	const defaultConfig: AgentsJsonFile = {
		$schema: "https://raw.githubusercontent.com/amadshobi/lazypi/main/schemas/agents.schema.json",
		defaultAgent: "blin",
		agent: {
			blin: {
				name: "Blin",
				description: "Concise AI assistant, technical partner & subagent orchestrator",
				mode: "primary",
				icon: "robot-2",
				prompt: fs.existsSync(appendSystemPath)
					? "{file:~/.pi/agent/APPEND_SYSTEM.md}"
					: "You are blin, a concise AI assistant and technical expert.",
				tools: ["read", "bash", "edit", "write", "subagent"],
				skills: ["*"],
				stripGlobalContext: false,
			},
			builder: {
				name: "Builder",
				description: "Senior Fullstack & UI/UX Implementation Specialist with design skill discipline",
				mode: "all",
				icon: "hammer",
				prompt: fs.existsSync(builderMdPath)
					? "{file:~/.pi/agent/agents/builder.md}"
					: fs.existsSync(buildPromptPath)
						? "{file:~/.agents/prompt/build.md}"
						: "You are Builder, a Senior Fullstack Implementation Specialist.",
				tools: ["read", "bash", "edit", "write"],
				skills: ["design", "tools-manager"],
				stripGlobalContext: true,
			},
		},
	};

	try {
		const dir = path.dirname(configPath);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(configPath, `${JSON.stringify(defaultConfig, null, 2)}\n`, "utf-8");
	} catch {}

	return configPath;
}

const RESERVED_MARKDOWN_FILENAMES = new Set([
	"agents.md",
	"append_system.md",
	"system.md",
	"claude.md",
	"readme.md",
	"skill.md",
	"todos.md",
	"changelog.md",
]);

function loadAgentsFromMarkdownDir(
	dir: string,
	source: "user" | "project",
	cwd: string,
	defaultMode: AgentMode = "subagent",
): AgentConfig[] {
	const agents: AgentConfig[] = [];
	if (!isDirectory(dir)) return agents;

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (RESERVED_MARKDOWN_FILENAMES.has(entry.name.toLowerCase())) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);
		const fallbackName = entry.name.replace(/\.md$/i, "");
		const name = typeof frontmatter.name === "string" && frontmatter.name.trim() ? frontmatter.name.trim() : fallbackName;
		const description =
			typeof frontmatter.description === "string" && frontmatter.description.trim()
				? frontmatter.description.trim()
				: `Agent loaded from ${entry.name}`;

		const rawPrompt = typeof frontmatter.prompt === "string" ? frontmatter.prompt : body;
		const systemPrompt = resolvePromptString(rawPrompt, path.dirname(filePath), cwd);

		// Normalize home-relative `{file:...}` reference for markdown files
		const home = os.homedir();
		const prettyFileRef = filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;

		agents.push({
			name,
			description,
			mode: normalizeMode(frontmatter.mode, defaultMode),
			prompt: typeof frontmatter.prompt === "string" ? frontmatter.prompt : `{file:${prettyFileRef}}`,
			systemPrompt,
			tools: parseToolsConfig(frontmatter.tools),
			skills: parseSkillsConfig(frontmatter.skills),
			model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
			thinking: typeof frontmatter.thinking === "string" ? frontmatter.thinking : undefined,
			stripGlobalContext:
				typeof frontmatter.stripGlobalContext === "boolean" ? frontmatter.stripGlobalContext : true,
			color: typeof frontmatter.color === "string" ? frontmatter.color : undefined,
			icon: typeof frontmatter.icon === "string" ? frontmatter.icon : undefined,
			disabled: frontmatter.disabled === true,
			hidden: frontmatter.hidden === true,
			source,
			filePath,
		});
	}

	return agents;
}

function loadAgentsFromJsonFile(
	jsonPath: string,
	source: "user" | "project",
	cwd: string,
): { agents: AgentConfig[]; defaultAgent?: string } {
	const agents: AgentConfig[] = [];
	if (!fs.existsSync(jsonPath)) return { agents };

	let parsed: AgentsJsonFile;
	try {
		parsed = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as AgentsJsonFile;
	} catch {
		return { agents };
	}

	if (!parsed || typeof parsed !== "object") return { agents };
	const baseDir = path.dirname(jsonPath);
	const agentMap = parsed.agent && typeof parsed.agent === "object" ? parsed.agent : {};

	for (const [key, entry] of Object.entries(agentMap)) {
		if (!entry || typeof entry !== "object") continue;
		const rawPrompt = entry.prompt ?? entry.system ?? "";
		const systemPrompt = resolvePromptString(rawPrompt, baseDir, cwd);
		agents.push({
			name: key,
			displayName: typeof entry.name === "string" ? entry.name : undefined,
			description: typeof entry.description === "string" ? entry.description : `${key} agent`,
			mode: normalizeMode(entry.mode, "all"),
			prompt: rawPrompt,
			systemPrompt,
			tools: parseToolsConfig(entry.tools),
			skills: parseSkillsConfig(entry.skills),
			model: typeof entry.model === "string" ? entry.model : undefined,
			thinking: typeof entry.thinking === "string" ? entry.thinking : undefined,
			stripGlobalContext: typeof entry.stripGlobalContext === "boolean" ? entry.stripGlobalContext : false,
			color: typeof entry.color === "string" ? entry.color : undefined,
			icon: typeof entry.icon === "string" ? entry.icon : undefined,
			disabled: entry.disabled === true || entry.disable === true,
			hidden: entry.hidden === true,
			source,
			filePath: jsonPath,
		});
	}

	return {
		agents,
		defaultAgent: typeof parsed.defaultAgent === "string" ? parsed.defaultAgent : undefined,
	};
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	const homeDir = path.resolve(os.homedir());
	const globalAgentDir = path.resolve(getAgentDir());
	let currentDir = path.resolve(cwd);
	while (true) {
		if (currentDir === homeDir) return null;
		const candidates = [
			path.join(currentDir, CONFIG_DIR_NAME, "agents"),
			path.join(currentDir, CONFIG_DIR_NAME, "agent"),
			path.join(currentDir, ".agents", "agents"),
			path.join(currentDir, ".agents", "agent"),
		];
		for (const candidate of candidates) {
			if (path.resolve(candidate) === globalAgentDir) continue;
			if (isDirectory(candidate)) return candidate;
		}

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope = "both"): AgentDiscoveryResult {
	ensureDefaultAgentsJson();

	const home = os.homedir();
	const agentDir = getAgentDir();
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);
	const agentMap = new Map<string, AgentConfig>();
	let defaultAgent = "blin";

	if (scope === "user" || scope === "both") {
		// 1. Scan user markdown directories
		const userMarkdownDirs: Array<{ dir: string; defaultMode: AgentMode }> = [
			{ dir: path.join(agentDir, "agents"), defaultMode: "subagent" },
			{ dir: path.join(agentDir, "agent"), defaultMode: "subagent" },
			{ dir: path.join(home, ".agents", "agents"), defaultMode: "all" },
			{ dir: path.join(home, ".agents", "agent"), defaultMode: "all" },
			{ dir: path.join(home, "agents"), defaultMode: "all" },
			{ dir: path.join(home, "agent"), defaultMode: "all" },
		];
		for (const { dir, defaultMode } of userMarkdownDirs) {
			for (const agent of loadAgentsFromMarkdownDir(dir, "user", cwd, defaultMode)) {
				agentMap.set(agent.name, agent);
			}
		}

		// 2. Overlay user JSON configs (higher precedence over raw markdown files)
		const userJsonPaths = [
			path.join(home, ".agents", "agents.json"),
			path.join(agentDir, "agents.json"),
		];
		for (const jsonPath of userJsonPaths) {
			const loaded = loadAgentsFromJsonFile(jsonPath, "user", cwd);
			if (loaded.defaultAgent) defaultAgent = loaded.defaultAgent;
			for (const agent of loaded.agents) {
				const existing = agentMap.get(agent.name);
				agentMap.set(agent.name, {
					...existing,
					...agent,
					systemPrompt: agent.systemPrompt || existing?.systemPrompt || "",
				});
			}
		}
	}

	if (scope === "project" || scope === "both") {
		if (projectAgentsDir) {
			for (const agent of loadAgentsFromMarkdownDir(projectAgentsDir, "project", cwd, "all")) {
				agentMap.set(agent.name, agent);
			}
		}
		const projectJsonPaths = [
			path.join(cwd, ".agents", "agents.json"),
			path.join(cwd, CONFIG_DIR_NAME, "agents.json"),
		];
		for (const jsonPath of projectJsonPaths) {
			const loaded = loadAgentsFromJsonFile(jsonPath, "project", cwd);
			if (loaded.defaultAgent) defaultAgent = loaded.defaultAgent;
			for (const agent of loaded.agents) {
				const existing = agentMap.get(agent.name);
				agentMap.set(agent.name, {
					...existing,
					...agent,
					systemPrompt: agent.systemPrompt || existing?.systemPrompt || "",
				});
			}
		}
	}

	const activeAgents = Array.from(agentMap.values()).filter((a) => !a.disabled);
	return { agents: activeAgents, defaultAgent, projectAgentsDir };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}, mode=${a.mode}): ${a.description}`).join("; "),
		remaining,
	};
}

/**
 * Resolve the path to an individual skill directory or SKILL.md.
 */
export function resolveSkillPath(skillName: string, cwd: string): string | null {
	const home = os.homedir();
	const candidates = [
		// 1. Project-local skills
		path.join(cwd, ".agents", "skills", skillName, "SKILL.md"),
		path.join(cwd, ".agents", "skills", skillName),
		path.join(cwd, ".pi", "skills", skillName, "SKILL.md"),
		path.join(cwd, ".pi", "skills", skillName),
		// 2. Global user skills
		path.join(home, ".agents", "skills", skillName, "SKILL.md"),
		path.join(home, ".agents", "skills", skillName),
		path.join(home, ".pi", "agent", "skills", skillName, "SKILL.md"),
		path.join(home, ".pi", "agent", "skills", skillName),
	];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) return candidate;
	}
	return null;
}
