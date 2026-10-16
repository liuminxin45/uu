export function uuInspectionCommand(text) {
    const command = text.trim();
    if (/^\/uu\s+context$/i.test(command))
        return 'summary';
    if (/^\/uu\s+context\s+full$/i.test(command))
        return 'full';
    return undefined;
}
// User-requested display only. Never send this report to diagnostic logging.
export function renderUuInspection(plan, full, presentation = {}) {
    const redact = (text) => text
        .replace(/\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{16,})\b/g, '[REDACTED]')
        .replace(/((?:authorization|api[_-]?key|password|token|secret|cookie)["']?\s*[=:]\s*)(?:Bearer\s+[^\s,;]+|"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, '$1[REDACTED]');
    const names = { identity: 'L1 身份', tools: 'L2 工具指导', 'external-memory': 'L3 外部记忆', instructions: 'L4 业务指令', memory: 'L5 长期记忆', user: 'L6 用户偏好', skills: 'L7 技能索引', project: 'L8 项目上下文' };
    return [
        presentation.introduction ?? '这是本次请求的 uu 组装检查，由程序直接生成，没有调用模型。它不代表上一轮持久会话的冻结快照。',
        ['| 层 | 状态 | 条目 / 字符 | 来源 / 原因 |', '|---|---|---:|---|', ...plan.manifest.map(row => `| ${names[row.layerId]} | ${row.status} | ${row.sectionCount} / ${row.chars} | ${([row.sections.slice(0, 2).map(s => s.source || s.id).join('；') + (row.sections.length > 2 ? `；另 ${row.sections.length - 2} 个来源` : ''), row.reason].filter(Boolean).join('；') || '没有提供内容').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')} |`)].join('\n'),
        `宿主指令共 ${plan.developerInstructions.length} 字符；普通请求经 developerInstructions 发送。本轮用户资料 ${plan.userInput.length} 字符，单独发送；本次检查未向模型发送。`,
        presentation.policy ?? '查询命中的记忆属于本轮资料，不提升为指令。L5/L6 只展示宿主明确提供的记忆和偏好；来源读取、授权及执行内核基础指令由各自 owner 管理。',
        ...(full ? [presentation.fullIntroduction ?? '以下为本次编译的完整宿主指令（常见凭据已遮盖；不含执行内核基础指令与本轮来源正文）：', '````text', redact(plan.developerInstructions), '````'] : [presentation.summaryInstruction ?? '使用完整检查模式可查看本次宿主指令正文。']),
    ].join('\n\n');
}
