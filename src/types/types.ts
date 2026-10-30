export interface CliDefinition {
  id: string;
  name: string;
  provider: string;
  binaryCandidates: string[];
  resolvedBinary: string | null;
  wrapperBinary: string | null;
  installed: boolean;
  isCustom: boolean;
  args: string[];
  envKeys: string[];
  loginCommand: string;
  configPath: string;
  skillsDir: string;
  logPath: string;
  subscriptionDetected: boolean;
  accentColor: string;
}

export interface CustomCliInput {
  id: string;
  name: string;
  provider: string;
  binaryCmd: string;
  args: string[];
  envKeys: string[];
  loginCommand: string;
  configPath: string;
  skillsDir: string;
  logPath: string;
  accentColor: string;
}

export interface ProjectFolderRecord {
  path: string;
  name: string;
  lastUsedAt: string;
  groupName?: string;
}

export interface UserProfile {
  name: string;
  role: string;
  department: string;
  favoriteCli: string;
  avatarEmoji: string;
}

export interface ProjectAgentRecord {
  id: string;
  projectPath: string;
  name: string;
  roleTitle: string;
  cliId: string;
  useWrapper: boolean;
  avatarEmoji: string;
  accentColor: string;
  rolePrompt: string;
  autoBrief: boolean;
  createdAt: string;
  model?: string;
}

export interface ProjectAgentInput {
  id?: string;
  projectPath: string;
  name: string;
  roleTitle: string;
  cliId: string;
  useWrapper: boolean;
  avatarEmoji: string;
  accentColor: string;
  rolePrompt: string;
  autoBrief: boolean;
  model?: string;
}

export interface ProjectDeepContext {
  projectName: string;
  projectPath: string;
  readmeSnippet?: string | null;
  manifestSnippet?: string | null;
  fileTree: string[];
  detectedStacks: string[];
}

export interface DetectedCliCredential {
  cliId: string;
  provider: string;
  keyName: string;
  hasKey: boolean;
  maskedPreview: string;
  source: string;
}

export type AiProviderType = "anthropic" | "openai" | "gemini" | "groq" | "ollama";

export interface AiProviderConfig {
  provider: AiProviderType;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface ProjectAnalysisResult {
  projectPath: string;
  projectName: string;
  detectedStacks: string[];
  summaryDescription: string;
  topEntries: string[];
  recommendedAgents: ProjectAgentInput[];
}

export interface SessionInfo {
  id: string;
  cliId: string;
  name: string;
  binaryPath: string;
  cwd: string;
  status: string;
  envInjected: string[];
  startedAt: string;
  agentId?: string | null;
  agentName?: string | null;
  agentRole?: string | null;
  agentEmoji?: string | null;
  rolePrompt?: string | null;
}

export interface PtyOutputChunk {
  sessionId: string;
  data: string;
  nextCursor: number;
}

export interface ApiKeyStatus {
  cliId: string;
  keyName: string;
  hasKey: boolean;
  maskedPreview: string | null;
  updatedAt: string | null;
}

export interface DailyUsagePoint {
  date: string;
  claudeTokens: number;
  codexTokens: number;
  grokTokens: number;
  cursorTokens: number;
  antigravityTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface ModelBreakdownItem {
  modelName: string;
  cliId: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
  costUsd: number;
  percentage: number;
}

export interface CliUsageSummary {
  cliId: string;
  currentTokens: number;
  rolling5hTokens: number;
  weeklyTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface SubQuotaGroup {
  name: string;
  description?: string | null;
  remaining5h?: number | null;
  resetsAt5h?: string | null;
  remainingWeekly?: number | null;
  resetsAtWeekly?: string | null;
}

export interface CliQuotaStatus {
  cliId: string;
  cliName: string;
  planLabel: string;
  sourceLabel: string;
  hasOfficialQuota: boolean;
  usedPercent5h: number;
  remainingPercent5h: number;
  resetsAt5h: string | null;
  usedPercentWeekly: number;
  remainingPercentWeekly: number;
  resetsAtWeekly: string | null;
  statusMessage: string | null;
  subGroups?: SubQuotaGroup[] | null;
}

export interface UsageDashboardData {
  currentTokens: number;
  rolling5hTokens: number;
  rolling5hLimit: number;
  weeklyTokens: number;
  weeklyLimit: number;
  totalCostUsd: number;
  estimatedSavedTokens: number;
  dailyHistory: DailyUsagePoint[];
  modelBreakdown: ModelBreakdownItem[];
  cliSummaries: CliUsageSummary[];
  cliQuotas: CliQuotaStatus[];
  activeQuota: CliQuotaStatus | null;
  recentLogsCount: number;
  activeTimeframe?: string | null;
}

export interface RegistryItem {
  id: string;
  kind: "mcp" | "skill" | "plugin";
  name: string;
  description: string;
  enabled: boolean;
  isTokenSaver: boolean;
  isBuiltin: boolean;
  configJson: string;
  appliedClis: string[];
  updatedAt: string;
}

export interface BackupRecord {
  id: number;
  cliId: string;
  originalPath: string;
  backupPath: string;
  createdAt: string;
}

export interface ApplyResult {
  itemId: string;
  cliId: string;
  targetPath: string;
  backupPath: string | null;
  status: string;
}

export interface TeamMemberRecord {
  memberId: string;
  memberName: string;
  role: string;
  department: string;
  favoriteCli: string;
  avatarEmoji?: string;
  rolling5hTokens: number;
  weeklyTokens: number;
  savedTokensPct: number;
  costUsd: number;
  headroomActive: boolean;
  cavemanActive: boolean;
  syncedAt: string;
}

export type ActiveNavTab = "terminal" | "usage" | "mcp" | "auth" | "team";

export interface DirectoryItem {
  name: string;
  path: string;
  is_dir: boolean;
  is_hidden: boolean;
  size?: number;
  extension?: string;
}

export interface QuickAccessItem {
  name: string;
  path: string;
  kind: "home" | "desktop" | "documents" | "downloads" | "pictures" | "drive" | "project";
}

export interface DirectoryListing {
  current_path: string;
  parent_path: string | null;
  items: DirectoryItem[];
  quick_access: QuickAccessItem[];
}
